/**
 * The `ctx.subagents` / `ctx.workflowEngine` seam surfaces, as this
 * presentation plugin consumes them — STRUCTURAL MIRRORS of the host-plane
 * Service Definitions (`@deepseek-ai/dsh-subagent` and
 * `@deepseek-ai/dsh-workflow`, 0.1.0-rc.6), which are deliberately NOT in
 * this package's dependency graph: both are host-plane root-realm singletons
 * (the preset delegates their registration to the host composition), and
 * importing either package here would pull a host-plane capability into an
 * agent-plane plugin for typing alone.
 *
 * The delegation bridges (`agent`, `agent_message`, `agent_workflow`) read
 * these surfaces with the untyped `ctx.get('subagents')` /
 * `ctx.get('workflowEngine')` escape hatch (the same optional-capability
 * pattern upstream's child-agent.ts uses for `agentPresets`/`sandboxPolicy`),
 * and this file types exactly the operations those bridges call — no more.
 *
 * Host-plane note (v0.1.8): the row mounts on the HOST plane (the bundle
 * patch's `insert`), so `ctx.subagents` / `ctx.workflowEngine` — host-plane
 * root-realm singletons — are reachable from the presentation layer without
 * any preset realm. The bridge callbacks therefore live in THIS presentation
 * layer: the one place that can simultaneously reach the services (outward),
 * the calling `Agent` (`exec.agent`), and the run's abort signal.
 *
 * Wave5 (v0.1.8e+): the bridges now call the SERVICE layer directly — the
 * upstream delegation tools are masked from the model surface, and the
 * service's own authorization (authorizeLineage / authorizeReporter) is the
 * deployment enforcement, preserved verbatim. The earlier "downlink goes
 * through the TOOL layer" split (ADR-0001) is gone for spawn/followup/
 * interrupt/workflow; `reportFrom` remains the one direction no tool covers.
 * @module dashr-repl/subagents-surface
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * The subset of upstream `SubagentReportOptions` the bridge constructs.
 * `delivery` is FIXED at `'wakeup'` (the upstream default): it is a parent
 * scheduling policy, deliberately not exposed to the model.
 */
export interface DASHRSubagentReportOptions {
  /** Already-resolved parent scheduling policy (always `'wakeup'` from this bridge). */
  readonly delivery: 'wakeup'
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}

/**
 * The subset of upstream `SubagentFollowupOptions` the bridge constructs.
 * `source` is the durable attribution the native `send_message` tool stamps
 * (`coordinator` / `relay`); it grants no authority — the live `parent`
 * agent is the authority credential.
 */
export interface DASHRSubagentFollowupOptions {
  /** Durable attribution retained on the delivered message. */
  readonly source: {
    readonly kind: 'coordinator'
    readonly form: 'relay'
    readonly senderSessionId: SessionId
  }
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}

/**
 * The interrupt authority the bridge constructs, verbatim from the native
 * `interrupt_agent` tool: the exact live calling agent IS the ancestor whose
 * recorded lineage must contain the target (`kind: 'ancestor'`).
 */
export interface DASHRSubagentInterruptAuthority {
  readonly kind: 'ancestor'
  readonly agent: Agent
}

/**
 * The delegation fields the `agent` bridge builds, verbatim in field shape
 * from the native `dsh-tool-subagent` execute: model inputs (`label` from
 * `description`, `prompt`), the spawning `parent`, and `maxDepth` fixed at
 * the native default (`3`). Deployment-only fields (`agentOptions`,
 * `persona`, `toolFilter`) stay omitted — the bridge exposes none of them to
 * the model, and the native default for each is "absent".
 */
export interface DASHRSubagentDelegation {
  /** Short display label (the child's persisted creation label). */
  readonly label: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /** The spawning agent (workspace/lineage/depth source). */
  readonly parent: Agent
  /** Absolute delegation-depth cap (native default `3`). */
  readonly maxDepth: number
}

/** A one-shot start request: the delegation plus caller cancellation. */
export interface DASHRSubagentStartRequest extends DASHRSubagentDelegation {
  /** Cancellation signal from the spawning context. */
  readonly signal: AbortSignal
}

/** The terminal outcome of a one-shot subagent run, as the bridge reads it. */
export interface DASHRSubagentResult {
  /** The child's final assistant output content blocks. */
  readonly output: ContentBlock[]
  /** Why the run ended (`'completed'` means `output` is complete). */
  readonly stopReason: string
}

/** ONE-SHOT child handle the bridge consumes: await result, then dispose. */
export interface DASHRSubagentRun {
  /** Parent-scoped run id. */
  readonly id: SessionId
  /** Resolves with the child's terminal result (never rejects on child failure). */
  readonly result: Promise<DASHRSubagentResult>
  /** Cancel remaining work and release resources. */
  dispose(): Promise<void>
}

/** What the `agent` bridge asks for when starting a continuable child. */
export interface DASHRContinuableStartSpec {
  /** The `ctx.subagents` provider name (`spawn` for delegate, `fork` for fork). */
  readonly provider: string
  /** The initial delegation's short label, persisted as the child's creation label. */
  readonly label: string
  /** The delegation request (label/prompt/parent/maxDepth). */
  readonly request: DASHRSubagentDelegation
  /** Caller cancellation, owning the operation until inbox acceptance. */
  readonly signal: AbortSignal
}

/** Identities returned once a continuable child accepted its initial prompt. */
export interface DASHRContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
}

/**
 * The `ctx.subagents` service surface the delegation bridges call: one-shot
 * `start`, continuable `startContinuable`, the `followup` downlink, the
 * `interrupt` stop request, and the `reportFrom` uplink. Each is the same
 * call the native delegation/control tools make, so the service's own
 * authorization is preserved verbatim.
 */
export interface DASHRSubagentsSurface {
  /** Establish a published one-shot child on the named provider. */
  start(provider: string, request: DASHRSubagentStartRequest): Promise<DASHRSubagentRun>
  /** Establish a durable continuable child and deliver its initial prompt. */
  startContinuable(spec: DASHRContinuableStartSpec): Promise<DASHRContinuableStart>
  /** Deliver one later message to a continuable child as its next FIFO turn. */
  followup(parent: Agent, childId: SessionId, content: ContentBlock[], options: DASHRSubagentFollowupOptions): Promise<MessageId>
  /** Interrupt one live continuable child's current turn under the live ancestor. */
  interrupt(targetSessionId: SessionId, authority: DASHRSubagentInterruptAuthority): void
  /** Report content up to this child's direct parent. */
  reportFrom(child: Agent, content: ContentBlock[], options: DASHRSubagentReportOptions): Promise<MessageId>
}

/** The workflow identity block (`meta`) the `agent_workflow` bridge passes through. */
export interface DASHRWorkflowMeta {
  readonly name: string
  readonly description: string
  readonly [key: string]: unknown
}

/** What the `agent_workflow` bridge asks for when starting a workflow run. */
export interface DASHRWorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  readonly script: string
  /** The workflow's identity block, as plain JSON data. */
  readonly meta: DASHRWorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  readonly args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  readonly subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  readonly maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  readonly parent: Agent
  /** Cancels the run when aborted. */
  readonly signal?: AbortSignal
}

/** The outcome resolved by a live workflow run. */
export interface DASHRWorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  readonly value: unknown
  /** Why the run settled. */
  readonly stopReason: 'completed' | 'cancelled' | 'error'
  /** The failure message (present iff `stopReason` is not `completed`). */
  readonly error?: string
  /** How many `agent()` calls the run accepted over its whole lifetime. */
  readonly agentsStarted: number
}

/** Holder-owned live workflow the bridge consumes. */
export interface DASHRWorkflowRun {
  readonly id: string
  readonly result: Promise<DASHRWorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}

/** The `ctx.workflowEngine` service surface the `agent_workflow` bridge calls. */
export interface DASHRWorkflowEngine {
  start(request: DASHRWorkflowStartRequest): DASHRWorkflowRun
}
