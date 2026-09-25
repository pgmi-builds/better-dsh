# Chapter 13: Subsystems — Core, Session & Conversation

## Core Idea
The `packages/core` spine drives one loop — claim queued input → open a turn on the append-only `SessionEvent` log → assemble the request prefix via `ctx.systemPrompt` → stream the model → dispatch tools → append every model-visible fact back to the log. Message history is *derived* from the log (`deriveMessages()`), never stored; everything a plugin touches (agent handle, inbox, prompt sections, conversation nodes, scope) hangs off that log.

## Frameworks Introduced
- **Core spine (6 packages)**: `session/` (log, `ctx.sessions`), `system-prompt/` (`ctx.systemPrompt`), `tools/` (`ctx.tools`), `agent/` (`ctx.agents`), `agent-loop/` (concrete driver, `ctx.agentLoop`), `scope/` (dependency-free primitive below session/system-prompt to avoid cycles).
  - When to use: any extension — depend on `agent`, never `agent-loop` directly (keeps the loop swappable). `dsh-base` is the default composition; `dsh-sdk-minimal` the smaller tree.
- **Subsystem taxonomy (README grouping)**: ~50 pages, one per subsystem, each owning vocabulary + wiring + generated Cordis API section. Clusters: core loop (core, session, system-prompt, tools, scope), LLM (llm-streaming, token-meter), persistence/settings/credentials seams, session-derived surfaces (query, feedback, title, reference, projection, telemetry), execution seams (shell, subprocess, terminal, sandbox, code-runtime, filesystem, lsp), agent fan-out (subagent, agent-team, workflow, jobs), UI (web-client, client-modules, slots, conversation), gating/audit (approval, permission-presets, plan, invariants), infra (web-server, webhook, storage, workspace, extensions).
- **AgentHandle ownership model**: `AgentHandle { agent, dispose() }` from `ctx.agents.create()/resume()`; dispose = stop loop → await exit → unregister → remove session → unwind scoped world. The factory provider is a structural owner; config-created agents are owned by the loop fiber.
  - How: `setup(agentCtx)` composes the scoped world before `agent/created` publication; a setup rejection/commit throw/owner disposal rolls back both ids unpublished.
- **Inbox delivery vocabulary**: `InboxTarget = 'next-turn' | 'next-step'`; `send(message, target, wakeup)` is the unified route; `followup`/`steer`/`inject` are fixed presets (sole ordinary turn message / nearest step boundary / next pre-step without waking).
- **Conversation node assembly**: one `ConversationNodeAssembler` per Session applies registered Definitions over a contiguous `SessionEventLikeEntry` window; Definitions correlate by stable `(kind, id)`, fold deterministic State, publish target-owned nodes.
- **Runtime invariants registry** (`ctx.invariants`): package-owned checks; every workspace package publishes a `./invariant` companion registering under its exact npm name.

## Key Concepts
- **AgentStatus**: `'idle' | 'running'`; `running` is the driver-wide drain interval (may span queued turns), not proof a turn is open; disposal is not a status.
- **SessionEvent envelope**: `{ type, seq (monotonic, seq = log.length), time, data }`, discriminated union over `type`; conditional `sourceEventSeqs`/`surfaceOp` only on surface types; optional `ignorable?: true` lets safe-skipping readers skip unknown informational events (absent = required — refuse to reconstruct).
- **SurfaceEventType**: `user/message | assistant/message | tool/result` — the only types producing LLM messages; `SurfaceOp = 'append' | { op: 'replace', start, end }` (compaction shadows inclusive seq ranges).
- **EpochHeader**: logged request state — `{ config: LlmCallConfig, adapterDefaults?, system?, tools? }`; `request/header` reasons: `'initial' | 'resume' | 'change' | 'series'` (+ `startsSeries`); `foldRequestHeader` takes the latest snapshot. `request/context` records route capacity separately (never folded into header equality).
- **TurnEndReason** (merge-extensible): `completed | aborted(reason: TurnEndCancelCause) | blocked | error(LlmFailure) | max-tokens | interrupted` — `interrupted` is synthesized only by crash recovery, never emitted live; any max-tokens step makes the whole turn `max-tokens`.
- **session/end-seed**: constructor-only writer marking seed-vs-live cut; last `{ inherited: true }` marker = fork lineage cut; lets bracket owners (e.g. compaction) treat pre-boundary open markers as dead lifecycles.
- **Initiator scope**: `ctx.agents.currentInitiator()/requireInitiator()/withInitiator(agent, op)/withoutInitiator(op)` — same-process causal attribution only; ambient presence is neither liveness proof nor authorization.
- **Predecessor reads**: `start` receives a `ConversationContextReader`; `reader.previous<State>(kind)` returns the nearest earlier started Context; the assembler reruns dependents when an older prepend revises it.
- **Dynamic Cordis extensions**: `ctx.dynamicCordisRunner` — versioned immutable Packages under stable Plugin ids, Host/Client halves, approval-gated Client activation (`ApprovalRequestId`, `approveFutureVersions`), `inventory()`/`snapshot(agent)`/`inspectPackage()` source-free reads.

## Mental Models
- Think of the Session log as the database and `deriveMessages()` as a materialized cached view — replay is re-derivation, requests are pure functions of the log (reconstructability).
- Use `inject()` for model-facing context without waking the driver; `steer()` to bend the nearest step; `followup()` when the message must own its own turn.
- Think of Scope as "one registration context = per-agent visibility + shared lifetime": `ScopeKey` (opaque object; the live Agent is its own key), `Scoped<T>` carrier for scope-filtered events, `Scope { ctx, rawDispose, dispose }` for ordered composite teardown.
- Treat prompt assembly as cooperative: sections/contexts/tools/variables assemble → `system-prompt/assemble` waterfall → an effective `complete` section is restored afterwards as the sole section.

## Anti-patterns
- **Switching with `assertNever` over `SessionEvent`**: the map is merge-extensible; a plugin variant is a valid unknown — handle known cases, fall through `default`.
- **Scanning the event window / all Contexts per append in a Definition**: breaks the D-matches + O(1) key-lookup property; use State, Location data, `reader.previous()`.
- **Appending `session/end-seed` from a plugin**: would silently classify all live events before it as seed history; the Session constructor is the only legitimate writer.
- **Non-JSON event data (Map/Set/Date/class instance, negative zero, …)**: `Session.append` throws at the source — fail at append, never at backend flush.
- **Withdrawing a published conversation node with `null`**: keep the key, use `visibility: 'hidden'`.
- **Assigning updates to "the latest unfinished Context"**: every correlated event must carry or derive the same stable business id.

## Code Examples
```ts
// Delivery routing (Agent handle)
send(message: UserMessage, target: 'next-turn' | 'next-step', wakeup: boolean): void
cancel(cause: AgentCancelCause /* 'user'|'parent'|{kind:'hook',reason}|'disposed' */,
       options?: { keepInbox?: boolean }): void
runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> // from true idle only

// Inbox splices (durable, via agent/inbox/spliced)
claim(target): removes all next-step input + one next-turn message at turn boundary (no discard emits)

// Conversation Definition shape
interface ConversationNodeDefinition<S> {
  kind: string; target: string;
  match(event): { id: string; role: 'start' | 'update' } | null;
  start(context, match): S; update(context, match): S;
  publication?: 'immediate' | 'animation-frame' | 'none';
  buildLocationData?(context, scope): LocationData | null;
  buildViewNode?(context): Node | null; // must pair with target
}

// Invariants
type InvariantFailure = (message: string) => never  // throws InvariantError code:'INVARIANT'
ctx.invariants.register(packageName, { inject?, (ctx, fail) => {...} })
```

## Reference Tables
| Prompt contributor | Register via | Ordering |
|---|---|---|
| PromptSection (`complete?`, `{{var}}` text) | `ctx.systemPrompt.section()` | ascending `order`, ties by name; repo orders via `getSectionOrder()` |
| PromptContext (durable user-role snapshot) | `ctx.systemPrompt.context()` | ascending `order`; `getContextOrder()`; `suppressRuntimeContext()` to hide all |
| Tool schemas | `ctx.systemPrompt.tools(provider)` | `ToolProviderResult { schemas, knownNames? }`; reserved `TOOL_ORDER_REST` name fails assembly |
| Variables `[a-z][a-z0-9_]*` | `ctx.systemPrompt.variable(name, provider)` | scoped shadows global |

| Agent event | Mode | Contract |
|---|---|---|
| `agent/pre-step` | waterfall | reject/enter with messages; only waterfall before request derivation |
| `agent/request` | waterfall | replace frozen `LlmCallConfig`; cannot mutate messages |
| `agent/request-error` | waterfall | return `{kind:'retry'}` without `next()` to own recovery |
| `agent/turn-stopping` | serial | object by calling `agent.steer(...)`; data decides, order can't |
| `agent/session-start` | emit | seed via `agent.inject()`; source `startup|resume|clear|compact` |
| `agent/assistant-stream` | emit | transient start/chunk/end frames before durable settlement |
| `session/event` | emit | post-commit firehose; constructor seeds never emit |
| `session/flush` | parallel | durability checkpoint via `ctx.sessions.flush(session)` only |

| Invariant selection (`Config`) | Default | Semantics |
|---|---|---|
| `enabled` | `true` | global switch |
| `package_allowlist` | `[]` (admit all) | unanchored regex sources, `new RegExp(source)` |
| `package_blocklist` | — | overrides an allowlist match |

## Key Takeaways
1. Never persist or cache message history — derive from the log; append is synchronous, durability is async (`session/flush` via `ctx.sessions.flush`).
2. Plugin event types must be log-only (no `surfaceOp`) unless they produce messages; merge `SessionEventMap`/`TurnEndReasonMap` by declaration merging, switch with `default` not `assertNever`.
3. For ordered agent teardown use `prepare`/`enter`/`announce` (exact Cordis disposer identity is load-bearing); plain `ctx.sessions.create` is for fiber-owned sessions only.
4. Fork via `ctx.sessions.fork(source, boundary?)` — must end outside an open turn; `recompose`/`composeFrom` bind children to the parent's exact preset generation, never re-resolve by id.
5. Invariant companions: register under the exact npm name; empty installers must start `No runtime invariant:` with a package-specific reason — `verify-package-invariants` mechanically rejects violations.
6. Checks assert event/data relationships, never service or method presence; a reservation holds even when filters disable the installer (no silent name theft).

## Connects To
- **Ch 14**: the agent loop drives this spine turn-by-turn; interception contracts detail.
- **Ch 15**: `ctx.tools` registry and the guarded execution pipeline behind `tool/call`/`tool/result`.
- **Ch 16**: persistence (`SessionPersistence`, JSONL, crash recovery, `SessionHeader`) consumes the durability contract here.
- **Ch 17**: `Message`/`ContentBlock`/`StreamChunk` vocabulary the log embeds.
- **Ch 08**: architecture page owns the cross-subsystem event taxonomy and lifecycle.
- **Ch 04/05**: Scope/ScopedLayers and the dispatch modes (emit/waterfall/serial/parallel) are Cordis primitives used throughout.
