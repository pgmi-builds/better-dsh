/**
 * Mutation — deep module owning the full file mutation lifecycle.
 *
 * Previously fragmented: tool-edit → edit-pipeline → edit-engine.applyOne →
 * edit-response/diff/drift, and tool-batch-edit → edit-engine.runFileEdits
 * (loop + unionRange + counters) → persistUndoAndWrite with a boolean flag.
 * Warnings, hadUtf8DecodeErrors, firstChangedLine, driftNotice were threaded
 * by mutation across 5 hops; bugs hid in wiring, not pure helpers.
 *
 * This seam owns: read → normalize → loadServed → applyOne* → stableRehash →
 * drift → persist → render. Tools become thin adapters: validate → delegate → return.
 * edit-diff, drift, noop-guard are private helpers of this seam.
 *
 * Public surface:
 *   execute(io, items, {sessionKey, exec, sandbox, signal}) → string  — deep seam: ONE interface
 *   applySingle(io, params, cwd, opts) → PipelineResult               — single-edit helper
 *   applySequence(io, items, ctx) → FileEditResult                    — per-file sequencer
 *   commit(io, files, {exec, sandboxPolicy, signal}) → void           — transaction
 *
 * Depth: small interface (execute) with large implementation — locality and leverage.
 *
 * Internals (private): verifyServedRange, resToSpan, assemble, scanDrift,
 * boundaryDups, noopGuard. Tested via PipelineResult/FileEditResult, not via split e2e.
 *
 * @module dsh-better-edit/mutation
 */
import type { FileIO } from "./fs-bridge.js";
import type { EditParams } from "./contract.js";
import type { HashStore } from "./hash-store.js";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { FsSandboxController } from "./sandbox.js";
import type { LineEnding } from "./edit-diff.js";
import { type NEdit } from "./hashline/anchor-pipeline.js";
import type { ResolvedRange } from "./hashline/anchor-pipeline.js";
import { scanDrift } from "./session-view.js";
import { runFileEdits, resolveMissingPath, persistUndoAndWrite, enforceNoopLoop, collectRemovedHashes, countLineChanges } from "./edit-engine.js";
import type { FileEditResult, PreparedItem } from "./edit-engine.js";
import { buildMetrics, buildNoop, buildChanged, buildBatchResult } from "./edit-response.js";
import type { RMeta, BatchSection } from "./edit-response.js";
import { genDiff, restoreEndings, toLF, stripBOM } from "./edit-diff.js";
import { computeDrift } from "./drift.js";
import { trackNoopPayload, clearNoopLoop, noopPayloadKey } from "./noop-guard.js";
export interface PipelineResult {
    path: string;
    absolutePath: string;
    originalNormalized: string;
    result: string;
    bom: string;
    originalEnding: LineEnding;
    hadUtf8DecodeErrors: boolean;
    warnings: string[];
    noopEdit?: NEdit;
    firstChangedLine?: number;
    lastChangedLine?: number;
    originalHashes: string[];
    resultHashes: string[];
    totalAddedLines: number;
    totalRemovedLines: number;
    driftNotice?: string;
    range: ResolvedRange;
}
export interface ExecPipelineOptions {
    signal?: AbortSignal;
    store?: HashStore;
    noPersist?: boolean;
    sessionKey?: string;
}
export declare function execPipeline(io: FileIO, params: EditParams, cwd: string, options?: ExecPipelineOptions): Promise<PipelineResult>;
/** Resolve the display path a caller names against the session cwd. */
export declare function resolveDisplayPath(path: string, cwd: string): string;
/** Snapshot bookkeeping for noop/success results (best-effort). */
export declare function snapshotIdFor(io: FileIO, absolutePath: string, signal?: AbortSignal): Promise<string | undefined>;
export { runFileEdits, resolveMissingPath, persistUndoAndWrite, enforceNoopLoop, collectRemovedHashes, countLineChanges, };
export type { FileEditResult, PreparedItem };
export { buildMetrics, buildNoop, buildChanged, buildBatchResult };
export type { RMeta, BatchSection };
export { genDiff, restoreEndings, toLF, stripBOM };
export { computeDrift, scanDrift };
export { trackNoopPayload, clearNoopLoop, noopPayloadKey };
/**
 * Deep seam: execute the full mutation lifecycle.
 *
 * Owns: applySequence → branch (single/multi × noop/applied) → commit →
 * buildBatchResult → recordServedTruncated → return text.
 *
 * The tool layer (adapter) only validates and resolves the nullable path; all
 * lifecycle branching concentrates here (locality). One interface serves N
 * call sites (leverage). Deleting this module would scatter the lifecycle
 * across every tool — it concentrates (deep).
 */
export declare function execute(opts: {
    io: FileIO;
    items: PreparedItem[];
    sessionKey: string;
    signal?: AbortSignal;
    exec: ToolExecution;
    sandbox: FsSandboxController;
    sandboxPolicy: SandboxExecutionPolicy | undefined;
}): Promise<string>;
/** Apply a single edit — owns read→normalize→loadServed→applyOne→stableRehash→drift. */
export declare function applySingle(io: FileIO, params: EditParams, cwd: string, opts?: {
    sessionKey?: string;
    signal?: AbortSignal;
    store?: HashStore;
    noPersist?: boolean;
}): Promise<PipelineResult>;
/** Apply a per-file sequence (batch's group) — owns the loop + unionRange + counters. */
export declare function applySequence(io: FileIO, items: PreparedItem[], ctx: {
    sessionKey: string;
    signal?: AbortSignal;
}): Promise<FileEditResult>;
/** Commit the transaction — owns persist-undo → write → restore. */
export declare function commit(opts: {
    io: FileIO;
    files: Array<{
        absolutePath: string;
        displayPath: string;
        originalNormalized: string;
        bom: string;
        originalEnding: import("./edit-diff.js").LineEnding;
        originalHashes: string[];
        result: string;
    }>;
    exec: ToolExecution;
    sandbox: FsSandboxController;
    sandboxPolicy: SandboxExecutionPolicy | undefined;
    signal?: AbortSignal;
    undoUnavailableMessage: (displayPath: string) => string;
    restoreUnwrittenUndos?: boolean;
}): Promise<void>;
