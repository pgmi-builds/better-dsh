/**
 * Auto-read after `write`: when the built-in `write` tool succeeds, this scoped
 * `tools/post-execute` listener re-reads the written file and appends a fresh
 * hashline-anchored preview to the model-facing content, so the model gets new
 * anchors without an explicit read call (mirroring pi-hashline-edit-lsz).
 * @module dsh-better-edit/write-hook
 */
import type { Context } from '@deepseek-ai/cordis';
import type { FileIO } from './fs-bridge.js';
/**
 * Register the post-write auto-read listener on the calling agent's scope.
 * Replaces the result content (never the canonical value) with the original
 * content plus the hashline preview; any failure falls back to the untouched
 * decision so a broken auto-read never breaks the write.
 * @param rootCtx - host context for diagnostics.
 * @param agentCtx - the agent's scoped context; the listener receives only
 *   this agent's tool results.
 * @param io - the filesystem bridge.
 * @returns the exact disposer that unregisters the listener.
 */
export declare function registerWriteHook(rootCtx: Context, agentCtx: Context, io: FileIO): () => void;
