/**
 * dsh-better-edit — hash-anchored read/edit/batch_edit/undo_last_edit for
 * DeepSeek Harness, a dsh port of pi-hashline-edit-lsz.
 *
 * Cordis host-plane plugin (mounted by the bundle's cordis.patch.yml). On
 * `agent/session-start` it registers the hashline tools and prompt sections on
 * the AGENT's own scope layer, so they shadow the preset's built-in `read` /
 * `edit` for that agent (nearest layer wins in dsh's tool registry) and unwind
 * automatically when the agent is disposed. The built-in `write` stays in
 * place; a scoped `tools/post-execute` listener appends the fresh hashline
 * preview to write results.
 *
 * The four `tool:*` guidance sections resolve per agent preset from override
 * files in the shared home (see `src/guidance.ts`); deployments without the
 * `agentPresets` service keep the compiled defaults unchanged.
 * @module dsh-better-edit
 */
import type { Context } from "@deepseek-ai/cordis";
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "dsh-better-edit";
/**
 * Services the plugin's per-agent install touches: `tools` and `systemPrompt`
 * for the shadow registrations, `fs` for the IO bridge. Cordis refuses
 * property access to an undeclared service ("cannot get property X without
 * inject"), so these MUST be listed or every agent install fails at
 * session-start.
 */
export declare const inject: string[];
/** One per-agent registration bundle, disposed with the agent. */
interface AgentTools {
    dispose(): void;
}
/** Mount the bundle: initialize the store, then install tools per agent. */
export declare function apply(rootCtx: Context): void;
export type { AgentTools };
