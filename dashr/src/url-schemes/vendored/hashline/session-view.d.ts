/**
 * SessionView — deep module owning served rows + drift + position reconstruction.
 *
 * Previously split: served-store (merge invariant, persistence via hash-store)
 * and drift (pure computeDrift + IO scanDrift that reads+writes served state).
 * The drift notice both *reads* served state and *writes* it (marking reported
 * + recording drift rows) — a side effect hidden inside a "notice" module.
 *
 * This seam co-locates that invariant. Public surface:
 \*   view(path) -> {served, reported}
 \*   recordRead(path, rows, lineCount)
 \*   recordEdit(path, rows, lineCount, clearFrom)
 \*   scanDrift(input) -> notice?
 *   servedPositionsOf, currentPositionOfDrifted, _mergeServedRows (via served-store)
 *
 * Explicit Workspace note: loadHashStore(cwd) now requires cwd. The
 * AsyncLocalStorage magic in workspace.ts is @internal — new code should pass
 * cwd explicitly through read-and-serve / edit-pipeline / drift. Forgetting
 * cwd is now a compile error where callers use this seam; legacy callers
 * via served-store still fall back to workspaceCwd() for backwards compat
 * but are marked deprecated.
 *
 * Ownership: This file now OWNS the served-merge invariant
 * (_mergeServedRows), the position-reconstruction math, and the drift
 * computation. Deleting it would scatter the served+drift invariant
 * across 4 files — it concentrates (deep).
 *
 * @module dsh-better-edit/session-view
 */
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ServedRow, ResolvedRange } from "./hashline/served.js";
import { configDir, hashStorePath, resolveTarget } from "./paths.js";
export declare function withWorkspace<T>(cwd: string, fn: () => Promise<T>): Promise<T>;
export declare function workspaceCwd(): string | undefined;
export declare function execCwd(exec: ToolExecution): string;
export declare function execSessionKey(exec: ToolExecution): string;
export { configDir, hashStorePath, resolveTarget };
export { loadHashStore, shutdownHashStore, withStore } from "./hash-store.js";
export type { HashStore } from "./hash-store.js";
export type ServedEntry = {
    position: number;
    hash: string | null;
};
/**
 * Merge served rows into a copy of the stored array. This single helper owns
 * the served-merge invariant shared by recordServed and recordServedTruncated.
 * Eagerly heals orphaned serves: if the same hash is written at a new position
 * the old position is nulled (O(n) scan, no extra I/O). This prevents a
 * partial re-serve from leaving a stale duplicate behind (ADR-0008).
 */
export declare function _mergeServedRows(current: (string | null)[], rows: ServedEntry[], options?: {
    truncateTo?: number;
    clearFrom?: number;
}): (string | null)[];
export declare function loadServed(path: string): Promise<(string | null)[]>;
export declare function recordServed(path: string, rows: ServedEntry[], lineCount?: number): Promise<void>;
export declare function recordServedTruncated(path: string, rows: ServedEntry[], lineCount: number, clearFrom?: number): Promise<void>;
export declare function driftReported(path: string): Promise<Set<string>>;
export declare function markDriftReported(path: string, hashes: string[]): Promise<void>;
export declare function clearDriftReported(path: string): Promise<void>;
export declare function servedPositionsOf(served: (string | null)[], hash: string): number[];
export declare function currentPositionOfDrifted(served: (string | null)[], currentPositions: Map<string, number>, surviving: Set<string>, servedIndex: number, delta: number): number;
export declare const DRIFT_NOTICE_HEADING = "drift:";
export interface DriftRow extends ServedRow {
    content: string;
    drifted: boolean;
}
export interface ComputeDriftInput {
    served: (string | null)[];
    resultHashes: string[];
    resultLines: string[];
    range: ResolvedRange;
    reported: Set<string>;
    cap?: number;
}
export interface DriftNoticeResult {
    text: string;
    rows: DriftRow[];
    total: number;
    allAlreadyReported: boolean;
}
export declare function computeDrift(input: ComputeDriftInput): DriftNoticeResult | undefined;
export declare function scanDrift(input: {

    served: (string | null)[];
    resultHashes: string[];
    resultLines: string[];
    range: ResolvedRange;
    path: string;
}): Promise<string | undefined>;
