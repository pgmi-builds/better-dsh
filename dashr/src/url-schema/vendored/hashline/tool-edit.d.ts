/**
 * The dsh `edit` tool: hash-anchored literal range edits that shadow the
 * built-in `edit` on the agent's own scope layer. Now the sole mutation tool
 * (batch_edit removed, ADR-0007): payload is { path: string|null, edits: [[remove_from,remove_to,replacement_text],...] }
 * single-file atomic batch, null path inference via anchors.
 * @module dsh-better-edit/tool-edit
 */
import type { Context } from "@deepseek-ai/cordis";
import type { FileIO } from "./fs-bridge.js";
import type { FsSandboxController } from "./sandbox.js";
export declare function buildEditTool(io: FileIO, sandbox: FsSandboxController): import("@deepseek-ai/dsh-tools").ToolDefinition;
export declare function registerEditTool(_rootCtx: Context, agentCtx: Context, io: FileIO, sandbox: FsSandboxController): () => void;
