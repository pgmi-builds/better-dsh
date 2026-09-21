/**
 * SessionView — deep module owning served rows + drift + position reconstruction.
 *
 * Previously split: served-store (merge invariant, persistence via hash-store)
 * and drift (pure computeDrift + IO scanDrift that reads+writes served state).
 * The drift notice both *reads* served state and *writes* it (marking reported
 * + recording drift rows) — a side effect hidden inside a "notice" module.
 *
 * This seam co-locates that invariant. Public surface:
 *   view(sessionKey, path) -> {served, reported}
 *   recordRead(sessionKey, path, rows, lineCount)
 *   recordEdit(sessionKey, path, rows, lineCount, clearFrom)
 *   scanDrift(input) -> notice?
 *   servedPositionsOf, currentPositionOfDrifted, _mergeServedRows (via served-store)
 *
 * Storage note: the served ledger is keyed by canonical absolute PATH only
 * (no session identity) and lives in the centralized store under
 * `$DSH_HOME/storages/dsh-better-edit`. Verification authority is the current
 * file content (see anchor-pipeline verifyServedRange); served rows are the
 * advisory echo/undo/drift auxiliary. The AsyncLocalStorage cwd seam is
 * @internal and only carries the workspace for file IO.
 *
 * Ownership: This file now OWNS the served-merge invariant
 * (_mergeServedRows), the position-reconstruction math, and the drift
 * computation. Deleting it would scatter the served+drift invariant
 * across 4 files — it concentrates (deep).
 *
 * @module dsh-better-edit/session-view
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { HASH_RE } from "./hashline/hash-assign.js";
import { loadHashStore, withStore } from "./hash-store.js";
import { SERVED_ECHO_CAP } from "./constants.js";
import { fmtServedRows } from "./hashline/served.js";
import { configDir, hashStorePath, resolveTarget } from "./paths.js";
// --- workspace (private to this seam, @internal) ---
const current = new AsyncLocalStorage();
export function withWorkspace(cwd, fn) {
    return current.run(cwd, fn);
}
export function workspaceCwd() {
    return current.getStore();
}
// --- dsh-context (private to this seam) ---
export function execCwd(exec) {
    return exec.agent?.session.header.cwd ?? process.cwd();
}
// --- paths re-export (seam visibility) ---
export { configDir, hashStorePath, resolveTarget };
// --- hash-store re-export (persistence note) ---
export { loadHashStore, shutdownHashStore, withStore } from "./hash-store.js";
/**
 * Merge served rows into a copy of the stored array. This single helper owns
 * the served-merge invariant shared by recordServed and recordServedTruncated.
 * Eagerly heals orphaned serves: if the same hash is written at a new position
 * the old position is nulled (O(n) scan, no extra I/O). This prevents a
 * partial re-serve from leaving a stale duplicate behind (ADR-0008).
 */
export function _mergeServedRows(current, rows, options) {
    const updated = current.slice();
    if (options?.truncateTo !== undefined && updated.length > options.truncateTo) {
        updated.length = options.truncateTo;
    }
    if (options?.clearFrom !== undefined) {
        for (let i = options.clearFrom; i < updated.length; i++)
            updated[i] = null;
    }
    // Build index of existing hashes and heal duplicates already in the array
    const index = new Map();
    for (let i = 0; i < updated.length; i++) {
        const h = updated[i];
        if (h === null)
            continue;
        const prev = index.get(h);
        if (prev !== undefined) {
            updated[prev] = null;
        }
        index.set(h, i);
    }
    for (const entry of rows) {
        if (!Number.isInteger(entry.position) || entry.position < 0) {
            throw new TypeError(`Invalid served position: ${entry.position}`);
        }
        if (entry.hash !== null && (typeof entry.hash !== "string" || !HASH_RE.test(entry.hash))) {
            throw new TypeError(`Invalid served hash: ${String(entry.hash)}`);
        }
        while (updated.length <= entry.position)
            updated.push(null);
        if (entry.hash !== null) {
            const existing = index.get(entry.hash);
            if (existing !== undefined && existing !== entry.position) {
                updated[existing] = null;
                index.delete(entry.hash);
            }
            const oldAtPos = updated[entry.position];
            if (oldAtPos !== null && oldAtPos !== entry.hash) {
                index.delete(oldAtPos);
            }
            index.set(entry.hash, entry.position);
        }
        else {
            const oldAtPos = updated[entry.position];
            if (oldAtPos !== null)
                index.delete(oldAtPos);
        }
        updated[entry.position] = entry.hash;
    }
    while (updated.length > 0 && updated[updated.length - 1] === null)
        updated.pop();
    return updated;
}
export async function loadServed(path) {
    const store = await loadHashStore();
    return store.getServed(path);
}
export async function recordServed(path, rows, lineCount) {
    if (rows.length === 0)
        return;
    try {
        const store = await loadHashStore();
        withStore(() => {
            const current = store.getServed(path);
            const updated = _mergeServedRows(current, rows, lineCount === undefined ? undefined : { truncateTo: lineCount });
            if (current.length === updated.length && current.every((v, i) => v === updated[i]))
                return;
            store.upsertServed(path, JSON.stringify(updated));
        });
    }
    catch (error) {
        console.error("Failed to record served rows:", error);
    }
}
export async function recordServedTruncated(path, rows, lineCount, clearFrom = 0) {
    if (rows.length === 0)
        return;
    try {
        const store = await loadHashStore();
        withStore(() => {
            const current = store.getServed(path);
            const updated = _mergeServedRows(current, rows, { truncateTo: lineCount, clearFrom });
            // Avoid no-op writes (perf: O(1) check, no extra I/O beyond current read)
            if (current.length === updated.length && current.every((v, i) => v === updated[i]))
                return;
            store.upsertServed(path, JSON.stringify(updated));
        });
    }
    catch (error) {
        console.error("Failed to record truncated served rows:", error);
    }
}
export async function driftReported(path) {
    try {
        const store = await loadHashStore();
        return store.getServedReported(path);
    }
    catch (error) {
        console.error("Failed to load reported drift set:", error);
        return new Set();
    }
}
export async function markDriftReported(path, hashes) {
    try {
        const valid = hashes.filter((hash) => HASH_RE.test(hash));
        if (valid.length === 0)
            return;
        const store = await loadHashStore();
        withStore(() => {
            const current = store.getServedReported(path);
            for (const hash of valid)
                current.add(hash);
            store.upsertServedReported(path, JSON.stringify([...current]));
        });
    }
    catch (error) {
        console.error("Failed to record reported drift set:", error);
    }
}
export async function clearDriftReported(path) {
    try {
        const store = await loadHashStore();
        withStore(() => {
            store.clearServedReported(path);
        });
    }
    catch (error) {
        console.error("Failed to clear reported drift set:", error);
    }
}
export function servedPositionsOf(served, hash) {
    const out = [];
    for (let i = 0; i < served.length; i++) {
        if (served[i] === hash)
            out.push(i);
    }
    return out;
}
function nearestSurvivingPosition(served, surviving, from, direction) {
    if (direction === "below") {
        for (let q = from - 1; q >= 0; q--) {
            const hash = served[q];
            if (hash !== null && surviving.has(hash))
                return q;
        }
        return undefined;
    }
    for (let q = from + 1; q < served.length; q++) {
        const hash = served[q];
        if (hash !== null && surviving.has(hash))
            return q;
    }
    return undefined;
}
export function currentPositionOfDrifted(served, currentPositions, surviving, servedIndex, delta) {
    const below = nearestSurvivingPosition(served, surviving, servedIndex, "below");
    if (below !== undefined)
        return currentPositions.get(served[below]) + 1;
    const above = nearestSurvivingPosition(served, surviving, servedIndex, "above");
    if (above !== undefined)
        return currentPositions.get(served[above]) - 1;
    return servedIndex + delta;
}
export const DRIFT_NOTICE_HEADING = "drift:";
export function computeDrift(input) {
    const { served, resultHashes, resultLines, range, reported, cap = SERVED_ECHO_CAP } = input;
    const resultHashSet = new Set(resultHashes);
    const currentPosOfHash = new Map();
    for (let i = 0; i < resultHashes.length; i++) {
        currentPosOfHash.set(resultHashes[i], i);
    }
    const startPositions = servedPositionsOf(served, range.startHash);
    const endPositions = servedPositionsOf(served, range.endHash);
    let servedStartIdx;
    let servedEndIdx;
    if (startPositions.length === 1 && endPositions.length === 1) {
        servedStartIdx = startPositions[0];
        servedEndIdx = endPositions[0];
    }
    else {
        servedStartIdx = range.startLine - 1;
        servedEndIdx = range.endLine - 1;
    }
    const rangeFrom = Math.min(servedStartIdx, servedEndIdx);
    const rangeTo = Math.max(servedStartIdx, servedEndIdx);
    let total = 0;
    let unshown = 0;
    let anyNotReported = false;
    const driftedPositions = [];
    for (let p = 0; p < served.length; p++) {
        const servedHash = served[p];
        if (servedHash === null)
            continue;
        if (p >= rangeFrom && p <= rangeTo)
            continue;
        if (resultHashSet.has(servedHash))
            continue;
        total++;
        if (!reported.has(servedHash))
            anyNotReported = true;
        const currentPos = currentPositionOfDrifted(served, currentPosOfHash, resultHashSet, p, range.delta);
        if (currentPos >= 0 && currentPos < resultHashes.length && currentPos < resultLines.length) {
            driftedPositions.push(currentPos);
        }
        else {
            unshown++;
        }
    }
    if (total === 0)
        return undefined;
    const countLabel = `${total} line(s)`;
    if (!anyNotReported) {
        return {
            text: `${DRIFT_NOTICE_HEADING} ${countLabel} changed outside the range (already reported) — re-read to refresh.`,
            rows: [],
            total,
            allAlreadyReported: true,
        };
    }
    const driftedSet = new Set(driftedPositions);
    const windowSet = new Set();
    for (const pos of driftedPositions) {
        for (const w of [pos - 1, pos, pos + 1]) {
            if (w >= 0 && w < resultLines.length)
                windowSet.add(w);
        }
    }
    const windowPositions = [...windowSet].sort((a, b) => a - b);
    const shownPositions = windowPositions.slice(0, cap);
    unshown += windowPositions.length - shownPositions.length;
    const rows = shownPositions.map((position) => ({
        position,
        hash: resultHashes[position],
        content: resultLines[position],
        drifted: driftedSet.has(position),
    }));
    const rowsText = fmtServedRows(rows, resultLines);
    const moreText = unshown > 0 ? `\n[... ${unshown} more — re-read to see]` : "";
    return {
        text: `${DRIFT_NOTICE_HEADING} ${countLabel} changed outside the range:\n${rowsText}${moreText}`,
        rows,
        total,
        allAlreadyReported: false,
    };
}
export async function scanDrift(input) {
    const reported = await driftReported(input.path);
    const result = computeDrift({ ...input, reported });
    if (!result || result.allAlreadyReported)
        return result?.text;
    await recordServed(input.path, result.rows.map((row) => ({ position: row.position, hash: row.hash })), input.resultLines.length);
    await markDriftReported(input.path, result.rows.filter((row) => row.drifted).map((row) => row.hash));
    return result.text;
}
