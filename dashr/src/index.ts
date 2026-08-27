/** `dashr-repl`: the DASHR RLM mode — one plugin, one row.
 *
 * Naming (v0.1.5 layer model): the runtime class is `DashrRuntime`, the
 * standing-mount-layer component — one instance per mount holding the
 * cross-session kernel map, hence the de facto daemon while the
 * profile-level `DashrDaemon` concept stays an empty shell; the session
 * layer is each ipykernel subprocess, a pure interpreter with no harness
 * awareness.
 *
 * This package merges what were two sibling plugins into a single
 * composition row: `DashrRuntime` (the stateful kernel runtime — the
 * `ctx.replRuntime` implementation, mounted first, below) and the
 * agent-plane presentation
 * (blueprint §7.4) — the `eval` transport tool, the generated Tool
 * Catalog prompt section, the model-direct-call collapse, the tool→binding
 * bridge that binds the registry's agent-visible tools as `await tool.name(args)`
 * members (v0.1.5 Q8: one `tool` holder, no flat globals), and the displaced
 * `send_message` bridge (ADR-0001: the single dual-direction A2A channel).
 * The Continual Harness (`refine`) and the compaction bridge (`compact`)
 * were removed in v0.1.8b — harness/refine became third-party territory, and
 * context compaction is the host runtime's business, not the REPL's.
 *
 * The presentation row registers against the harness tool registry the way
 * any dsh tool row must (shape-mirroring `dsh-agent-tool-presentation` and
 * the code-mode half of `dsh-tools`, 0.1.0-rc.6), but it re-points execution
 * at our own `ctx.replRuntime` (the harness's runtime seam, vendored from
 * `@deepseek-ai/dsh-code-runtime` in `src/vendored/rlm-runtime.ts` as an
 * interface only): the host registry stays untouched. The bundle patch
 * mounts this row on the HOST plane, so every agent in every preset gets
 * the cell surface (scoping, where wanted, is a PTC preset's own
 * `tools:code-only` rule). One row per composition, not one per session.
 * The seam is transport only: the KERNEL semantics —
 * resident IPython REPL, context as variables, last-expression completion —
 * are ours, not the upstream code mode's.
 *
 * Registration deltas from the upstream code-mode row, recorded per
 * blueprint §7.6:
 * - `eval` (not `run_code`): the registry reserves `run_code`
 *   unconditionally, and a distinct name is what lets a DASHR preset and a
 *   PTC code preset share one process registry without collision.
 * - The transport is an ORDINARY scoped registration, not the registry's
 *   reserved non-filterable transport: reservation is registry-private
 *   machinery a plugin cannot mint. Under our own scope the effect matches
 *   (visible only to this composition); a nested scope could restrict it
 *   away, which upstream forbids — accepted for M2 Stage A.
 * - The model-direct collapse is a `ctx.tools.guard()` denial (after the
 *   pre-execute waterfall) rather than the registry's pre-pipeline
 *   `UNKNOWN_TOOL`: same model-facing route-back text, different pipeline
 *   stage. `tools.guard` is the published monotonic-denial extension point.
 * - The `system-prompt/assemble` listener that filters `assembly.tools` down
 *   to `eval` uses the assembly waterfall's documented authority
 *   (dsh-tools README: "its returned assembly is authoritative").
 *
 * The runtime is mounted at the TOP of `apply` (before the presentation
 * injects), so a DASHR preset against a runtime-less composition fails AT
 * MOUNT — named in the preset's activation audit — instead of at the first
 * prompt. The presentation resolves `ctx.replRuntime` at USE time (never a
 * static inject): a static inject entry would hold the whole composition
 * hostage to the runtime service existing, and the `eval` execution
 * path re-reads `ctx.get('replRuntime')` with an actionable error,
 * mirroring upstream `requireCodeRuntime`.
 * @module dashr-repl
 */


import { Context } from '@deepseek-ai/cordis'
import { DashrRuntime } from './runtime.ts'
import type { Config as RuntimeConfig } from './runtime.ts'
import DshUrlSchema from './url-schema/index.ts'
import z from '@deepseek-ai/schemastery'
import { defineTool, TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'
import type {
  CodeDispatchLog,
  JsonSchemaNode,
  ToolDefinition,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntime,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'
// Type-only: brings the `ctx.tools` Context merge into this program.
import type {} from '@deepseek-ai/dsh-tools'
import { CallId, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
// Type-only: brings the `ctx.systemPrompt` Context merge and the
// `system-prompt/assemble` event typing into this program.
import type {} from '@deepseek-ai/dsh-system-prompt'
// The seam surface is mirrored locally (see the module for why the vendored
// Service Definition is depended on structurally, not by import).
import type {
  ReplBindingErrorClass,
  ReplBindingFunction,
  ReplBindingNamespace,
  ReplJsonValue,
  ReplRunResult,
  ReplRuntimeSurface,
} from './runtime-surface.ts'
import { isFlatBindableName, renderReplBridgeInstructions } from './py-sdk.ts'
import type { DASHRSdkSchema } from './py-sdk.ts'
import { snapshotJsonValue } from './snapshot-json.ts'
import type { JsonValue } from './snapshot-json.ts'
import { getCapturedTools } from './url-schema/native-capture.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DASHRSubagentsSurface } from './subagents-surface.ts'
import { readFileSync } from 'node:fs'

/** The control prompt text, loaded at module time from the sibling markdown file (editable without touching TS). */
const CONTROL_PROMPT_TEXT = readFileSync(new URL('../control-prompt.md', import.meta.url), 'utf8')



/** Cordis plugin name. */
export const name = 'dashr-repl'

/**
 * Required services. `replRuntime` is NOT listed: see the module doc — the
 * mode-dependent wait is declared inside {@link apply} instead, and the
 * execution path re-reads the service at use time with an actionable error.
 */
export const inject = ['tools']

/** Plugin config. */
export interface Config extends RuntimeConfig {
  maxParallelSubCalls?: number
}

/** Runtime schema. */
export const Config: z<Config> = z.intersect([
  DashrRuntime.Config,
  z.object({
    maxParallelSubCalls: z.natural().min(1).default(10),
  }),
])



/** The model-facing name of the DASHR cell transport. */
export const EVAL_NAME = 'eval'

/**
 * The wire-mask deny list (design D1): the upstream delegation and
 * guidance tools DASHR displaces from the model's surface. The list feeds
 * ONE registry-level mechanism — `tools.restrict({deny})` on the agent's
 * own scope layer at session-start — which removes every name from ALL
 * registry projections at once (wire schemas, catalog, SDK, REPL bindings,
 * by-name dispatch): the restricted-away names are gone for the model on
 * every surface, not hidden per-presentation. Two exemptions are registry
 * facts, not list policy: a name the host never registered is skipped (a
 * restriction may only name inherited tools), and a name registered on the
 * agent's OWN layer (the child-scoped native `report`, this composition's
 * own URL wrappers) is exempt from restrictions by construction — the
 * capability it carries stays reachable through the captured-definition
 * bridges below, never through the masked name.
 */
export const MASKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'skill',
  'send_message',
  'report',
  'list_agents',
  'subagent',
  'subagent_fork',
  'interrupt_agent',
  'workflow',
  'ralph',
])

/**
 * The effective deny list the session-start wiring restricts. An alias of
 * {@link MASKED_TOOL_NAMES} today; a config override (a deployment naming
 * its own mask) slots in HERE and nowhere else — the constant is the single
 * source, so the mask never drifts between capture, restrict, and the
 * bridges that read captured definitions.
 */
export const WIRE_MASKED_NAMES: ReadonlySet<string> = MASKED_TOOL_NAMES



/**
 * The typed-rejection contract declared on EVERY flat tool namespace: a
 * failed tool call raises `ToolCallError` with `.toolName` set to the
 * binding global (= the tool name the model knows). Identical descriptors
 * may repeat across namespaces; the runtime materializes the class once.
 */
const TOOL_CALL_ERROR_CLASS: ReplBindingErrorClass = { name: 'ToolCallError', memberNameProperty: 'toolName' }

/** The `dashr:control-prompt` section order: the FIRST section in the 100–199 tool-guidance band, so the cell paradigm is taught before the Tool Catalog renders its signatures. */
export const CONTROL_SECTION_ORDER = 100

/** The `dashr:tool-catalog` section order: the 100–199 tool-guidance band's SDK position, matching upstream `tools:sdk`. */
export const SDK_SECTION_ORDER = 150

/**
 * The bridge tools rendered INTO the bridge instructions as if they were
 * registry tools: each is a hand-written {@link DASHRSdkSchema} fed to the
 * SAME `renderReplBridgeInstructions` as the registry schemas, so the
 * declarations show one flat `tool.name(args)` surface — no second calling
 * convention, no separate "bridge tools" block. The bridge enforces these
 * shapes per call (the bridge tools below); the schemas here are the
 * model-facing declaration only. Descriptions must stay truthful about
 * requiredness and semantics.
 */
const BRIDGE_TOOL_SCHEMAS: DASHRSdkSchema[] = [
  {
    name: 'send_message',
    description: "The single agent-to-agent message channel, both directions: receiver 'child' delivers down to a child; receiver 'parent' reports up to this agent's parent (live continuable children only; a root agent gets a structured UNAUTHORIZED instead).",
    parameters: {
      type: 'object',
      properties: {
        receiver: { type: 'string', description: "'child' (deliver down) or 'parent' (report up)." },
        message: { type: 'string', description: 'The message text.' },
        subagent_id: { type: 'string', description: "The child's durable id (required when receiver is 'child')." },
      },
      required: ['receiver', 'message'],
      additionalProperties: false,
    },
    output: { type: 'object', properties: {}, additionalProperties: true },
  },
]

/**
 * The `eval` tool description the model sees: cell semantics — the
 * persistent kernel — stated up front, unlike upstream's one-shot
 * `PYTHON_FLAVOR` (blueprint §1.1: DASHR is channel ② state codification,
 * and the model's Code-Interpreter prior matches THIS contract).
 */
const EVAL_DESCRIPTION
  = 'Execute one Python cell on a session-persistent scripting pad. Takes two required '
    + 'arguments: `cell`, one Python program body (top-level `await` and `return` work; variables, '
    + 'imports, and definitions from earlier cells are still alive), and `description`, '
    + 'a short summary of what the cell does; optional `timeout` (seconds) bounds the wall-clock and optional `reset` restarts the pad empty. Call tools as `await tool.name(args)` '
    + 'functions per the declarations in the system prompt. Only what you print or '
    + 'return comes back — curate it.'

/** The `cell` parameter's model-facing description. */
const EVAL_CELL_PARAM_DESCRIPTION
  = 'The cell: one Python program body for the session-persistent scripting pad (top-level '
    + '`await` and `return` work).'

/**
 * The `description` parameter's model-facing description: the UI label
 * contract, ported verbatim in shape from upstream `run_code` (the label
 * surfaces on the generic card as the call's always-visible title).
 */
const EVAL_DESCRIPTION_PARAM_DESCRIPTION
  = 'Clear, concise description of what this cell does in active voice, '
    + '5-10 words (shown in the UI). Examples: "Load dataframe and summarize '
    + 'columns"; "Run test file and capture failures"; "Patch config key across '
    + 'cordis.yml files".'

/**
 * Thrown by `eval` when the cell itself failed — a program exception, a
 * budget expiry, an abort, or kernel death. Extends {@link HarnessError} with
 * the same `code: 'CODE_RUN_FAILED'` as upstream `CodeRunFailedError`, so
 * registry-side error taxonomy and session-log consumers see the shape they
 * already know; the registry's execution pipeline converts it into a
 * structured `isError` result whose text carries the failure kind plus the
 * captured logs, so the model can self-correct.
 */
export class DASHRRunFailedError extends HarnessError {
  constructor(message: string) {
    super(message, 'CODE_RUN_FAILED')
    this.name = 'DASHRRunFailedError'
  }
}

/**
 * Snapshot one binding call's argument as lossless JSON, then snapshot that
 * detached value again so dispatch and logging stay independent without
 * reintroducing structured-clone's platform-specific nesting limit. Ported
 * verbatim from upstream `code-mode.ts` (`jsonNormalizeArgs`).
 */
function jsonNormalizeArgs(value: unknown): { dispatched: unknown; logged: unknown } {
  let snapshot: JsonValue | undefined
  try {
    snapshot = snapshotJsonValue(value) as JsonValue | undefined
  } catch (error: unknown) {
    throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (snapshot === undefined) {
    throw new Error('tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)')
  }
  const logged = snapshotJsonValue(snapshot)
  if (logged === undefined) {
    throw new Error('tool arguments could not be detached for durable logging')
  }
  return { dispatched: snapshot, logged }
}

/** One bare-callable binding's packaged arguments, sent by the kernel-side callable proxy. */
type ReplCallParse =
  | { ok: true, args: unknown[], kwargs: Record<string, unknown> }
  | { ok: false, error: string }

/**
 * Parse the kernel-side callable proxy's uniform `{args, kwargs}` packaging.
 * The proxy sends EVERY bare-global call this way (unlike member proxies,
 * which unwrap a single positional argument), so callable bindings own their
 * signature validation — the "host owns the namespace" rule.
 */
function parseReplCall(rawArgs: unknown): ReplCallParse {
  if (typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)) {
    const record = rawArgs as Record<string, unknown>
    if (Array.isArray(record.args)
      && (record.kwargs === undefined
        || (typeof record.kwargs === 'object' && record.kwargs !== null && !Array.isArray(record.kwargs)))) {
      return { ok: true, args: record.args, kwargs: (record.kwargs ?? {}) as Record<string, unknown> }
    }
  }
  return { ok: false, error: 'malformed callable binding arguments' }
}

/**
 * Unwrap one bare-callable {@link parseReplCall} packaging into the single
 * arguments object a registry dispatch expects. The kernel's callable
 * channel packages EVERY call as `{args, kwargs}`; a tool call — registry
 * tool or bridge tool alike — is exactly ONE positional arguments
 * object, mirroring the member-proxy unwrapping the pre-0.1.5
 * `tools.name(args)` form performed kernel-side. Keyword form and
 * multi-positional form reject (the rejection becomes ToolCallError, whose
 * member names the binding the model called).
 */
function flatToolArgs(rawArgs: unknown): unknown {
  const parsed = parseReplCall(rawArgs)
  if (!parsed.ok) throw new Error(parsed.error)
  const { args: callArgs, kwargs } = parsed
  if (Object.keys(kwargs).length > 0) {
    throw new Error('tool bindings take one positional arguments object, not keyword arguments — call e.g. name({"field": 1})')
  }
  if (callArgs.length === 1) return callArgs[0]
  if (callArgs.length === 0) return null
  return callArgs
}

/**
 * Unwrap one bridge-tool {@link parseReplCall} packaging into its single
 * arguments object. Same one-object contract as {@link flatToolArgs}, but
 * bridge tools return a structured `{ error }` value instead of throwing, and
 * a call with no arguments reads as an empty object. Keyword and
 * multi-positional forms are rejected.
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

/** Resolve the eval overlap cap at the config boundary (schemastery already validated the range; direct construction in tests bypasses it). */
export function resolveMaxParallelSubCalls(value: number | undefined): number {
  const maxParallelSubCalls = value ?? 10
  if (!Number.isInteger(maxParallelSubCalls) || maxParallelSubCalls < 1) {
    throw new Error('dashr-repl: maxParallelSubCalls must be a positive integer')
  }
  return maxParallelSubCalls
}

/** Two-space JSON presentation, matching the shallow `eval` text contract (ported). */
const JSON_INDENT = '  '

/** ECMAScript caps `JSON.stringify`'s `space` string at ten characters; total indentation is capped there so formatted output stays linear (ported). */
const MAX_JSON_INDENT_CHARS = 10

/** A pending fragment in the iterative JSON presentation traversal (ported). */
type JsonRenderTask =
  | { kind: 'text'; text: string }
  | { kind: 'value'; value: JsonValue; depth: number; compact: boolean }

/** Render one non-string JSON root without recursive traversal or unbounded indentation growth (ported from upstream code-mode.ts). */
function renderJsonValue(value: Exclude<JsonValue, string>): string {
  const chunks: string[] = []
  const tasks: JsonRenderTask[] = [{ kind: 'value', value, depth: 0, compact: false }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if (task.kind === 'text') {
      chunks.push(task.text)
      continue
    }

    const current = task.value
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      chunks.push(String(current))
      continue
    }
    if (typeof current === 'string') {
      chunks.push(JSON.stringify(current))
      continue
    }

    const compact = task.compact || (task.depth + 1) * JSON_INDENT.length > MAX_JSON_INDENT_CHARS
    const childDepth = task.depth + 1
    if (Array.isArray(current)) {
      chunks.push('[')
      if (current.length === 0) {
        chunks.push(']')
        continue
      }
      tasks.push({ kind: 'text', text: compact ? ']' : `\n${JSON_INDENT.repeat(task.depth)}]` })
      for (let index = current.length - 1; index >= 0; index--) {
        const item = current[index]
        if (item === undefined) throw new Error('dashr-repl: cannot render a sparse JSON array')
        tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
        tasks.push({
          kind: 'text',
          text: compact
            ? index === 0 ? '' : ','
            : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}`,
        })
      }
      continue
    }

    const keys = Object.keys(current)
    chunks.push('{')
    if (keys.length === 0) {
      chunks.push('}')
      continue
    }
    tasks.push({ kind: 'text', text: compact ? '}' : `\n${JSON_INDENT.repeat(task.depth)}}` })
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]
      if (key === undefined) throw new Error('dashr-repl: cannot render a missing JSON object key')
      const item = current[key]
      if (item === undefined) throw new Error('dashr-repl: cannot render an undefined JSON object property')
      tasks.push({ kind: 'value', value: item, depth: childDepth, compact })
      tasks.push({
        kind: 'text',
        text: compact
          ? `${index === 0 ? '' : ','}${JSON.stringify(key)}:`
          : `${index === 0 ? '\n' : ',\n'}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `,
      })
    }
  }
  return chunks.join('')
}

/** Render one present cell completion value for the model-facing result text (ported). */
function renderValue(value: JsonValue): string {
  return typeof value === 'string' ? value : renderJsonValue(value)
}

/** Canonical value returned by the outer `eval` transport. */
type RunCellOutput = { logs: string[]; result?: JsonValue }

/**
 * Capabilities the `eval` bridge closes over, mirroring upstream's
 * `RunCodeBridgeOptions` (the `requireRuntime` idiom): the registry-private
 * staged scheduler travels through the exported `TOOL_RUNTIME_SCHEDULER`
 * symbol-keyed property rather than a closure, because — unlike upstream —
 * the registry does not mint this tool for us.
 */
export interface RunCellBridgeOptions {
  /** Resolves `ctx.replRuntime` or throws the loud misconfiguration error (use-time read). */
  requireRuntime: () => ReplRuntimeSurface
  /** The run's overlap cap for parallel-classified sub-calls (validated config). */
  maxParallel: number
  /**
   * Runs the `tools/code-dispatch-log` waterfall over one settled
   * sub-dispatch and returns the content the bridge should log — the
   * consumer-side stand-in for the registry-private `shapeDispatchLog`
   * invoker upstream mints for its own bridge (same carrier, same
   * containment). Built in {@link apply}.
   */
  shapeDispatchLog: (dispatch: CodeDispatchLog) => Promise<ContentBlock[]>
  /**
   * Resolves the host-plane `ctx.subagents` service (or undefined when this
   * composition has no subagent capability) for the send_message()
   * receiver='parent' UPLINK alone — every downlink bridges the tool layer
   * instead (ADR-0001). Read at run time so a host-side provider mounted
   * later still becomes visible; absent means the uplink answers with a
   * structured "unavailable" error, never a crash.
   */
  requireSubagents?: () => DASHRSubagentsSurface | undefined
}

/**
 * Build the `eval` {@link ToolDefinition}: required `cell` and
 * `description` parameters, executed through the dispatch bridge described
 * in the module doc. Sub-calls ride the registry's exported staged scheduler
 * (`prepare`/`dispatch`/`finalize`/`finish`) under the native concurrency
 * contract; each sub-dispatch is logged for reconstruction
 * (`tool/code-dispatch-start` / `tool/code-dispatch`) while only the outer
 * curated result enters model history.
 * @param registry - the host tool registry (sub-calls go through its staged
 *   scheduler, bindings cover its registered tools).
 * @param options - the bridge capabilities described above.
 * @returns the registry-ready definition.
 */
export function createRunCellTool(registry: ToolRuntime, options: RunCellBridgeOptions): ToolDefinition {
  const { requireRuntime, maxParallel, shapeDispatchLog, requireSubagents } = options
  return defineTool({
    name: EVAL_NAME,
    description: EVAL_DESCRIPTION,
    parameters: {
      cell: { type: 'string', required: true, description: EVAL_CELL_PARAM_DESCRIPTION },
      description: {
        type: 'string',
        required: true,
        description: EVAL_DESCRIPTION_PARAM_DESCRIPTION,
      },
      timeout: {
        type: 'number',
        description: 'Optional wall-clock budget for this cell, in seconds; the cell is interrupted (then force-stopped) if it exceeds the budget. Omit to use the runtime default.',
      },
      reset: {
        type: 'boolean',
        description: 'Optional: reset the persistent pad namespace to EMPTY before running — variables, imports, and definitions from earlier cells are discarded and the pad restarts fresh. Omit to keep the namespace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          logs: { type: 'array', required: true, items: { type: 'string' } },
          result: { type: 'json' },
        },
      },
      render: (_args, value) => {
        const rendered = value.result === undefined ? '' : renderValue(value.result)
        const parts = [value.logs.join('\n'), rendered].filter(part => part.length > 0)
        return [{ type: 'text', text: parts.length > 0 ? parts.join('\n') : `(${EVAL_NAME} completed with no output)` }]
      },
    },
    async execute(args, exec): Promise<RunCellOutput> {
      if (args.description.trim().length === 0) {
        throw new Error('dashr-repl: invalid description: expected a non-empty string')
      }
      const runtime = requireRuntime()

      // The run-scoped abort: follows the outer signal in, and fires when the
      // run settles for ANY reason, so an in-flight sub-dispatch is aborted
      // (its executor kills on this signal) instead of orphaned, and
      // queued-unstarted dispatches are abandoned.
      const runController = new AbortController()
      const onOuterAbort = (): void => { runController.abort(exec.signal.reason) }
      exec.signal.addEventListener('abort', onOuterAbort, { once: true })

      let dispatches = 0
      // The per-run scheduler uses the registry's staged interface and follows
      // the same concurrency rules as the native loop (ported from upstream
      // code-mode.ts): every ordered stage (the dispatch-start append,
      // prepare = pre-execute/guards, finalize/finish = post-execute, context
      // deferral, the settle append) runs inside ONE driver lane, so ordered
      // policy stages never overlap each other and only the
      // around-dispatch/body stage runs concurrently. Starts are strictly
      // submission-ordered; results commit in submission order through the
      // head-of-line cursor. Consecutive parallel-classified calls overlap up
      // to maxParallel; an exclusive call waits for the pool to drain, runs
      // alone, and holds its barrier until its COMMIT (post-execute included)
      // completes, exactly like a native exclusive group. Classification is
      // re-read via executionMode() immediately before each start (a registry
      // mutation while queued can flip a call exclusive), matching the native
      // scheduler's lazy reclassification.
      interface PendingDispatch {
        start(): Promise<void>
        classify(): 'parallel' | 'exclusive'
        abandon(): void
        commit(): Promise<void>
        flight: Promise<void>
        settled: boolean
        mode?: 'parallel' | 'exclusive'
      }
      const pendingQueue: PendingDispatch[] = []
      const inFlight = new Set<Promise<void>>()
      /** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
      const logWork = new Set<Promise<void>>()
      const commitQueue: PendingDispatch[] = []
      let exclusiveActive = false
      let driving = false
      let driverRun: Promise<void> = Promise.resolve()
      let wake: (() => void) | undefined
      const wakeup = (): void => {
        const release = wake
        wake = undefined
        release?.()
      }
      /** The single ordered lane (ported; see the block comment above). */
      const drive = (): Promise<void> => {
        if (driving) return driverRun
        driving = true
        driverRun = (async () => {
          try {
            for (;;) {
              const signal = new Promise<void>((resolve) => { wake = resolve })
              const commitHead = commitQueue[0]
              if (commitHead !== undefined && commitHead.settled) {
                commitQueue.shift()
                await commitHead.commit()
                if (commitHead.mode === 'exclusive') exclusiveActive = false
                continue
              }
              const head = pendingQueue[0]
              if (head !== undefined) {
                if (runController.signal.aborted) {
                  pendingQueue.shift()
                  head.abandon()
                  continue
                }
                const mode = head.classify()
                const capacity = !exclusiveActive
                  && (mode === 'exclusive' ? inFlight.size === 0 : inFlight.size < maxParallel)
                if (capacity) {
                  if (mode === 'exclusive') exclusiveActive = true
                  head.mode = mode
                  pendingQueue.shift()
                  commitQueue.push(head)
                  await head.start()
                  const flight: Promise<void> = head.flight.finally(() => {
                    inFlight.delete(flight)
                    wakeup()
                  })
                  inFlight.add(flight)
                  continue
                }
              }
              if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return
              await signal
            }
          } finally {
            driving = false
            wake = undefined
          }
        })()
        return driverRun
      }
      /** Every dispatch settled AND committed; nothing can start (the run is aborted at call time). */
      const drainDispatches = async (): Promise<void> => {
        await drive()
        while (logWork.size > 0) await Promise.allSettled([...logWork])
      }

      const runOver = (): boolean => runController.signal.aborted

      const binding = (name: string): ReplBindingFunction => async (rawArgs: unknown): Promise<JsonValue> => {
        if (runOver()) {
          throw new Error(`${EVAL_NAME} run is over (${String(runController.signal.reason)}); ${name} not dispatched`)
        }
        const normalized = jsonNormalizeArgs(rawArgs)
        const n = ++dispatches
        const subCallId = CallId(`${String(exec.callId)}:code:${n}`)
        const input: ToolExecutionInput = {
          callId: subCallId,
          rootCallId: exec.rootCallId,
          name,
          arguments: normalized.dispatched,
          ...exec.agent ? { agent: exec.agent } : {},
          parent: exec.token,
          signal: runController.signal,
        }
        type DispatchOutcome = { isError: true; message: string } | { isError: false; value: JsonValue }
        const scheduler = registry[TOOL_RUNTIME_SCHEDULER]
        const outcome = await new Promise<DispatchOutcome>((resolve, reject) => {
          let parked:
            | { kind: 'post-result' | 'final-result'; exec: ToolRunContext; result: ToolExecutionResult }
            | undefined
          const settle = (result: ToolExecutionResult): void => {
            // The program gets its value NOW: the log-content listener (for
            // example, a spill backend) must never delay the binding or
            // occupy a dispatch slot. The event append is tracked side work;
            // the run's settlement drains logWork so every settle event is
            // still appended inside the open turn.
            resolve(result.isError
              ? { isError: true, message: result.error.message }
              : { isError: false, value: result.value as JsonValue })
            const agent = exec.agent
            if (agent === undefined) return
            const task: Promise<void> = (async () => {
              // The registry-private shapeDispatchLog invoker is not callable
              // from a consumer, but the waterfall it drives is a published
              // event: the capability passed in options replicates it (same
              // carrier, same containment) so durable copies keep the
              // reshape extension point.
              const logged = await shapeDispatchLog({ exec, agent, subCallId, name, isError: result.isError, content: result.content })
              agent.session.append('tool/code-dispatch', {
                rootCallId: exec.rootCallId,
                parentCallId: exec.callId,
                subCallId,
                name,
                // The SIBLING parse of the dispatched value: byte-identical JSON,
                // but a separate object — a tool mutating its args cannot desync
                // this record from what it actually received.
                arguments: normalized.logged,
                isError: result.isError,
                content: logged,
              })
            })().finally(() => { logWork.delete(task) })
            logWork.add(task)
          }
          pendingQueue.push({
            flight: Promise.resolve(),
            settled: false,
            classify: () => registry.executionMode(input).kind,
            abandon: () => {
              reject(new Error(`${EVAL_NAME} run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`))
            },
            async start(): Promise<void> {
              exec.agent?.session.append('tool/code-dispatch-start', {
                rootCallId: exec.rootCallId,
                parentCallId: exec.callId,
                subCallId,
                name,
                arguments: normalized.logged,
              })
              // Ordered prepare runs INSIDE the driver lane: the next entry's
              // pre-execute waits for this resolution, as under the native
              // scheduler. Only the launched body below overlaps.
              const prepared = await scheduler.prepare(input)
              if (prepared.kind === 'dispatch') {
                this.flight = scheduler.dispatch(prepared.exec).then((dispatchOutcome) => {
                  parked = { kind: dispatchOutcome.kind, exec: prepared.exec, result: dispatchOutcome.result }
                  this.settled = true
                })
                return
              }
              parked = { kind: prepared.kind, exec: prepared.exec, result: prepared.result }
              this.settled = true
            },
            async commit(): Promise<void> {
              if (parked === undefined) return
              const result = parked.kind === 'post-result'
                ? await scheduler.finalize(parked.exec, parked.result)
                : scheduler.finish(parked.exec, parked.result)
              for (const context of result.additionalContexts ?? []) {
                exec.deferContext(context)
              }
              // Only a successful nested result can carry the terminal
              // marker (ToolExecutionFailure types it never), so a
              // policy-converted failure cannot stop the turn through a
              // recovering program.
              if (result.concludesTurn) exec.concludeTurn()
              settle(result)
              // Backpressure on pending event-append tasks: each task retains
              // a full result while a slow backend stores it, so the pool cap
              // bounds their count.
              while (logWork.size > maxParallel) await Promise.race(logWork)
            },
          })
          wakeup()
          void drive()
        })
        // A budget expiry or outer cancel that occurs while this call was in
        // flight already aborted the dispatch; stop the program now rather
        // than hand it a result from a run that is over.
        if (runOver()) {
          throw new Error(`${EVAL_NAME} run is over (${String(runController.signal.reason)}); ${name} result discarded`)
        }
        // The kernel turns a binding rejection into ToolCallError and adds
        // only the binding name. Native content and internal error metadata
        // stay outside the program-facing failure contract.
        if (outcome.isError) throw new Error(outcome.message)
        return outcome.value
      }

      // ONE `tool.*` namespace (blueprint §2.2, OMP loopback): every bindable
      // tool the CALLING AGENT can see becomes a MEMBER async callable
      // `await tool.name(args)` — no flat globals, no prefix, no allowlist.
      // This is a single-state auto-map over the registry's visible
      // projection (design D3): the wire mask is a registry-level
      // restriction installed at session-start, so every masked name is
      // ALREADY absent from `schemas(exec.agent)` here — a cell binds
      // exactly the surface the wire declared, one projection for both.
      // A host tool registered later joins the next cell with zero wiring
      // on this side. Names that cannot serve as members (exotic, reserved,
      // underscore-leading — the policy shared with the renderer's
      // isFlatBindableName, e.g. hyphenated or `__`-infixed MCP names) are
      // simply not bound; the bridge instructions state that limit.
      // Sub-dispatch re-resolves per call through the same view
      // (exec.agent threads down).
      const toolFunctions: Record<string, ReplBindingFunction> = {}
      for (const schema of registry.schemas(exec.agent)) {
        if (schema.name === EVAL_NAME) continue
        if (!isFlatBindableName(schema.name)) continue
        toolFunctions[schema.name] = async (args: unknown) => binding(schema.name)(args)
      }


      // send_message() bare callable global (plan Q25): one dual-use A2A
      // function. receiver='child' bridges the send_message TOOL downlink
      // (subagent_id required — the id a spawn call returned) through the
      // CAPTURED native definition — `send_message` is on the wire-mask
      // deny list, so a by-name dispatch (`binding('send_message')`) would
      // hit the registry's UNKNOWN_TOOL; the session-start capture
      // (native-capture.ts) took the definition before the mask landed and
      // the direct `def.execute` preserves the native delivery semantics.
      // The by-name fallback serves lifecycles that never fired
      // `agent/session-start` (no capture exists): there the mask never
      // landed either, so the dispatch resolves — and under a mask without
      // a capture it fails loudly as UNKNOWN_TOOL rather than silently
      // dropping the channel. receiver='parent' bridges the SERVICE-layer
      // reportFrom uplink — the only direction no tool covers — with zero
      // ids: the child (exec.agent) is the authority credential and the
      // service bootstraps the parent from the child's own session header.
      // delivery stays FIXED at 'wakeup' (the upstream default; a
      // scheduling policy, not model-facing). A root caller fails the
      // service's authorizeReporter with SubagentError 'UNAUTHORIZED',
      // surfaced here as a structured error value.
      const sendMessageCallable: ReplBindingFunction = async (rawArgs: unknown): Promise<ReplJsonValue> => {
        const parsed = flatBridgeToolArgs(rawArgs)
        if (!parsed.ok) return { error: parsed.error }
        const a = parsed.args
        const unknownKeys = Object.keys(a).filter(key => !['receiver', 'message', 'subagent_id'].includes(key))
        if (unknownKeys.length > 0) return { error: `send_message() got unexpected key(s): ${unknownKeys.join(', ')}` }
        const receiver = a['receiver']
        const message = a['message']
        if (typeof receiver !== 'string' || typeof message !== 'string') {
          return { error: 'send_message() requires {"receiver": "child" | "parent", "message": "..."}' }
        }
        if (receiver === 'child') {
          const subagentId = a['subagent_id']
          if (typeof subagentId !== 'string' || subagentId.length === 0) {
            return { error: 'send_message() receiver "child" requires {"subagent_id": "..."} — the durable subagent id a spawn returned' }
          }
          const capturedSend = exec.agent !== undefined ? getCapturedTools(exec.agent)?.get('send_message') : undefined
          if (capturedSend !== undefined) {
            // Direct captured-definition call: the native delivery
            // semantics unchanged, the masked name never re-entered. A
            // rejection propagates to the kernel as the binding failure
            // (ToolCallError), same as the by-name path below.
            return await capturedSend.execute({ subagent_id: subagentId, message }, exec) as ReplJsonValue
          }
          return await binding('send_message')({ subagent_id: subagentId, message })
        }
        if (receiver === 'parent') {
          if (!exec.agent) {
            return { error: 'send_message(receiver=\'parent\') requires an agent session (this run has no agent to report from)' }
          }
          const subagents = requireSubagents?.()
          if (!subagents) {
            return { error: "send_message(receiver='parent') is unavailable: no ctx.subagents service is mounted in this composition" }
          }
          try {
            const messageId = await subagents.reportFrom(exec.agent, [{ type: 'text', text: message }], { delivery: 'wakeup', signal: exec.signal })
            return { delivered: true, message_id: messageId }
          } catch (error: unknown) {
            if ((error as { code?: unknown }).code === 'UNAUTHORIZED') {
              return { error: `send_message(receiver='parent') rejected: only a live continuable child agent can report to its parent (a root agent has none) — ${error instanceof Error ? error.message : String(error)}` }
            }
            return { error: `send_message(receiver='parent') failed: ${error instanceof Error ? error.message : String(error)}` }
          }
        }
        return { error: `send_message() unknown receiver ${JSON.stringify(receiver)}: expected 'child' or 'parent'` }
      }

      try {
        let result: ReplRunResult
        try {
          result = await runtime.run({
            program: args.cell,
            bindings: [
              {
                global: 'tool',
                functions: {
                  ...toolFunctions,
                  send_message: sendMessageCallable,
                },
                errorClass: TOOL_CALL_ERROR_CLASS,
              },
            ],
            signal: runController.signal,
            // Session identity for kernel-per-session keying: the calling
            // agent's id (a session id). An agentless call leaves it absent
            // and lands on the runtime's shared default key.
            ...exec.agent ? { principal: exec.agent.id } : {},
            // The kernel's working directory = the session's workspace. The
            // presentation layer is the per-session surface: it already holds
            // `exec.agent` (the calling Agent), so it reads the same source
            // the upstream `{{cwd}}` prompt variable reads and threads it down
            // to the kernel spawn. An agentless call leaves it absent → the
            // kernel inherits the daemon's cwd (the pre-fix leak, retained
            // only for the no-session edge).
            ...exec.agent ? { cwd: exec.agent.session.header.cwd } : {},
            // Per-run budget override: a cell may self-declare a longer or
            // shorter wall budget (seconds → ms). Absent → the runtime default.
            ...(typeof args.timeout === 'number' && Number.isFinite(args.timeout) && args.timeout > 0)
              ? { timeoutMs: Math.max(1, Math.floor(args.timeout * 1000)) }
              : {},
            // reset=true abandons the persistent namespace (fresh, empty kernel).
            ...(args.reset === true ? { reset: true } : {}),
          })
        } finally {
          // Abort sub-dispatches and drain every in-flight dispatch before
          // closing the turn (queued-unstarted ones are abandoned unlogged).
          // Binding failures remain observable through their individual promises.
          runController.abort(`${EVAL_NAME} settled`)
          await drainDispatches()
        }

        if (result.error) {
          const logsText = result.logs.length > 0 ? `\nCaptured output:\n${result.logs.join('\n')}` : ''
          throw new DASHRRunFailedError(`code run failed (${result.error.kind}): ${result.error.message}${logsText}`)
        }
        return {
          logs: result.logs,
          ...result.value !== undefined ? { result: result.value } : {},
        }
      } finally {
        exec.signal.removeEventListener('abort', onOuterAbort)
      }
    },
    // The model-authored description is the call's always-visible UI label
    // (the bash `description` precedent); the cell itself rides rawInput.
    presentCall: args => ({
      card: 'generic',
      title: args.description,
      kind: 'execute',
      rawInput: args.cell,
    }),
    // Deliberately no presentResult: the generic card fallback keeps this
    // title and reads durable result content without duplicating a large raw
    // result into the host view payload.
  })
}

/**
 * Collect one calling scope's bridge-declaration schemas through the
 * registry's public projection APIs: `schemas(scope)` for the model-facing
 * view (scoped tools join, restrictions apply — the wire mask is a
 * registry-level restriction installed at session-start, so every masked
 * name is ALREADY absent from this projection; no second name filter
 * exists to drift), `get(name, scope)` for the canonical output schema,
 * snapshotted so a live definition cannot mutate under the render. `eval`
 * itself is excluded — it is the transport, not a binding.
 */
export function collectSdkSchemas(registry: ToolRuntime, scope?: ScopeKey): DASHRSdkSchema[] {
  const collected: DASHRSdkSchema[] = []
  for (const schema of registry.schemas(scope)) {
    if (schema.name === EVAL_NAME) continue
    const definition = registry.get(schema.name, scope)
    if (definition === undefined) continue
    const output = snapshotJsonValue(definition.output.schema) as JsonSchemaNode | undefined
    if (output === undefined) continue
    collected.push({ name: schema.name, description: schema.description, parameters: schema.parameters, output })
  }
  return collected
}

/**
 * Declare the DASHR cell presentation for every agent this composition
 * covers: the `eval` transport tool, the `dashr:tool-catalog` prompt
 * section, the model-direct collapse guard, and the assembly filter that
 * leaves `eval` the only contributed tool schema.
 *
 * Mount through a preset's standing scope (`agent.cordis.yml` include row);
 * mounting unscoped is legal for a whole-process DASHR deployment and gives
 * the same shape at the global layer.
 * @param ctx - the mounting composition's context (a preset's standing scope).
 * @param config - the plugin config.
 */
/** The runtime slice's config keys, mirrored from `DashrRuntime.Config` in `./runtime.ts`. */
const RUNTIME_CONFIG_KEYS = [
  'python', 'cwd', 'startupTimeoutMs', 'runTimeoutMs', 'interruptGraceMs',
  'interruptConfirmMs', 'disposeTimeoutMs', 'snapshotTimeoutMs',
  'maxOutputBytes', 'snapshotDir', 'snapshotSizeCapBytes', 'username',
  'kernelEnvDir', 'kernelPythonVersion', 'kernelAutoInstall',
] as const
/** The runtime slice of the merged config — the keys `DashrRuntime` owns. */
function pickRuntimeConfig(config: Config): RuntimeConfig {
  const out: Record<string, unknown> = {}
  for (const key of RUNTIME_CONFIG_KEYS) out[key] = (config as Record<string, unknown>)[key]
  return out as RuntimeConfig
}

export function apply(ctx: Context, config: Config): void {
  // Mount the stateful kernel runtime FIRST: it provides `ctx.replRuntime` in
  // this row's scope (the preset's entry-local `replRuntime` realm), which the
  // presentation inject below resolves. Both halves were separate plugin rows
  // before the merge; one row now owns the whole lifecycle.
  ctx.plugin(DashrRuntime, pickRuntimeConfig(config))
  ctx.plugin(DshUrlSchema, config)
  const logger = ctx.logger('dashr-repl')
  const maxParallel = resolveMaxParallelSubCalls(config.maxParallelSubCalls)

  // The wait is the loud failure: a preset row still pending on `replRuntime`
  // is what the preset mount audit reports as an unusable row, naming this
  // plugin. Use-time reads below stay authoritative at execution.
  ctx.inject(['replRuntime'], (runtimeCtx: Context) => {
    const requireRuntime = (): ReplRuntimeSurface => {
      // Structural read (see runtime-surface.ts): the Context merge the
      // sibling runtime package declares is deliberately not imported here.
      const runtime = runtimeCtx.get('replRuntime') as ReplRuntimeSurface | undefined
      if (!runtime) {
        throw new Error('dashr-repl: eval requires an replRuntime service — load a ctx.replRuntime implementation in this composition (dashr-repl mounts one at apply)')
      }
      if (runtime.language !== 'python') {
        throw new Error(`dashr-repl: no cell SDK for runtime language ${JSON.stringify(runtime.language)} (dashr-repl presents Python only; got a ${JSON.stringify(runtime.language)} runtime under ctx.replRuntime)`)
      }
      return runtime
    }

    const registry = runtimeCtx.tools

    // `systemPrompt` resolves at use time through `get()` — the same
    // optional-backend idiom as `requireCodeRuntime` — rather than a second
    // static inject entry: the tools service itself cannot construct without
    // systemPrompt (its own static inject), so presence is already implied by
    // this plugin's `inject = ['tools']` wait.
    const systemPrompt = runtimeCtx.get('systemPrompt')
    if (!systemPrompt) {
      throw new Error('dashr-repl: ctx.systemPrompt is required beside ctx.tools (the tools service itself depends on it) — this composition mounted tools without a system prompt registry')
    }

    // The consumer-side stand-in for the registry-private shapeDispatchLog
    // invoker: same scope-targeted carrier over the published
    // `tools/code-dispatch-log` waterfall, same containment — a throwing
    // listener logs a warning and the original settled content is logged.
    const shapeDispatchLog = async (dispatch: CodeDispatchLog): Promise<ContentBlock[]> => {
      try {
        return await runtimeCtx.waterfall(
          scopeTarget(registry, dispatch.agent),
          'tools/code-dispatch-log',
          dispatch,
          () => Promise.resolve(dispatch.content),
        )
      } catch (error: unknown) {
        logger.warn(`dashr-repl: code-dispatch-log listener failed for ${dispatch.name}: ${error instanceof Error ? error.message : String(error)}; logging the original settled content`)
        return dispatch.content
      }
    }
    // ① The transport tool, an ordinary scoped registration (module doc
    // records the reservation delta). Registered through the injected
    // runtime context so the tool's lifetime follows the runtime service's.
    const requireSubagents = (): DASHRSubagentsSurface | undefined => runtimeCtx.get('subagents')
    runtimeCtx.tools.register(createRunCellTool(registry, { requireRuntime, maxParallel, shapeDispatchLog, requireSubagents }))

    // ①½ The wire mask (design D1): deny the displaced delegation names on
    // the agent's OWN scope layer at session-start. Ordering is the mount
    // order made explicit: the url-schema row mounted earlier in `apply`
    // registered its session-start listener FIRST, so for every dispatch
    // this listener runs AFTER the own-layer wrappers registered (they are
    // restriction-exempt — own-layer registrations are never filtered) and
    // BEFORE any REPL binding enumeration or catalog render, both of which
    // read the post-restriction visible projection. The mask therefore
    // lands on wire schemas, catalog, SDK, bindings, and by-name dispatch
    // in ONE move. Names the host never registered are filtered against
    // the agent's visible schemas first (a restriction may only name
    // inherited tools — an unknown name throws); a visible name that still
    // refuses (it sits on a non-restrictable layer, e.g. the child-scoped
    // native `report`) is skipped — that layer is exempt by construction
    // and the capability stays reachable through the captured-definition
    // bridge.
    const wireMasked = new WeakSet<Agent>()
    runtimeCtx.on('agent/session-start', ({ agent }) => {
      if (wireMasked.has(agent)) return
      wireMasked.add(agent)
      try {
        const visible = new Set(agent.ctx.tools.schemas(agent).map(schema => schema.name))
        const deny = [...WIRE_MASKED_NAMES].filter(name => visible.has(name))
        if (deny.length === 0) return
        try {
          agent.ctx.tools.restrict({ deny })
          return
        } catch {
          // Fall through: at least one named tool sits on a layer the
          // registry refuses to restrict; mask the rest one by one and
          // skip each refusal (skipping is the documented behavior for
          // own-layer names, not an error).
        }
        for (const name of deny) {
          try {
            agent.ctx.tools.restrict({ deny: [name] })
          } catch {
            // Non-restrictable (own-layer) name — exempt by construction.
          }
        }
      } catch (error: unknown) {
        logger.warn(`dashr-repl: wire mask failed for agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    // ①′ The Control Prompt section (plan Q3): static, scope-independent
    // text teaching the cell paradigm BEFORE the Tool Catalog renders its
    // signatures (order 100 < 150) — the single entry + guard contract, the
    // flat-binding paradigm, the delegation foreground/background
    // semantics, and flat examples. The same text serves the root and every
    // child (children inherit this composition), so it renders as a constant.
    systemPrompt.section({
      name: 'dashr:control-prompt',
      order: CONTROL_SECTION_ORDER,
      text: CONTROL_PROMPT_TEXT,
    })

    // ② The REPL bridge instructions prompt section (the pre-0.1.5 name was
    // `tools:dashr-sdk`, then `dashr:tool-catalog`; the id stays
    // `dashr:tool-catalog` so existing session prefixes keep their cache
    // shape), regenerated from the CALLING scope's post-mask visible tools
    // at assembly time (the same scope-aware shape as upstream's
    // sdkSection: an assembly for a different scope renders its own view,
    // never ours). The bridge tools are fed into the SAME renderer as
    // registry tools (BRIDGE_TOOL_SCHEMAS), so the surface is one flat
    // convention: every tool — registry tool or bridge tool — is
    // `await tool.name(args)`.
    systemPrompt.section({
      name: 'dashr:tool-catalog',
      order: SDK_SECTION_ORDER,
      text: context => renderReplBridgeInstructions([...collectSdkSchemas(registry, context.scope), ...BRIDGE_TOOL_SCHEMAS]),
    })


  })
}

export default { name, inject, Config, apply }

export { DashrRuntime, ReplRuntime } from './runtime.ts'
export type { Config as RuntimeConfig } from './runtime.ts'
