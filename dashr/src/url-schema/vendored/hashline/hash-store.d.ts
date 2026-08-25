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
/** The legacy JSON snapshot shape (pre-sqlite stores). */
export interface LegacySnapshot {
    content: string;
    hashes: string[];
}
export declare function isValidHashList(value: unknown): value is string[];
export declare function isValidSnapshot(value: unknown): value is LegacySnapshot;
/** A served-row array: per-position hash, or null for never-served slots. */
export declare function isValidServedList(value: unknown): value is (string | null)[];
/** The undo row contract shared by undo-edit and the store. */
export interface UndoRecord {
    content: string;
    bom: string;
    ending: string;
    hashes: string[];
    resultContent: string;
}
/**
 * The domain face of the hash store. Each row family gets a narrow API;
 * corruption healing (parse → validate → delete) happens inside the getters.
 */
export interface HashStore {
    readonly engine: "node:sqlite";
    /** The stored hashes for a path+content, or undefined on a miss; a corrupt row is deleted (when deleteCorrupt) and treated as a miss. */
    getSnapshot(path: string, content: string, deleteCorrupt?: boolean): string[] | undefined;
    upsertSnapshot(path: string, checksum: string, lineCount: number, hashes: string[]): void;
    /** Every path referenced by any row family (snapshots ∪ undo ∪ served). */
    allKnownPaths(): {
        path: string;
    }[];
    /** Every snapshot's path and raw hashes JSON (for path-by-hash scans). */
    allSnapshotHashes(): {
        path: string;
        hashes: string;
    }[];
    deleteSnapshot(path: string): void;
    /** Paths whose stored snapshot hashes contain every given anchor. */
    findSnapshotPaths(hashes: string[]): string[];
    /** The undo row for a path, healing a corrupt row (parse → validate → delete). */
    getUndo(path: string): UndoRecord | undefined;
    upsertUndo(path: string, entry: UndoRecord): void;
    deleteUndo(path: string): void;
    /** The served hashes array for a session+path, healing a corrupt row; [] when nothing was served. */
    getServed(sessionKey: string, path: string): (string | null)[];
    /** The reported-drift hash set for a session+path (lenient parse, never deletes). */
    getServedReported(sessionKey: string, path: string): Set<string>;
    /** Persist the hashes JSON column for a session+path. */
    upsertServed(sessionKey: string, path: string, hashesJson: string): void;
    /** Persist the reported-drift JSON column for a session+path (inserting a fresh empty hashes row). */
    upsertServedReported(sessionKey: string, path: string, reportedJson: string): void;
    clearServedReported(sessionKey: string, path: string): void;
    deleteServed(sessionKey: string, path: string): void;
    deleteServedByPath(path: string): void;
    wipeServed(sessionKey: string): void;
    pruneServedOlderThan(ts: number): void;
    /** Delete every row family's entries for paths that no longer exist on disk. */
    pruneMissing(): Promise<void>;
}
export declare function isCorruptionError(error: unknown): boolean;
/**
 * Load (and cache) the hash store for the given cwd — or, when omitted, the
 * workspace active for this async execution (`withWorkspace`), falling back to
 * the shared `$DSH_HOME` store outside a tool call.
 * @param cwd - optional explicit workspace root; defaults to the active workspace.
 */
export declare function loadHashStore(cwd?: string): Promise<HashStore>;
/** Close every open store (process exit, HMR, tests). */
export declare function shutdownHashStore(): void;
/**
 * Run `fn` inside one BEGIN IMMEDIATE transaction on the active workspace's
 * store. Without an open store for this context the call runs bare (the
 * caller has already loaded the store in every in-process path).
 */
export declare function withStore(fn: () => void): void;
/** Find files whose stored snapshot hashes contain every given anchor. */
export declare function findSnapshotPathsByHashes(hashes: string[]): Promise<string[]>;
/** Persist a hash snapshot for one path (async over the active store). */
export declare function upsertSnapshotFor(path: string, checksum: string, lineCount: number, hashes: string[]): Promise<void>;
