/**
 * The dsh `read` tool: hash-anchored reads (`HASH│content` rows) that shadow
 * the built-in `read` on the agent's own scope layer. Every shown row is
 * recorded as served, so a later `edit` can verify the model was actually
 * shown the lines it targets.
 * @module dsh-better-edit/tool-read
 */
import type { Context } from "@deepseek-ai/cordis";
import type { FileIO } from "./fs-bridge.js";
/**
 * Register the hash-anchored `read` tool on the calling agent's scope.
 * @param _rootCtx - host context.
 * @param agentCtx - the agent's scoped context (own scope layer).
 * @param io - the filesystem bridge.
 * @returns the exact disposer that unregisters the tool.
 */
export declare function buildReadTool(io: FileIO): import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Register the hashline tool on the calling agent’s scope (own layer).
 */
export declare function registerReadTool(_rootCtx: Context, agentCtx: Context, io: FileIO): () => void;
