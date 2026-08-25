/**
 * The dsh `undo_last_edit` tool: reverts the last hashline edit on a file,
 * only when the file still matches the stored post-edit content — a later
 * external write clears the history instead of being overwritten.
 * @module dsh-better-edit/tool-undo
 */
import type { Context } from "@deepseek-ai/cordis";
import type { FileIO } from "./fs-bridge.js";
import type { FsSandboxController } from "./sandbox.js";
/**
 * Register the `undo_last_edit` tool on the calling agent's scope.
 * @param _rootCtx - host context.
 * @param agentCtx - the agent's scoped context (own scope layer).
 * @param io - the filesystem bridge.
 * @returns the exact disposer that unregisters the tool.
 */
export declare function buildUndoTool(io: FileIO, sandbox: FsSandboxController): import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Register the hashline tool on the calling agent’s scope (own layer).
 */
export declare function registerUndoTool(_rootCtx: Context, agentCtx: Context, io: FileIO, sandbox: FsSandboxController): () => void;
