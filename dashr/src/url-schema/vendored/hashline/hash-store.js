/**
 * The hash store — ONE deep persistence module for the hashline domain.
 *
 * Owns the sqlite db, the schema and migrations, corruption quarantine,
 * busy-retry, WAL, the legacy-JSON migration, AND the three narrow row APIs
 * the rest of the plugin needs: hash snapshots, undo entries, and served
 * rows. The prepared statements are a private implementation detail — callers
 * use domain methods, never SQL.
 *
 * Corrupt-row handling (parse the JSON column → validate against the hash
 * alphabet → delete the corrupt row) lives here, once, for every row family.
 * Cross-table cleanup (pruneMissing) lives here too — a sibling module never
 * reaches into another family's rows.
 * @module dsh-better-edit/hash-store
 */
import { existsSync } from "node:fs";
import { readFile, rename, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashStorePath } from "./paths.js";
import { workspaceCwd } from "./workspace.js";
import { errCode, splitLines } from "./utils.js";
import { initHasher, contentChecksum, HASH_RE, CANON_VERSION } from "./hashline/hash-assign.js";
import { HASH_STORE_VERSION, HASH_STORE_BUSY_TIMEOUT, SERVED_TTL_MS } from "./constants.js";
export function isValidHashList(value) {
    if (!Array.isArray(value))
        return false;
    for (const hash of value) {
        if (typeof hash !== "string" || !HASH_RE.test(hash))
            return false;
    }
    return true;
}
export function isValidSnapshot(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const v = value;
    if (typeof v.content !== "string")
        return false;
    return isValidHashList(v.hashes);
}
/** A served-row array: per-position hash, or null for never-served slots. */
export function isValidServedList(value) {
    if (!Array.isArray(value))
        return false;
    for (const entry of value) {
        if (entry === null)
            continue;
        if (typeof entry !== "string" || !HASH_RE.test(entry))
            return false;
    }
    return true;
}
function cacheKey(checksum) {
    return `${CANON_VERSION}:${checksum}`;
}
// ---- db plumbing (private) --------------------------------------------------
export function isCorruptionError(error) {
    if (error && typeof error === "object") {
        const errcode = error.errcode;
        if (typeof errcode === "number") {
            return errcode === 11 || errcode === 24 || errcode === 26;
        }
        const code = error.code;
        if (typeof code === "string" && /NOTADB|CORRUPT/.test(code))
            return true;
    }
    return (error instanceof Error &&
        /corrupt|not a database|malformed|database disk image/i.test(error.message));
}
function isBusyError(error) {
    if (error && typeof error === "object") {
        const errcode = error.errcode;
        if (typeof errcode === "number")
            return errcode === 5 || errcode === 6;
    }
    return error instanceof Error && /busy|locked/i.test(error.message);
}
function sleepSync(ms) {
    const sab = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sab, 0, 0, ms);
}
const BUSY_RETRIES = 3;
const BUSY_RETRY_DELAY_MS = 100;
function withBusyRetry(fn) {
    let lastError;
    for (let attempt = 0; attempt <= BUSY_RETRIES; attempt++) {
        try {
            return fn();
        }
        catch (error) {
            lastError = error;
            if (!isBusyError(error) || attempt === BUSY_RETRIES)
                throw error;
            sleepSync(BUSY_RETRY_DELAY_MS);
        }
    }
    throw lastError;
}
function openDbWithBusyRetry(storePath) {
    return withBusyRetry(() => openDb(storePath));
}
/** One open store per store path (per workspace); parallel sessions share per-workspace dbs. */
const stores = new Map();
const openings = new Map();
let exitHandlerRegistered = false;
function openDb(storePath) {
    const db = new DatabaseSync(storePath, {
        timeout: HASH_STORE_BUSY_TIMEOUT,
    });
    try {
        return buildStore(db);
    }
    catch (error) {
        try {
            db.close();
        }
        catch {
            // best-effort close when the store build fails
        }
        throw error;
    }
}
function buildStore(db) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("CREATE TABLE IF NOT EXISTS snapshots (" +
        "path TEXT PRIMARY KEY, " +
        "checksum TEXT NOT NULL, " +
        "line_count INTEGER NOT NULL, " +
        "hashes TEXT NOT NULL, " +
        "updated_at INTEGER NOT NULL" +
        ")");
    db.exec("CREATE TABLE IF NOT EXISTS meta (" +
        "key TEXT PRIMARY KEY, " +
        "value TEXT NOT NULL" +
        ")");
    db.exec("CREATE TABLE IF NOT EXISTS undo (" +
        "path TEXT PRIMARY KEY, " +
        "content TEXT NOT NULL, " +
        "bom TEXT NOT NULL, " +
        "ending TEXT NOT NULL, " +
        "hashes TEXT NOT NULL, " +
        "result_content TEXT NOT NULL, " +
        "updated_at INTEGER NOT NULL" +
        ")");
    const versionRow = db
        .prepare("SELECT value FROM meta WHERE key = 'version'")
        .get();
    const versionChanged = versionRow !== undefined &&
        versionRow.value !== String(HASH_STORE_VERSION);
    if (versionChanged) {
        db.exec("DELETE FROM snapshots");
        db.exec("DELETE FROM undo");
    }
    const servedColumns = db.prepare("PRAGMA table_info(served)").all();
    if (versionChanged ||
        !servedColumns.some((column) => column.name === "session_id")) {
        db.exec("DROP TABLE IF EXISTS served");
    }
    db.exec("CREATE TABLE IF NOT EXISTS served (" +
        "session_id TEXT NOT NULL, " +
        "path TEXT NOT NULL, " +
        "hashes TEXT NOT NULL, " +
        "reported TEXT, " +
        "updated_at INTEGER NOT NULL, " +
        "PRIMARY KEY (session_id, path)" +
        ")");
    db.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(HASH_STORE_VERSION));
    const getStmt = db.prepare("SELECT hashes FROM snapshots WHERE path = ? AND checksum = ? AND line_count = ?");
    const allStmt = db.prepare("SELECT path FROM snapshots UNION SELECT path FROM undo UNION SELECT path FROM served");
    const allHashesStmt = db.prepare("SELECT path, hashes FROM snapshots");
    const delStmt = db.prepare("DELETE FROM snapshots WHERE path = ?");
    const upsertStmt = db.prepare("INSERT INTO snapshots (path, checksum, line_count, hashes, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(path) DO UPDATE SET checksum = excluded.checksum, line_count = excluded.line_count, hashes = excluded.hashes, updated_at = excluded.updated_at");
    const undoUpsertStmt = db.prepare("INSERT INTO undo (path, content, bom, ending, hashes, result_content, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(path) DO UPDATE SET content = excluded.content, bom = excluded.bom, ending = excluded.ending, hashes = excluded.hashes, result_content = excluded.result_content, updated_at = excluded.updated_at");
    const undoGetStmt = db.prepare("SELECT content, bom, ending, hashes, result_content FROM undo WHERE path = ?");
    const undoDelStmt = db.prepare("DELETE FROM undo WHERE path = ?");
    const servedGetStmt = db.prepare("SELECT hashes, reported FROM served WHERE session_id = ? AND path = ?");
    const servedUpsertStmt = db.prepare("INSERT INTO served (session_id, path, hashes, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(session_id, path) DO UPDATE SET hashes = excluded.hashes, updated_at = excluded.updated_at");
    const servedReportedUpsertStmt = db.prepare("INSERT INTO served (session_id, path, hashes, reported, updated_at) VALUES (?, ?, '[]', ?, ?) " +
        "ON CONFLICT(session_id, path) DO UPDATE SET reported = excluded.reported, updated_at = excluded.updated_at");
    const servedReportedClearStmt = db.prepare("UPDATE served SET reported = NULL, updated_at = ? WHERE session_id = ? AND path = ?");
    const servedDeleteStmt = db.prepare("DELETE FROM served WHERE session_id = ? AND path = ?");
    const servedDeletePathStmt = db.prepare("DELETE FROM served WHERE path = ?");
    const servedWipeStmt = db.prepare("DELETE FROM served WHERE session_id = ?");
    const servedPruneOlderThanStmt = db.prepare("DELETE FROM served WHERE updated_at < ?");
    const stmts = {
        get: (...params) => getStmt.get(...params),
        allPaths: (...params) => allStmt.all(...params),
        allHashes: (...params) => allHashesStmt.all(...params),
        deleteOne: (...params) => {
            withBusyRetry(() => {
                delStmt.run(...params);
            });
        },
        upsert: (...params) => {
            withBusyRetry(() => {
                upsertStmt.run(...params);
            });
        },
        undoUpsert: (...params) => {
            withBusyRetry(() => {
                undoUpsertStmt.run(...params);
            });
        },
        undoGet: (...params) => undoGetStmt.get(...params),
        undoDelete: (...params) => {
            withBusyRetry(() => {
                undoDelStmt.run(...params);
            });
        },
        servedGet: (...params) => servedGetStmt.get(...params),
        servedUpsert: (...params) => {
            withBusyRetry(() => {
                servedUpsertStmt.run(...params);
            });
        },
        servedReportedUpsert: (...params) => {
            withBusyRetry(() => {
                servedReportedUpsertStmt.run(...params);
            });
        },
        servedReportedClear: (...params) => {
            withBusyRetry(() => {
                servedReportedClearStmt.run(params[1], params[0], params[2]);
            });
        },
        servedDelete: (...params) => {
            withBusyRetry(() => {
                servedDeleteStmt.run(...params);
            });
        },
        servedDeletePath: (...params) => {
            withBusyRetry(() => {
                servedDeletePathStmt.run(...params);
            });
        },
        servedWipe: (...params) => {
            withBusyRetry(() => {
                servedWipeStmt.run(...params);
            });
        },
        servedPruneOlderThan: (...params) => {
            withBusyRetry(() => {
                servedPruneOlderThanStmt.run(...params);
            });
        },
    };
    return { db, stmts };
}
/** Wire the domain methods over the prepared statements. */
function makeDomainStore(stmts) {
    return {
        engine: "node:sqlite",
        getSnapshot(path, content, deleteCorrupt = true) {
            const checksum = cacheKey(contentChecksum(content));
            const lineCount = splitLines(content).length;
            const row = stmts.get(path, checksum, lineCount);
            if (!row)
                return undefined;
            try {
                const parsed = JSON.parse(row.hashes);
                if (isValidHashList(parsed))
                    return parsed;
                if (deleteCorrupt)
                    stmts.deleteOne(path);
                return undefined;
            }
            catch {
                if (deleteCorrupt)
                    stmts.deleteOne(path);
                return undefined;
            }
        },
        upsertSnapshot(path, checksum, lineCount, hashes) {
            stmts.upsert(path, cacheKey(checksum), lineCount, JSON.stringify(hashes), Date.now());
        },
        allKnownPaths() {
            return stmts.allPaths();
        },
        allSnapshotHashes() {
            return stmts.allHashes();
        },
        deleteSnapshot(path) {
            stmts.deleteOne(path);
        },
        findSnapshotPaths(hashes) {
            const rows = stmts.allHashes();
            const matches = [];
            for (const row of rows) {
                try {
                    const parsed = JSON.parse(row.hashes);
                    if (!isValidHashList(parsed))
                        continue;
                    if (hashes.every((h) => parsed.includes(h)))
                        matches.push(row.path);
                }
                catch {
                    // unparseable row → skip it
                }
            }
            return matches;
        },
        getUndo(path) {
            const row = stmts.undoGet(path);
            if (!row)
                return undefined;
            try {
                const parsed = JSON.parse(row.hashes);
                if (!isValidHashList(parsed)) {
                    stmts.undoDelete(path);
                    return undefined;
                }
                return {
                    content: row.content,
                    bom: row.bom,
                    ending: row.ending,
                    hashes: parsed,
                    resultContent: row.result_content,
                };
            }
            catch {
                stmts.undoDelete(path);
                return undefined;
            }
        },
        upsertUndo(path, entry) {
            stmts.undoUpsert(path, entry.content, entry.bom, entry.ending, JSON.stringify(entry.hashes), entry.resultContent, Date.now());
        },
        deleteUndo(path) {
            stmts.undoDelete(path);
        },
        getServed(sessionKey, path) {
            const row = stmts.servedGet(sessionKey, path);
            if (!row)
                return [];
            try {
                const parsed = JSON.parse(row.hashes);
                if (isValidServedList(parsed))
                    return parsed;
                stmts.servedDelete(sessionKey, path);
                return [];
            }
            catch {
                stmts.servedDelete(sessionKey, path);
                return [];
            }
        },
        getServedReported(sessionKey, path) {
            const row = stmts.servedGet(sessionKey, path);
            if (!row)
                return new Set();
            const raw = row.reported;
            if (typeof raw !== "string" || raw.length === 0)
                return new Set();
            try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed))
                    return new Set();
                return new Set(parsed.filter((h) => typeof h === "string" && HASH_RE.test(h)));
            }
            catch {
                return new Set();
            }
        },
        upsertServed(sessionKey, path, hashesJson) {
            stmts.servedUpsert(sessionKey, path, hashesJson, Date.now());
        },
        upsertServedReported(sessionKey, path, reportedJson) {
            stmts.servedReportedUpsert(sessionKey, path, reportedJson, Date.now());
        },
        clearServedReported(sessionKey, path) {
            stmts.servedReportedClear(sessionKey, Date.now(), path);
        },
        deleteServed(sessionKey, path) {
            stmts.servedDelete(sessionKey, path);
        },
        deleteServedByPath(path) {
            stmts.servedDeletePath(path);
        },
        wipeServed(sessionKey) {
            stmts.servedWipe(sessionKey);
        },
        pruneServedOlderThan(ts) {
            stmts.servedPruneOlderThan(ts);
        },
        async pruneMissing() {
            const rows = stmts.allPaths();
            const missing = await statMissing(rows);
            if (missing.length === 0)
                return;
            withStore(() => {
                for (const path of missing) {
                    stmts.deleteOne(path);
                    stmts.undoDelete(path);
                    stmts.servedDeletePath(path);
                }
            });
        },
    };
}
function isHealthy(db) {
    try {
        const row = db.prepare("PRAGMA quick_check").get();
        return row?.quick_check === "ok";
    }
    catch (error) {
        if (isCorruptionError(error))
            return false;
        return true;
    }
}
async function quarantineStore(storePath) {
    const suffix = `.corrupt-${Date.now()}`;
    for (const candidate of [storePath, `${storePath}-wal`, `${storePath}-shm`]) {
        try {
            await rename(candidate, `${candidate}${suffix}`);
        }
        catch (error) {
            if (errCode(error) !== "ENOENT") {
                console.error("Failed to quarantine corrupt hash store file:", error);
            }
        }
    }
}
function shutdownDb(db) {
    try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    catch {
        // best-effort checkpoint before close
    }
    db.close();
}
const STAT_BATCH = 64;
async function statMissing(rows) {
    const missing = [];
    for (let i = 0; i < rows.length; i += STAT_BATCH) {
        const batch = rows.slice(i, i + STAT_BATCH);
        const results = await Promise.all(batch.map(async (row) => {
            try {
                await stat(row.path);
                return undefined;
            }
            catch {
                return row.path;
            }
        }));
        for (const path of results) {
            if (path !== undefined)
                missing.push(path);
        }
    }
    return missing;
}
async function openStore(storePath) {
    // Multi-store: never close another workspace's store when opening this one.
    await initHasher();
    await mkdir(dirname(storePath), { recursive: true });
    let existed = existsSync(storePath);
    let opened;
    try {
        opened = openDbWithBusyRetry(storePath);
    }
    catch (error) {
        if (!isCorruptionError(error))
            throw error;
        console.error("Hash store failed to open, rebuilding:", error);
        await quarantineStore(storePath);
        existed = false;
        opened = openDbWithBusyRetry(storePath);
    }
    if (!isHealthy(opened.db)) {
        shutdownDb(opened.db);
        await quarantineStore(storePath);
        existed = false;
        opened = openDbWithBusyRetry(storePath);
    }
    const { db, stmts } = opened;
    if (!existed) {
        await migrateLegacy(db, storePath);
    }
    withBusyRetry(() => {
        stmts.servedPruneOlderThan(Date.now() - SERVED_TTL_MS);
    });
    const store = makeDomainStore(stmts);
    stores.set(storePath, { path: storePath, db, stmts, store });
    if (!exitHandlerRegistered) {
        exitHandlerRegistered = true;
        process.once("exit", () => shutdownHashStore());
        for (const sig of ["SIGINT", "SIGTERM"]) {
            process.once(sig, () => {
                shutdownHashStore();
                process.kill(process.pid, sig);
            });
        }
    }
    return store;
}
/** Resolve the store path for this call: explicit cwd, the active workspace, or the shared-home fallback. */
function storePathFor(cwd) {
    return hashStorePath(cwd ?? workspaceCwd());
}
/**
 * Load (and cache) the hash store for the given cwd — or, when omitted, the
 * workspace active for this async execution (`withWorkspace`), falling back to
 * the shared `$DSH_HOME` store outside a tool call.
 * @param cwd - optional explicit workspace root; defaults to the active workspace.
 */
export function loadHashStore(cwd) {
    const storePath = storePathFor(cwd);
    const cached = stores.get(storePath);
    if (cached && cached.db.isOpen) {
        return Promise.resolve(cached.store);
    }
    const existing = openings.get(storePath);
    if (existing)
        return existing;
    const promise = openStore(storePath).finally(() => {
        openings.delete(storePath);
    });
    openings.set(storePath, promise);
    return promise;
}
/** The cached store entry for the active workspace (or the shared-home fallback), if open. */
function currentStore() {
    const entry = stores.get(storePathFor());
    return entry?.db.isOpen ? entry : undefined;
}
/** Close every open store (process exit, HMR, tests). */
export function shutdownHashStore() {
    for (const [, entry] of stores) {
        shutdownDb(entry.db);
    }
    stores.clear();
    openings.clear();
}
/**
 * Run `fn` inside one BEGIN IMMEDIATE transaction on the active workspace's
 * store. Without an open store for this context the call runs bare (the
 * caller has already loaded the store in every in-process path).
 */
export function withStore(fn) {
    const store = currentStore();
    if (store) {
        withBusyRetry(() => {
            store.db.exec("BEGIN IMMEDIATE");
            try {
                fn();
                store.db.exec("COMMIT");
            }
            catch (e) {
                try {
                    store.db.exec("ROLLBACK");
                }
                catch {
                    // best-effort rollback; the original error propagates
                }
                throw e;
            }
        });
    }
    else {
        fn();
    }
}
async function migrateLegacy(db, storePath) {
    const legacyPath = join(dirname(storePath), "hash-store.json");
    let content;
    try {
        content = await readFile(legacyPath, "utf-8");
    }
    catch (error) {
        if (errCode(error) === "ENOENT")
            return;
        console.error("Failed to read legacy hash store for migration:", error);
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (error) {
        console.error("Failed to parse legacy hash store, skipping migration:", error);
        return;
    }
    const raw = parsed.snapshots;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return;
    const rows = [];
    for (const [key, value] of Object.entries(raw)) {
        if (!isValidSnapshot(value))
            continue;
        if (new Set(value.hashes).size !== value.hashes.length) {
            console.warn(`Skipped legacy snapshot with duplicate hashes for ${key}; it will be re-hashed on next read.`);
            continue;
        }
        rows.push([
            key,
            contentChecksum(value.content),
            splitLines(value.content).length,
            JSON.stringify(value.hashes),
            Date.now(),
        ]);
    }
    if (rows.length > 0) {
        db.exec("BEGIN IMMEDIATE");
        try {
            const stmt = db.prepare("INSERT OR REPLACE INTO snapshots (path, checksum, line_count, hashes, updated_at) VALUES (?, ?, ?, ?, ?)");
            for (const row of rows)
                stmt.run(...row);
            db.exec("COMMIT");
        }
        catch (e) {
            db.exec("ROLLBACK");
            throw e;
        }
    }
    try {
        await rename(legacyPath, `${legacyPath}.bak`);
    }
    catch (error) {
        console.error("Failed to rename legacy hash store after migration:", error);
    }
}
// ---- async convenience helpers (load the active store, then delegate) ------
/** Find files whose stored snapshot hashes contain every given anchor. */
export async function findSnapshotPathsByHashes(hashes) {
    const store = await loadHashStore();
    return store.findSnapshotPaths(hashes);
}
/** Persist a hash snapshot for one path (async over the active store). */
export async function upsertSnapshotFor(path, checksum, lineCount, hashes) {
    const store = await loadHashStore();
    store.upsertSnapshot(path, checksum, lineCount, hashes);
}
