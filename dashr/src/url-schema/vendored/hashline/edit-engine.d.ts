/**
 * The edit-sequence engine shared by `edit`, `batch_edit`, and previews:
 * apply-one-edit against in-memory content with served verification, the
 * multi-edit sequencer that drives a whole file's item list against evolving
 * content, the noop-loop guard, and the persist-undo → write → restore
 * transaction both mutating tools run.
 *
 * The model-facing contract lives here unchanged: [E_BATCH_ABORT],
 * [E_NOOP_LOOP], [E_UNDO_UNAVAILABLE] carry byte-identical messages, and
 * reject-and-serve records the same echo serves.
 * @module dsh-better-edit/edit-engine
 */
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { FileIO } from "./fs-bridge.js";
import type { HashStore } from "./hash-store.js";
import type { LineEnding } from "./edit-diff.js";
import { type HEdit, type NEdit } from "./hashline/anchor-pipeline.js";
import { type ResolvedRange, type ServeRecordPolicy, type ServedRow } from "./hashline/anchor-pipeline.js";
import type { FsSandboxController } from "./sandbox.js";
export interface PreparedItem {
    index: number;
    path: string;
    absolutePath: string;
    remove_from: string;
    remove_to: string;
    replacement_text: string;
    pathWarning?: string;
}
export interface FileEditResult {
    displayPath: string;
    absolutePath: string;
    originalNormalized: string;
    result: string;
    bom: string;
    originalEnding: LineEnding;
    hadUtf8DecodeErrors: boolean;
    warnings: string[];
    originalHashes: string[];
    resultHashes: string[];
    appliedCount: number;
    noopCount: number;
    totalAddedLines: number;
    totalRemovedLines: number;
    driftNotice: string | undefined;
    range: ResolvedRange;
}
/**
 * Resolve a request's missing `path` from its anchors: the only file whose
 * stored hashes contain both anchors. Returns the path plus an autocorrect
 * warning, or undefined when no resolution is possible.
 */
export declare function resolveMissingPath(request: Record<string, unknown>): Promise<{
    path: string;
    warning: string;
} | undefined>;
/** The hashes a range edit removes, for stable re-hash bookkeeping. */
export declare function collectRemovedHashes(edit: HEdit, originalHashes: string[]): Set<string>;
/** Added/removed line counts for one resolved edit against a file's original hashes. */
export declare function countLineChanges(edit: HEdit, originalHashes: string[], isNoop: boolean, removedAutoFixes: number): {
    totalAddedLines: number;
    totalRemovedLines: number;
};
export interface ApplyOneInput {
    content: string;
    hashes: string[];
    served: (string | null)[];
    removeFrom: string;
    removeTo: string;
    replacementText: string;
    absolutePath: string;
    displayPath: string;
    signal?: AbortSignal;
    /** Shared warnings array; resEdit warnings are pushed here. */
    warnings: string[];
    /**
     * The hashes to count added/removed lines against. Defaults to `hashes`;
     * the batch sequencer passes the file's ORIGINAL hashes so later edits in
     * a sequence still count against the file as first served.
     */
    countHashes?: string[];
    store?: HashStore;
    persist: boolean;
    /** Pre-resolved edit (single path keeps resEdit before IO for error order). */
    edit?: HEdit;
}
export interface ApplyOneResult {
    result: string;
    /** Stable re-hash after the edit (equals `hashes` for a noop). */
    hashes: string[];
    range: ResolvedRange;
    noop: boolean;
    edit: HEdit;
    noopEdit?: NEdit;
    firstChangedLine?: number;
    lastChangedLine?: number;
    removedHashes: Set<string> | undefined;
    totalAddedLines: number;
    totalRemovedLines: number;
    anchorWarnings: string[] | undefined;
}
/**
 * One edit against in-memory content: resolve (unless a pre-resolved edit was
 * given) → apply with served verification → stable re-hash → line counts.
 *
 * `onReject` owns the reject-and-serve policy: it receives resolve/verify
 * failures (and the edit that failed, when resolved) and MUST throw. The
 * single path rethrows the original anchor error after recording echo serves;
 * the batch path wraps with [E_BATCH_ABORT] plus the current-range echo.
 */
export declare function applyOne(input: ApplyOneInput, onReject: (error: unknown, edit: HEdit | undefined) => Promise<never>): Promise<ApplyOneResult>;
export interface NoopLoopOptions {
    absolutePath: string;
    removeFrom: string;
    removeTo: string;
    replacementText: string;
    displayPath: string;
    /** Batch item index; undefined = single-edit flavor. */
    index?: number;
    count: number;
    sessionKey: string;
    originalHashes: string[];
    originalNormalized: string;
    /** Single-edit flavor only: the edit's range, for the echo rows. */
    range?: ResolvedRange;
    /** Batch flavor: precomputed echo rows for the failed item (may be absent). */
    echoRows?: ServedRow[];
}
/**
 * The shared noop-loop guard. Returns the "twice in a row" notice for the
 * caller to append to warnings, or throws [E_NOOP_LOOP] (after recording the
 * echo serves) once the payload has been submitted NOOP_LOOP_THRESHOLD times
 * with no change. Messages are byte-identical to the pre-engine tools.
 */
export declare function enforceNoopLoop(opts: NoopLoopOptions): Promise<string | undefined>;
/**
 * Run a file's item list against freshly-read content with served
 * verification, evolving content/hashes, union range, noop tracking, and a
 * per-file drift notice. All-or-nothing is enforced by the caller's
 * transaction ({@link persistUndoAndWrite}): nothing here writes to disk.
 */
export declare function runFileEdits(io: FileIO, items: PreparedItem[], opts: {
    signal?: AbortSignal;
    sessionKey: string;
}): Promise<FileEditResult>;
export interface UndoWriteFile {
    absolutePath: string;
    displayPath: string;
    originalNormalized: string;
    bom: string;
    originalEnding: LineEnding;
    originalHashes: string[];
    result: string;
}
export interface PersistWriteOptions {
    io: FileIO;
    files: UndoWriteFile[];
    exec: ToolExecution;
    sandbox: FsSandboxController;
    sandboxPolicy: SandboxExecutionPolicy | undefined;
    signal?: AbortSignal;
    /** [E_UNDO_UNAVAILABLE] message builder, per tool flavor. */
    undoUnavailableMessage: (displayPath: string) => string;
    /**
     * On write failure, also restore undo entries of files that were saved but
     * never written. The single-edit tool restores its one entry; the batch
     * tool keeps current behavior and restores only written files.
     */
    restoreUnwrittenUndos?: boolean;
}
/**
 * The persist-undo → write-all → restore-on-failure transaction shared by
 * `edit` (one file) and `batch_edit` (many files). Every file's undo entry is
 * persisted before anything is written; if a write fails, already-written
 * files are restored (original content written back, undo entry restored) and
 * the sandbox-mapped error rethrown.
 */
export declare function persistUndoAndWrite(opts: PersistWriteOptions): Promise<void>;
export type { ServeRecordPolicy };
