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
import { normFromText, fileSnap } from "./file-reader.js";
import { toCwd } from "./paths.js";
import { resEdit } from "./hashline/anchor-pipeline.js";
import { MAX_HASH_LINES } from "./hashline/hash-assign.js";
import { AnchorMismatchError, ServedRejectionError, recordEchoServes, } from "./hashline/anchor-pipeline.js";
import { loadServed, sessionKeyFor, scanDrift, recordServedTruncated } from "./session-view.js";
import { abortIf, splitLines } from "./utils.js";
import { applyOne } from "./edit-engine.js";
import { runFileEdits, resolveMissingPath, persistUndoAndWrite, enforceNoopLoop, collectRemovedHashes, countLineChanges, } from "./edit-engine.js";
import { buildMetrics, buildNoop, buildChanged, buildBatchResult } from "./edit-response.js";
import { genDiff, restoreEndings, toLF, stripBOM } from "./edit-diff.js";
import { computeDrift } from "./drift.js";
import { trackNoopPayload, clearNoopLoop, noopPayloadKey } from "./noop-guard.js";
export async function execPipeline(io, params, cwd, options) {
    const path = params.path;
    const editWarnings = [];
    // Resolve the edit up front (before IO) so malformed anchors fail before
    // any filesystem work, exactly as the tool always did.
    const edit = resEdit({
        remove_from: params.remove_from,
        remove_to: params.remove_to,
        replacement_text: params.replacement_text,
    }, editWarnings);
    const hashStore = options?.store;
    const signal = options?.signal;
    abortIf(signal);
    const absolutePath = await io.resolve(path, cwd, signal);
    const rawText = await io.readText(absolutePath, signal);
    const { normalized: originalNormalized, bom, originalEnding, fileHashes: originalHashes, hadUtf8DecodeErrors, } = await normFromText({
        absolutePath,
        rawText,
        displayPath: path,
        signal,
        maxLines: MAX_HASH_LINES,
        store: hashStore,
        noPersist: options?.noPersist,
    });
    const sessionKey = options?.sessionKey ?? sessionKeyFor(undefined);
    const served = await loadServed(sessionKey, absolutePath);
    const policy = options?.noPersist === true ? 'preview' : 'live';
    const applied = await applyOne({
        content: originalNormalized,
        hashes: originalHashes,
        served,
        removeFrom: params.remove_from,
        removeTo: params.remove_to,
        replacementText: params.replacement_text,
        absolutePath,
        displayPath: path,
        signal,
        warnings: editWarnings,
        store: hashStore,
        persist: options?.noPersist !== true,
        edit,
    }, async (error) => {
        if (error instanceof AnchorMismatchError ||
            error instanceof ServedRejectionError) {
            await recordEchoServes(sessionKey, absolutePath, error.servedRows, policy, originalHashes.length);
        }
        throw error;
    });
    const result = applied.result;
    const isNoop = applied.noop;
    const warnings = [...editWarnings, ...(applied.anchorWarnings ?? [])];
    let driftNotice;
    if (options?.noPersist !== true) {
        try {
            driftNotice = await scanDrift({
                sessionKey,
                served,
                resultHashes: applied.hashes,
                resultLines: splitLines(result),
                range: applied.range,
                path: absolutePath,
            });
        }
        catch (error) {
            console.error('Failed to compute drift notice:', error);
        }
    }
    return {
        path,
        absolutePath,
        originalNormalized,
        result,
        bom,
        originalEnding,
        hadUtf8DecodeErrors,
        warnings,
        noopEdit: applied.noopEdit,
        firstChangedLine: applied.firstChangedLine,
        lastChangedLine: applied.lastChangedLine,
        originalHashes,
        resultHashes: applied.hashes,
        totalAddedLines: applied.totalAddedLines,
        totalRemovedLines: applied.totalRemovedLines,
        driftNotice,
        range: applied.range,
    };
}
/** Resolve the display path a caller names against the session cwd. */
export function resolveDisplayPath(path, cwd) {
    return toCwd(path, cwd);
}
/** Snapshot bookkeeping for noop/success results (best-effort). */
export async function snapshotIdFor(io, absolutePath, signal) {
    try {
        return await io.statVersion(absolutePath, signal);
    }
    catch {
        try {
            return (await fileSnap(absolutePath)).snapshotId;
        }
        catch {
            return undefined;
        }
    }
}
export { runFileEdits, resolveMissingPath, persistUndoAndWrite, enforceNoopLoop, collectRemovedHashes, countLineChanges, };
export { buildMetrics, buildNoop, buildChanged, buildBatchResult };
export { genDiff, restoreEndings, toLF, stripBOM };
export { computeDrift, scanDrift };
export { trackNoopPayload, clearNoopLoop, noopPayloadKey };
// --- Deep seam: unified mutation API (one interface, thin adapters) ---
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
export async function execute(opts) {
    const { io, items, sessionKey, signal, exec, sandbox, sandboxPolicy } = opts;
    const fileResult = await applySequence(io, items, { signal, sessionKey });
    const toSection = () => ({
        path: fileResult.displayPath,
        originalNormalized: fileResult.originalNormalized,
        result: fileResult.result,
        originalHashes: fileResult.originalHashes,
        resultHashes: fileResult.resultHashes,
        warnings: fileResult.warnings,
        driftNotice: fileResult.driftNotice,
        appliedCount: fileResult.appliedCount,
        noopCount: fileResult.noopCount,
        totalAddedLines: fileResult.totalAddedLines,
        totalRemovedLines: fileResult.totalRemovedLines,
    });
    const recordIfNeeded = async (built) => {
        if (built.details.servedRows && built.details.servedRows.length > 0) {
            const entry = built.details.servedByPath?.[0];
            if (entry) {
                await recordServedTruncated(sessionKey, fileResult.absolutePath, entry.servedRows, splitLines(fileResult.result).length, fileResult.range.startLine - 1);
            }
        }
    };
    const isSingleCall = items.length === 1 && fileResult.appliedCount + fileResult.noopCount === 1;
    if (isSingleCall) {
        if (fileResult.appliedCount === 0) {
            const built = buildBatchResult([toSection()]);
            await recordIfNeeded(built);
            return built.content[0].text;
        }
        await commit({
            io,
            files: [
                {
                    absolutePath: fileResult.absolutePath,
                    displayPath: fileResult.displayPath,
                    originalNormalized: fileResult.originalNormalized,
                    bom: fileResult.bom,
                    originalEnding: fileResult.originalEnding,
                    originalHashes: fileResult.originalHashes,
                    result: fileResult.result,
                },
            ],
            exec,
            sandbox,
            sandboxPolicy,
            signal,
            undoUnavailableMessage: (displayPath) => `[E_UNDO_UNAVAILABLE] Cannot persist undo history to the hash store; the edit was NOT applied and ${displayPath} is unchanged. Retry the edit, or use write if the store cannot be recovered.`,
            restoreUnwrittenUndos: true,
        });
        const built = buildBatchResult([toSection()]);
        await recordIfNeeded(built);
        return built.content[0].text;
    }
    if (fileResult.appliedCount === 0 && fileResult.noopCount > 0) {
        // all noops — no commit
    }
    else if (fileResult.appliedCount > 0) {
        await commit({
            io,
            files: [
                {
                    absolutePath: fileResult.absolutePath,
                    displayPath: fileResult.displayPath,
                    originalNormalized: fileResult.originalNormalized,
                    bom: fileResult.bom,
                    originalEnding: fileResult.originalEnding,
                    originalHashes: fileResult.originalHashes,
                    result: fileResult.result,
                },
            ],
            exec,
            sandbox,
            sandboxPolicy,
            signal,
            undoUnavailableMessage: () => "[E_UNDO_UNAVAILABLE] Cannot persist undo history to the hash store; the batch was NOT applied and no file was written. Retry the batch, or use write if the store cannot be recovered.",
            restoreUnwrittenUndos: false,
        });
    }
    const built = buildBatchResult([toSection()]);
    await recordIfNeeded(built);
    return built.content[0].text;
}
/** Apply a single edit — owns read→normalize→loadServed→applyOne→stableRehash→drift. */
export async function applySingle(io, params, cwd, opts) {
    return execPipeline(io, params, cwd, opts);
}
/** Apply a per-file sequence (batch's group) — owns the loop + unionRange + counters. */
export async function applySequence(io, items, ctx) {
    return runFileEdits(io, items, ctx);
}
/** Commit the transaction — owns persist-undo → write → restore. */
export async function commit(opts) {
    return persistUndoAndWrite({
        io: opts.io,
        files: opts.files,
        exec: opts.exec,
        sandbox: opts.sandbox,
        sandboxPolicy: opts.sandboxPolicy,
        signal: opts.signal,
        undoUnavailableMessage: opts.undoUnavailableMessage,
        restoreUnwrittenUndos: opts.restoreUnwrittenUndos,
    });
}
