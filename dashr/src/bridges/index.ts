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
 * Each bridge is a REAL registry tool (same host layer as `eval`), built by
 * {@link createAgentBridgeTools}: the registry projection is the single
 * source for the wire tools array, the tool catalog, and the REPL `tool.*`
 * bindings (via the mechanical auto-bridge).
 * @module dashr-repl/bridges
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ObjectValueSchemaSpec, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  DASHRSubagentsSurface,
  DASHRSubagentDelegation,
  DASHRWorkflowEngine,
  DASHRWorkflowMeta,
  DASHRWorkflowRun,
} from '../subagents-surface.ts'
import type { ReplJsonValue } from '../runtime-surface.ts'
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

/** The fixed Ralph orchestration (deployment-owned, copied verbatim from `@deepseek-ai/dsh-tool-ralph`). */
const RALPH_META: DASHRWorkflowMeta = {
  name: 'ralph-loop',
  description: 'Iterate toward one objective with a fresh child and bounded structured handoff per round.',
  phases: [{ title: 'Fresh-agent rounds', detail: 'One clean child context per Ralph round.' }],
}

/** Native Ralph defaults (Config defaults). */
const RALPH_SUBAGENT_PROVIDER = 'spawn'
const RALPH_MAX_ROUNDS = 256
const RALPH_MAX_HANDOFF_CHARS = 16_384

/** The fixed, deployment-owned Ralph script, copied verbatim from `@deepseek-ai/dsh-tool-ralph`. */
const RALPH_SCRIPT = String.raw`
const reportSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['continue', 'complete', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    nextSteps: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'nextSteps', 'blocker'],
  additionalProperties: false,
}

function normalizedText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function normalizedList(value) {
  return Array.isArray(value) && value.every(normalizedText)
}

function validateReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Ralph child returned no structured round report')
  }
  if (!normalizedText(report.summary)) {
    throw new Error('Ralph round report summary must be non-empty and normalized')
  }
  if (!normalizedList(report.evidence) || !normalizedList(report.nextSteps)) {
    throw new Error('Ralph round report evidence and nextSteps must contain only non-empty normalized strings')
  }
  if (typeof report.blocker !== 'string' || report.blocker !== report.blocker.trim()) {
    throw new Error('Ralph round report blocker must be a normalized string')
  }
  switch (report.status) {
    case 'continue':
      if (report.nextSteps.length === 0 || report.blocker !== '') {
        throw new Error('a continuing Ralph report needs nextSteps and an empty blocker')
      }
      break
    case 'complete':
      if (report.evidence.length === 0 || report.nextSteps.length !== 0 || report.blocker !== '') {
        throw new Error('a complete Ralph report needs evidence, no nextSteps, and an empty blocker')
      }
      break
    case 'blocked':
      if (!normalizedText(report.blocker)) {
        throw new Error('a blocked Ralph report needs a concrete blocker')
      }
      break
    default:
      throw new Error('Ralph round report status is invalid')
  }
  const serialized = JSON.stringify(report)
  if (serialized.length > args.maxHandoffChars) {
    throw new Error('Ralph round report exceeds maxHandoffChars (' + serialized.length + ' > ' + args.maxHandoffChars + ')')
  }
  return report
}

let previous
phase('Fresh-agent rounds')
for (let round = 1; round <= args.maxRounds; round += 1) {
  const prior = previous === undefined ? '(none — this is the first round)' : JSON.stringify(previous)
  const prompt = [
    'You are one fresh worker in a foreground Ralph loop. You receive no parent conversation and no prior child session. Do not call the ralph tool: this round already is its worker.',
    'Immutable objective:\n' + args.objective,
    'Ralph round: ' + round + ' of ' + args.maxRounds + '.',
    'The shared workspace and its current working tree are the long-term memory and source of truth. Inspect them before acting, preserve existing work, perform concrete in-scope work, and verify what you change. Treat the previous report only as a bounded handoff; confirm it against the workspace.',
    'Previous structured handoff:\n' + prior,
    'Return one report with exact normalized strings. Use status continue with at least one nextSteps entry while useful work remains; complete only with concrete evidence and no nextSteps; blocked only when no meaningful progress is possible without human input or an external-state change. blocker must be empty unless blocked.',
  ].join('\n\n')
  const rawReport = await agent(prompt, {
    label: 'Ralph round ' + round,
    phase: 'Fresh-agent rounds',
    schema: reportSchema,
  })
  if (rawReport === null) {
    return { status: 'round-failed', roundsStarted: round, lastReport: previous ?? null }
  }
  const report = validateReport(rawReport)
  if (report.status === 'complete') return { status: 'complete', roundsStarted: round, report }
  if (report.status === 'blocked') return { status: 'blocked', roundsStarted: round, report }
  previous = report
}
return { status: 'budget-limited', roundsStarted: args.maxRounds, report: previous }
`

/**
 * Host-level service resolvers the bridge executors close over: the
 * host-plane `ctx.subagents` surface, and the preset-realm workflowEngine
 * reached through `serviceForAgent` read-addressing (see the resolver in
 * `index.ts`; the engine is entry-local to the preset's delegation realm,
 * invisible to any outside ctx).
 */
export interface AgentBridgeDeps {
  requireSubagents?: () => DASHRSubagentsSurface | undefined
  requireWorkflowEngine?: (agent: ToolRunContext['agent']) => DASHRWorkflowEngine | undefined
}

/** One bridge executor: a pure (args, exec, deps) function returning a JSON value (errors included). */
type AgentBridgeExecutor = (rawArgs: unknown, exec: ToolRunContext, deps: AgentBridgeDeps) => Promise<ReplJsonValue>

const agentExecutor: AgentBridgeExecutor = async (rawArgs, exec, deps): Promise<ReplJsonValue> => {

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
    const subagents = deps.requireSubagents?.()
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

const agentMessageExecutor: AgentBridgeExecutor = async (rawArgs, exec, deps): Promise<ReplJsonValue> => {
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
      const subagents = deps.requireSubagents?.()
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
      const subagents = deps.requireSubagents?.()
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
      const subagents = deps.requireSubagents?.()
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

const agentWorkflowExecutor: AgentBridgeExecutor = async (rawArgs, exec, deps): Promise<ReplJsonValue> => {
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
    // realm — invisible to any outside ctx — so the caller supplies the
    // engine through `serviceForAgent` read-addressing (the host api-proxy's
    // own channel for a caller that already holds the agent).
    const engine = deps.requireWorkflowEngine?.(exec.agent)
    if (!engine) {
      return { error: 'agent_workflow() is unavailable: no workflowEngine service is mounted for this agent\'s preset' }
    }

    const settle = async (run: DASHRWorkflowRun): Promise<ReplJsonValue> => {
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') {
          return { error: `agent_workflow() did not finish cleanly: ${result.error ?? result.stopReason}` }
        }
        return { runId: run.id, agentsStarted: result.agentsStarted, result: result.value as ReplJsonValue }
      } catch (error: unknown) {
        return { error: `agent_workflow() failed: ${error instanceof Error ? error.message : String(error)}` }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        await run.dispose()
      }
    }

    try {
      if (mode === 'script') {
        const run = engine.start({
          script: a['script'] as string,
          meta: a['meta'] as DASHRWorkflowMeta,
          ...(a['args'] !== undefined ? { args: a['args'] } : {}),
          parent: exec.agent,
          signal: exec.signal,
        })
        return await settle(run)
      }
      // rfc mode: the fixed fresh-agent Ralph loop.
      const maxRounds = a['maxRounds'] === undefined ? RALPH_MAX_ROUNDS : a['maxRounds']
      if (typeof maxRounds !== 'number' || !Number.isSafeInteger(maxRounds) || maxRounds < 1) {
        return { error: 'agent_workflow() mode "rfc" maxRounds must be a positive safe integer' }
      }
      if (maxRounds > RALPH_MAX_ROUNDS) {
        return { error: `agent_workflow() mode "rfc" maxRounds ${maxRounds} exceeds the deployment ceiling ${RALPH_MAX_ROUNDS}` }
      }
      const run = engine.start({
        script: RALPH_SCRIPT,
        meta: RALPH_META,
        args: { objective: (a['objective'] as string).trim(), maxRounds, maxHandoffChars: RALPH_MAX_HANDOFF_CHARS },
        subagentProvider: RALPH_SUBAGENT_PROVIDER,
        maxTotalAgents: maxRounds,
        parent: exec.agent,
        signal: exec.signal,
      })
      return await settle(run)
    } catch (error: unknown) {
      return { error: `agent_workflow() failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

/**
 * Build the three delegation bridge TOOLS: real registry registrations whose
 * execute runs the pure executors with the host-level service resolvers.
 * Register once at the same host layer as `eval`; the registry projection is
 * then the single source for the wire tools array, the tool catalog, and the
 * REPL `tool.*` bindings (via the mechanical auto-bridge). Runtime argument
 * validation stays inside the executors; the schemas below are the declared
 * model-facing contract, and a structured `{ error }` value — not a thrown
 * exception — is the failure form.
 */
export function createAgentBridgeTools(deps: AgentBridgeDeps): ToolDefinition[] {
  const jsonRender = (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  const errorVariant: ObjectValueSchemaSpec = { type: 'object', properties: { error: { type: 'string' } }, additionalProperties: false }
  return [
    defineTool({
      name: 'agent',
      description: 'Start a child agent. Runs in the background by default: returns a durable subagent id immediately and keeps the child conversation open for agent_message follow-ups. Set run_in_background false to run a ONE-SHOT child instead — the call waits for the result and the child ends with the run. mode "delegate" (default) starts a fresh child; mode "fork" seeds the child with this agent\'s completed conversation turns.',
      parameters: {
        description: { type: 'string', description: 'A short (3-5 word) description of the delegated task, for display.' },
        prompt: { type: 'string', description: 'The task prompt for the child agent.' },
        run_in_background: { type: 'boolean', description: 'Default true: return a durable subagent id immediately (continuable, agent_message can follow up). Explicit false: one-shot — wait for the child\'s result here.' },
        mode: { type: 'string', description: "'delegate' (default: a fresh child) or 'fork' (a child seeded with this agent's completed conversation turns)." },
      },
      output: {
        schema: {
          oneOf: [
            { type: 'object', properties: { kind: { type: 'string', enum: ['continuable'] }, subagentId: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { kind: { type: 'string', enum: ['foreground'] }, runId: { type: 'string' }, output: { type: 'json' } }, additionalProperties: false },
            errorVariant,
          ],
        },
        render: jsonRender,
      },
      // The executors return their schema shapes at runtime; the cast mirrors the test-fixture convention for inferred tool outputs.
      execute: (args, exec) => agentExecutor(args, exec, deps) as Promise<never>,
    }),
    defineTool({
      name: 'agent_message',
      description: 'The single agent-to-agent channel, three ways: receiver "child" delivers a follow-up message down to a child (subagent_id required); receiver "parent" reports up to this agent\'s parent (live continuable children only; a root agent gets a structured UNAUTHORIZED instead); receiver "interrupt" stops a child\'s current turn (target_session_id required).',
      parameters: {
        receiver: { type: 'string', description: "'child' (deliver down), 'parent' (report up), or 'interrupt' (stop a child's current turn)." },
        message: { type: 'string', description: "The message text (required for receiver 'child' and 'parent')." },
        subagent_id: { type: 'string', description: "The child's durable id (required when receiver is 'child')." },
        target_session_id: { type: 'string', description: "The target agent's session id to interrupt (required when receiver is 'interrupt')." },
      },
      output: {
        schema: {
          oneOf: [
            { type: 'object', properties: { messageId: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { delivered: { type: 'boolean', enum: [true] }, message_id: { type: 'string' } }, additionalProperties: false },
            { type: 'object', properties: { accepted: { type: 'boolean', enum: [true] } }, additionalProperties: false },
            errorVariant,
          ],
        },
        render: jsonRender,
      },
      execute: (args, exec) => agentMessageExecutor(args, exec, deps) as Promise<never>,
    }),
    defineTool({
      name: 'agent_workflow',
      description: 'Run a multi-agent orchestration: mode "script" runs a plain-JS orchestration script (script/meta required); mode "rfc" runs the fixed fresh-agent Ralph loop toward one objective (objective required, maxRounds optional).',
      parameters: {
        mode: { type: 'string', description: "'script' (default: an orchestration script) or 'rfc' (a fixed fresh-agent Ralph loop)." },
        script: { type: 'string', description: 'The plain-JS workflow script body (required when mode is "script").' },
        meta: { type: 'json', description: 'The workflow identity block (required when mode is "script").' },
        args: { type: 'json', description: 'Optional JSON input exposed to the script as the args global.' },
        objective: { type: 'string', description: 'The immutable completion objective for the Ralph loop (required when mode is "rfc").' },
        maxRounds: { type: 'number', description: 'Optional round cap for the Ralph loop, bounded by the deployment ceiling.' },
      },
      output: {
        schema: {
          oneOf: [
            { type: 'object', properties: { runId: { type: 'string' }, agentsStarted: { type: 'number' }, result: { type: 'json' } }, additionalProperties: false },
            errorVariant,
          ],
        },
        render: jsonRender,
      },
      execute: (args, exec) => agentWorkflowExecutor(args, exec, deps) as Promise<never>,
    }),
  ]
}
