/**
 * The sandbox-escalation API for the hashline mutating tools, mirroring
 * `@deepseek-ai/dsh-tool-fs`'s `FsSandboxController` (same vocabulary, same
 * fail-closed approval sequence, shared `@deepseek-ai/dsh-sandbox` pieces) so
 * `edit`/`batch_edit`/`undo_last_edit` escalate exactly like the built-in
 * `write`/`edit` — and, critically, stamp the per-call policy with the SESSION
 * workspace root. Without the policy the sandbox backend falls back to the
 * deployment default root, so an edit inside the session workspace is denied
 * under `workspace-write` even though the built-in `write` succeeds there.
 * @module dsh-better-edit/sandbox
 */
import type { Context } from "@deepseek-ai/cordis";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
/** The two escalation arguments a mutating tool may carry (advertised only under a confining backend). */
export interface FsEscalationArgs {
    sandbox_permissions?: string;
    justification?: string;
}
/** The schema fields for the escalation arguments, spread into a tool's `parameters` when a confining backend is mounted. */
export interface EscalationSchemaFields {
    sandbox_permissions: {
        type: "string";
        enum: string[];
        description: string;
    };
    justification: {
        type: "string";
        description: string;
    };
}
/**
 * The filesystem escalation API: advertisement gating, per-call policy
 * resolution, the one-approved wider retry, and denial-marker mapping. A pure
 * product of `ctx` at plugin apply time.
 */
export declare class FsSandboxController {
    private readonly ctx;
    /** The escalation targets this composition advertises (`[]` when no confining backend is mounted). */
    readonly escalationModes: readonly SandboxMode[];
    /** Shared per-session policy resolver, required by a confining backend. */
    private readonly policy;
    constructor(ctx: Context);
    /**
     * The escalation schema fields for a mutating tool's `parameters`. Call it
     * only under a confining backend (guard on {@link escalationModes}); the
     * enum pins the closed target vocabulary, the strict-wider check happens
     * per call at execution.
     */
    schemaFields(): EscalationSchemaFields;
    /**
     * The policy to stamp onto this mutation: an approved escalation grant (a
     * strictly wider retry resolved through `ctx.approval` before anything
     * executes), else the session's standing mode. The calling session's cwd is
     * always carried as the workspace root, so `workspace-write` allows writes
     * inside the session workspace.
     * @param toolName - the mutating tool's name, for the approval audit trail.
     * @param args - the call's escalation arguments.
     * @param exec - the tool-execution context (agent, callId, signal).
     * @returns the policy to pass to the mutation, or undefined for an
     *   unsandboxed backend.
     */
    resolvePolicy(toolName: string, args: FsEscalationArgs, exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined>;
    /**
     * Map a thrown provider error for the model: a `FS_SANDBOX_DENIED` becomes
     * the shared `[sandbox: …]` denial marker plus the same-turn escalation
     * hint, keeping the structured code. Any other error passes through.
     */
    mapError(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown;
}
