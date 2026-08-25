/**
 * The shared read-and-serve operation — now a thin wrapper over FileView.
 *
 * FileView owns normalize → hash → render → truncate → served selection.
 * This module only adds the persistence seam: recordServed + clearDriftReported
 * + UTF-8 rewrite note. Used by the `read` tool and by the write auto-read
 * hook, so the model is always shown fresh anchors the same way.
 * @module dsh-better-edit/read-and-serve
 */
import { abortIf } from "./utils.js";
import { readView } from "./file-view.js";
import { recordServed, clearDriftReported } from "./session-view.js";
/** Appended when the file had non-UTF-8 bytes; editing rewrites it as UTF-8. */
export const UTF8_REWRITE_NOTE = "[Non-UTF-8 bytes shown as U+FFFD; editing rewrites the file as UTF-8.]";
/**
 * Perform one read-and-serve: normalize the file at `rawPath`, render its
 * hashline preview, record the shown rows as served for the session, and clear
 * the reported-drift marks (a fresh read resets them). The returned text
 * carries the UTF-8 rewrite note when the file had decode errors.
 *
 * Emits nothing on the fs-observation gate — callers that need the
 * observation recorded (the `read` tool) do that themselves with their exec
 * context.
 */
export async function readAndServe(io, rawPath, cwd, options) {
    const { sessionKey, signal } = options;
    abortIf(signal);
    const view = await readView(io, rawPath, cwd, {
        offset: options.offset,
        limit: options.limit,
        signal,
    });
    if (view.served.length > 0) {
        await recordServed(sessionKey, view.absolutePath, view.served, view.hashes.length);
    }
    await clearDriftReported(sessionKey, view.absolutePath);
    const text = view.hadUtf8DecodeErrors
        ? `${view.text}\n\n${UTF8_REWRITE_NOTE}`
        : view.text;
    return {
        text,
        served: view.served,
        hadUtf8DecodeErrors: view.hadUtf8DecodeErrors,
        absolutePath: view.absolutePath,
    };
}
