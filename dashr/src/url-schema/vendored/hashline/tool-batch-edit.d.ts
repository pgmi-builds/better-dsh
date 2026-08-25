/**
 * The dsh `batch_edit` tool: several hash-anchored edits in one all-or-nothing
 * call. Items targeting the same file are applied in order against the served
 * state; any failing item rejects the whole batch with nothing written, and
 * the failing item's current range is echoed as fresh serves. The per-file
 * sequencing and the persist-undo → write → restore transaction live in the
 * edit engine; this module owns request preparation and result rendering.
 * @module dsh-better-edit/tool-batch-edit
 */
import type { Context } from "@deepseek-ai/cordis";
import type { FileIO } from "./fs-bridge.js";
import type { FsSandboxController } from "./sandbox.js";
/**
 * Register the `batch_edit` tool on the calling agent's scope.
 * @param _rootCtx - host context.
 * @param agentCtx - the agent's scoped context (own scope layer).
 * @param io - the filesystem bridge.
 * @param sandbox - the sandbox-escalation controller.
 * @returns the exact disposer that unregisters the tool.
 */
export declare function buildBatchEditTool(io: FileIO, sandbox: FsSandboxController): import("@deepseek-ai/dsh-tools").ToolDefinition;
/**
 * Register the hashline tool on the calling agent’s scope (own layer).
 */
export declare function registerBatchEditTool(_rootCtx: Context, agentCtx: Context, io: FileIO, sandbox: FsSandboxController): () => void;
