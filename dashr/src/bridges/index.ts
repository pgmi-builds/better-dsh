/**
 * The DASHR delegation bridges: `agent`, `agent_message`, `agent_workflow`.
 *
 * Wave5 (v0.1.8e+): the upstream delegation tools are masked from the model
 * surface (registry-level `restrict({deny})`), and these three flat-name
 * bridge tools are the model's ONLY reachable delegation surface. Each bridge
 * is a thin adapter over the host-plane service layer (`ctx.subagents` /
 * `ctx.workflowEngine`) — the same calls the native delegation/control/
 * workflow tools make — so native parameter semantics are unchanged and the
 * service's own authorization (authorizeLineage / authorizeReporter) is the
 * deployment enforcement, preserved verbatim. The bridges do NOT re-invent
 * the delegation policy; they only route.
 *
 * Bridge → native mapping (the deny list keeps the native names masked, so no
 * name collision exists):
 * - `agent`            ← `subagent` (provider `spawn`) + `subagent_fork` (provider `fork`)
 * - `agent_message`    ← `send_message` (followup) + `report` (reportFrom) + `interrupt_agent` (interrupt)
 * - `agent_workflow`   ← `workflow` (script) + `ralph` (rfc loop)
 *
 * Each bridge is a flat-name callable returned by {@link createAgentBridgeBindings};
 * the presentation binds them as members of the `tool` namespace beside the
 * auto-mapped registry tools (the post-restrict visible set), and declares
 * their model-facing shapes via {@link AGENT_BRIDGE_SCHEMAS}.
 * @module dashr-repl/bridges
 */

import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { DASHRSubagentsSurface, DASHRSubagentDelegation } from '../subagents-surface.ts'
import type { ReplBindingFunction, ReplJsonValue } from '../runtime-surface.ts'
import type { DASHRSdkSchema } from '../py-sdk.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Unwrap one bridge-tool {@link parseReplCall} packaging into its single
 * arguments object. Same one-object contract as a registry tool, but bridge
 * tools return a structured `{ error }` value instead of throwing, and a call
 * with no arguments reads as an empty object. Keyword and multi-positional
 * forms are rejected.
 */
function flatBridgeToolArgs(rawArgs: unknown): { ok: true, args: Record<string, unknown> } | { ok: false, error: string } {
  // The `tool.*` member proxy sends the single positional arguments object
  // DIRECTLY (no {args, kwargs} wrapper — that was the flat bare-callable
  // shape). No arguments reads as an empty object; a multi-positional list
  // or a bare value is rejected.
  if (rawArgs === undefined || rawArgs === null) return { ok: true, args: {} }
  if (Array.isArray(rawArgs)) {
    return { ok: false, error: 'tools take exactly one positional arguments object — call e.g. tool.name({"field": value})' }
  }
  if (typeof rawArgs !== 'object') {
    return { ok: false, error: 'tools take one positional arguments object, not a bare value — call e.g. tool.name({"field": value})' }
  }
  return { ok: true, args: rawArgs as Record<string, unknown> }
}

/** Reject unexpected keys on one bridge call's arguments object. */
function rejectUnknownKeys(tool: string, args: Record<string, unknown>, allowed: readonly string[]): { error: string } | undefined {
  const unknownKeys = Object.keys(args).filter(key => !allowed.includes(key))
  if (unknownKeys.length > 0) return { error: `${tool}() got unexpected key(s): ${unknownKeys.join(', ')}` }
  return undefined
}

/** Human-readable reason for one non-`completed` subagent stop (native `stopReasonError`). */
function stopReasonError(reason: string): string {
  switch (reason) {
    case 'completed': return 'subagent run completed'
    case 'aborted': return 'subagent run was cancelled'
    case 'error': return 'subagent run failed'
    case 'max-tokens': return 'subagent run hit its token limit before finishing'
    case 'refusal': return 'subagent declined the task'
    default: return `subagent run ended abnormally (${reason})`
  }
}

/** The native `dsh-tool-subagent` default delegation-depth cap (Config default `3`). */
const NATIVE_MAX_DEPTH = 3

/**
 * The model-facing declarations for the three bridge tools, fed to the SAME
 * `renderReplBridgeInstructions` renderer as registry tools so they show one
 * flat `tool.name(args)` surface. The bridge enforces these shapes per call;
 * the schemas here are the model-facing declaration only.
 */
export const AGENT_BRIDGE_SCHEMAS: DASHRSdkSchema[] = [
  {
    name: 'agent',
    description: 'Start a child agent. Runs in the background by default: returns a durable subagent id immediately and keeps the child conversation open for agent_message follow-ups. Set run_in_background false to run a ONE-SHOT child instead — the call waits for the result and the child ends with the run. mode "delegate" (default) starts a fresh child; mode "fork" seeds the child with this agent\'s completed conversation turns.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'A short (3-5 word) description of the delegated task, for display.' },
        prompt: { type: 'string', description: 'The task prompt for the child agent.' },
        run_in_background: { type: 'boolean', description: 'Default true: return a durable subagent id immediately (continuable, agent_message can follow up). Explicit false: one-shot — wait for the child\'s result here.' },
        mode: { type: 'string', description: "'delegate' (default: a fresh child) or 'fork' (a child seeded with this agent's completed conversation turns)." },
      },
      required: ['description', 'prompt'],
      additionalProperties: false,
    },
    output: { type: 'object', properties: {}, additionalProperties: true },
  },
  {
    name: 'agent_message',
    description: 'The single agent-to-agent channel, three ways: receiver "child" delivers a follow-up message down to a child (subagent_id required); receiver "parent" reports up to this agent\'s parent (live continuable children only; a root agent gets a structured UNAUTHORIZED instead); receiver "interrupt" stops a child\'s current turn (target_session_id required).',
    parameters: {
      type: 'object',
      properties: {
        receiver: { type: 'string', description: "'child' (deliver down), 'parent' (report up), or 'interrupt' (stop a child's current turn)." },
        message: { type: 'string', description: "The message text (required for receiver 'child' and 'parent')." },
        subagent_id: { type: 'string', description: "The child's durable id (required when receiver is 'child')." },
        target_session_id: { type: 'string', description: "The target agent's session id to interrupt (required when receiver is 'interrupt')." },
      },
      required: ['receiver'],
      additionalProperties: false,
    },
    output: { type: 'object', properties: {}, additionalProperties: true },
  },
  {
    name: 'agent_workflow',
    description: 'Run a multi-agent orchestration: mode "script" runs a plain-JS orchestration script (script/meta required); mode "rfc" runs the fixed fresh-agent Ralph loop toward one objective (objective required, maxRounds optional).',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: "'script' (default: an orchestration script) or 'rfc' (a fixed fresh-agent Ralph loop)." },
        script: { type: 'string', description: "The plain-JS workflow script body (required when mode is 'script')." },
        meta: { type: 'object', description: "The workflow identity block (required when mode is 'script')." },
        args: { type: 'object', description: 'Optional JSON input exposed to the script as the args global.' },
        objective: { type: 'string', description: "The immutable completion objective for the Ralph loop (required when mode is 'rfc')." },
        maxRounds: { type: 'number', description: 'Optional round cap for the Ralph loop, bounded by the deployment ceiling.' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    output: { type: 'object', properties: {}, additionalProperties: true },
  },
]

/**
 * Build the three bridge callables for one `eval` run, closing over the run's
 * execution context and the use-time resolvers.
 * @param exec - the run's tool-execution context (carries `agent` and `signal`).
 * @param deps - the service resolver (`ctx.subagents`) and the captured
 * native workflow/ralph definitions (the workflowEngine service lives inside
 * the preset's delegation realm — entry-local, invisible to any outside ctx —
 * so the workflow bridge passes through the CAPTURED tool definitions, whose
 * execute closures resolve the engine from inside that realm).
 * @returns the flat-name callables, keyed by their model-facing names.
 */
export function createAgentBridgeBindings(
  exec: ToolRunContext,
  deps: {
    requireSubagents?: () => DASHRSubagentsSurface | undefined
    resolveCapturedWorkflow?: () => ToolDefinition | undefined
    resolveCapturedRalph?: () => ToolDefinition | undefined
  },
): Record<string, ReplBindingFunction> {
  const { requireSubagents, resolveCapturedWorkflow, resolveCapturedRalph } = deps

  const agentCallable: ReplBindingFunction = async (rawArgs): Promise<ReplJsonValue> => {
    const parsed = flatBridgeToolArgs(rawArgs)
    if (!parsed.ok) return { error: parsed.error }
    const a = parsed.args
    const unknown = rejectUnknownKeys('agent', a, ['description', 'prompt', 'run_in_background', 'mode'])
    if (unknown !== undefined) return unknown
    const description = a['description']
    const prompt = a['prompt']
    if (typeof description !== 'string' || description.length === 0) {
      return { error: 'agent() requires {"description": "..."} — a short (3-5 word) display label' }
    }
    if (typeof prompt !== 'string' || prompt.length === 0) {
      return { error: 'agent() requires {"prompt": "..."} — the task for the child agent' }
    }
    const mode = a['mode'] ?? 'delegate'
    if (mode !== 'delegate' && mode !== 'fork') {
      return { error: `agent() unknown mode ${JSON.stringify(mode)}: expected 'delegate' or 'fork'` }
    }
    const provider = mode === 'fork' ? 'fork' : 'spawn'
    if (!exec.agent) {
      return { error: 'agent() requires a calling agent (this run has no agent to delegate from)' }
    }
    const subagents = requireSubagents?.()
    if (!subagents) {
      return { error: 'agent() is unavailable: no ctx.subagents service is mounted in this composition' }
    }
    const delegation: DASHRSubagentDelegation = {
      label: description,
      prompt: [{ type: 'text', text: prompt }],
      parent: exec.agent,
      maxDepth: NATIVE_MAX_DEPTH,
    }
    // Native semantics (the deployed subagent tool is backgroundMode:
    // continuable): run_in_background defaults TRUE — the call returns a
    // durable subagent id immediately and the child conversation stays open
    // for agent_message follow-ups. An explicit false runs a ONE-SHOT child:
    // subagents.start, wait for the result, the child ends with the run.
    const runInBackground = a['run_in_background'] ?? true
    try {
      if (runInBackground) {
        const start = await subagents.startContinuable({
          provider,
          label: description,
          request: delegation,
          signal: exec.signal,
        })
        return { kind: 'continuable', subagentId: start.childId }
      }
      const run = await subagents.start(provider, { ...delegation, signal: exec.signal })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') {
          return { error: `agent() ${stopReasonError(result.stopReason)}` }
        }
        return { kind: 'foreground', runId: run.id, output: result.output as unknown as ReplJsonValue }
      } finally {
        await run.dispose()
      }
    } catch (error: unknown) {
      return { error: `agent() failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const agentMessageCallable: ReplBindingFunction = async (rawArgs): Promise<ReplJsonValue> => {
    const parsed = flatBridgeToolArgs(rawArgs)
    if (!parsed.ok) return { error: parsed.error }
    const a = parsed.args
    const unknown = rejectUnknownKeys('agent_message', a, ['receiver', 'message', 'subagent_id', 'target_session_id'])
    if (unknown !== undefined) return unknown
    const receiver = a['receiver']
    if (typeof receiver !== 'string') {
      return { error: 'agent_message() requires {"receiver": "child" | "parent" | "interrupt"}' }
    }
    const message = a['message']

    if (receiver === 'child') {
      if (typeof message !== 'string') {
        return { error: 'agent_message() receiver "child" requires {"message": "..."}' }
      }
      const subagentId = a['subagent_id']
      if (typeof subagentId !== 'string' || subagentId.length === 0) {
        return { error: 'agent_message() receiver "child" requires {"subagent_id": "..."} — the durable subagent id a spawn returned' }
      }
      if (!exec.agent) {
        return { error: "agent_message(receiver='child') requires an agent session (this run has no agent to deliver from)" }
      }
      const subagents = requireSubagents?.()
      if (!subagents) {
        return { error: "agent_message(receiver='child') is unavailable: no ctx.subagents service is mounted in this composition" }
      }
      try {
        const messageId = await subagents.followup(exec.agent, subagentId as SessionId, [{ type: 'text', text: message }], {
          source: { kind: 'coordinator', form: 'relay', senderSessionId: exec.agent.id },
          signal: exec.signal,
        })
        return { messageId }
      } catch (error: unknown) {
        return { error: `agent_message(receiver='child') failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    if (receiver === 'parent') {
      if (typeof message !== 'string') {
        return { error: 'agent_message() receiver "parent" requires {"message": "..."}' }
      }
      if (!exec.agent) {
        return { error: "agent_message(receiver='parent') requires an agent session (this run has no agent to report from)" }
      }
      const subagents = requireSubagents?.()
      if (!subagents) {
        return { error: "agent_message(receiver='parent') is unavailable: no ctx.subagents service is mounted in this composition" }
      }
      try {
        const messageId = await subagents.reportFrom(exec.agent, [{ type: 'text', text: message }], { delivery: 'wakeup', signal: exec.signal })
        return { delivered: true, message_id: messageId }
      } catch (error: unknown) {
        if ((error as { code?: unknown }).code === 'UNAUTHORIZED') {
          return { error: `agent_message(receiver='parent') rejected: only a live continuable child agent can report to its parent (a root agent has none) — ${error instanceof Error ? error.message : String(error)}` }
        }
        return { error: `agent_message(receiver='parent') failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    if (receiver === 'interrupt') {
      const targetSessionId = a['target_session_id']
      if (typeof targetSessionId !== 'string' || targetSessionId.length === 0) {
        return { error: "agent_message() receiver 'interrupt' requires {\"target_session_id\": \"...\"} — the target agent's session id" }
      }
      if (!exec.agent) {
        return { error: "agent_message(receiver='interrupt') requires a calling agent (this run has no agent to authorize the interrupt)" }
      }
      const subagents = requireSubagents?.()
      if (!subagents) {
        return { error: "agent_message(receiver='interrupt') is unavailable: no ctx.subagents service is mounted in this composition" }
      }
      try {
        // The native interrupt_agent authority: the exact live caller IS the
        // ancestor whose recorded lineage must contain the target.
        subagents.interrupt(targetSessionId as SessionId, { kind: 'ancestor', agent: exec.agent })
        return { accepted: true }
      } catch (error: unknown) {
        return { error: `agent_message(receiver='interrupt') failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    return { error: `agent_message() unknown receiver ${JSON.stringify(receiver)}: expected 'child', 'parent', or 'interrupt'` }
  }

  const agentWorkflowCallable: ReplBindingFunction = async (rawArgs): Promise<ReplJsonValue> => {
    const parsed = flatBridgeToolArgs(rawArgs)
    if (!parsed.ok) return { error: parsed.error }
    const a = parsed.args
    const unknown = rejectUnknownKeys('agent_workflow', a, ['mode', 'script', 'meta', 'args', 'objective', 'maxRounds'])
    if (unknown !== undefined) return unknown
    const mode = a['mode'] ?? 'script'
    if (mode !== 'script' && mode !== 'rfc') {
      return { error: `agent_workflow() unknown mode ${JSON.stringify(mode)}: expected 'script' or 'rfc'` }
    }
    if (!exec.agent) {
      return { error: 'agent_workflow() requires a calling agent (this run has no agent to attribute the workflow to)' }
    }
    if (mode === 'script') {
      if (typeof a['script'] !== 'string' || a['script'].length === 0) {
        return { error: 'agent_workflow() mode "script" requires {"script": "..."} — the plain-JS workflow script body' }
      }
      if (typeof a['meta'] !== 'object' || a['meta'] === null || Array.isArray(a['meta'])) {
        return { error: 'agent_workflow() mode "script" requires {"meta": {...}} — the workflow identity block' }
      }
    } else if (typeof a['objective'] !== 'string' || a['objective'].trim().length === 0) {
      return { error: 'agent_workflow() mode "rfc" requires {"objective": "..."} — the immutable completion objective' }
    }
    // The workflowEngine service is entry-local to the preset's delegation
    // realm — invisible to this bridge's ctx — so the bridge passes through
    // the CAPTURED native definitions; their execute closures run inside the
    // realm and resolve the engine natively.
    const captured = mode === 'script' ? resolveCapturedWorkflow?.() : resolveCapturedRalph?.()
    if (captured === undefined) {
      return { error: `agent_workflow() is unavailable: the native ${mode === 'script' ? 'workflow' : 'ralph'} tool is not registered in this composition` }
    }
    try {
      const result = mode === 'script'
        ? await captured.execute({
          script: a['script'],
          meta: a['meta'],
          ...(a['args'] !== undefined ? { args: a['args'] } : {}),
        }, exec)
        : await captured.execute({
          objective: a['objective'],
          ...(a['maxRounds'] !== undefined ? { maxRounds: a['maxRounds'] } : {}),
        }, exec)
      return result as ReplJsonValue
    } catch (error: unknown) {
      return { error: `agent_workflow() failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return {
    agent: agentCallable,
    agent_message: agentMessageCallable,
    agent_workflow: agentWorkflowCallable,
  }
}
