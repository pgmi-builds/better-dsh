# Chapter 8: Internals — Module Graph & Core Pipelines

## Core Idea
dsh's packages form a peer-dependency graph of *shared service instances*, wired at runtime by typed events and by a fixed three-waterfall tool-execution pipeline; two generated matrices (module graph, event producer–consumer matrix) tell you who owns an instance, who dispatches an event, and where policy inserts into a tool call.

## Frameworks Introduced
- **Shared-instance dependency graph** (`pnpm run gen-module-graph`): peer deps among `@deepseek-ai/dsh-*` packages; edge `a --> b` = `a` requires `b` as a host-provided shared instance. Runtime deps and dev-only relations deliberately absent.
  - When to use: deciding which services a new package/plugin may consume, or which peers it must declare.
  - How: Mermaid chart grouped by `packages/<group>/<pkg>` (50 groups, ~790 edges, names omit `@deepseek-ai/dsh-`) or the table `Package | Group | Peer dependencies`.
- **Event Producer–Consumer Matrix** (`pnpm run gen-doc-graphs`): every harness-owned event as `Event | Mode | Declared in | Dispatchers | Listeners`; types also cover contained dispatch sites that deliberately bypass `ctx.emit` (subagent lifecycle containment).
  - When to use: choosing a hook point, or auditing blast radius before changing an event payload.
  - How: Mode = contract, Dispatchers = owner, Listeners = insertion precedent; empty Listeners = open extension point.
- **Tool Execution Pipeline**: fixed stage order from model `tool_call` to model-facing `tool/result` hosting policy, hooks, sandboxing, rewriting, observation, UI "without changing the loop".
  - When to use: adding approval, guards, timeout/retry, result post-processing, or tool UI.
  - How: listen on the right waterfall (`tools/pre-execute` → guards → `tools/execute` → `tools/post-execute`); all three may transform a call.

## Key Concepts
- **Peer dependency**: a requirement for the host's shared instance; bundling your own copy breaks service identity.
- **Event mode**: `emit` (broadcast), `waterfall` (value-transform chain), `serial` (ordered await), `parallel` (fan-out await).
- **Monotonic guard**: registered deny-or-abstain check with protected identity, running after `tools/pre-execute` allow and before `tools/execute`; owner policy that must not be reordered lives here.
- **`ctx.approval`**: one-shot user prompt resolving `ask` verdicts *before* monotonic guards; absent or unanswerable approver = deny.
- **`ToolDefinition.finalizeContent`**: definition-owned last content-only invariant, synchronous, applied to a snapshotted result.
- **Registry outer normalization**: the registry losslessly snapshots the candidate result; snapshot throws become `isError` so failures never escape the pipeline.
- **`additionalContexts` FIFO**: active-batch extra contexts injected as user/message *after* recorded tool results.
- **PTC sub-calls**: serialized sub-calls of the reserved `run_code` transport; carry the parent token, log `tool/code-dispatch`, return denials as binding rejections, omit `additionalContexts` to preserve call/result adjacency.
- **`internal/*` events**: undeclared strings (`internal/dispatch`, `internal/plugin`, `internal/service`, `internal/status`) consumed by core machinery (loader, gateway, inspector) — not a public surface.

## Mental Models
- Think of the module graph as a *sharing contract*, not an import graph: edges mark services you receive, never services you bundle.
- Use the event matrix as a *bus map*: the dispatcher owns the stop; listeners are the passengers you ride with.
- Think of tool execution as *fixed track, movable signals*: stage order never changes; you add behavior by listening at a waterfall.

## Anti-patterns
- **Bundling a peer**: a second instance breaks shared identity; consume the host's copy.
- **Putting reorder-sensitive owner policy in `tools/pre-execute`**: it can be bypassed/reshaped by other listeners; register it as a monotonic guard instead.
- **Doing read-before-edit fs checks above `tool-fs`**: they stay below `tool-fs` on `fs/*` events.
- **Reading `agent/status`/`whenIdle()` as "my follow-up finished"**: several queued follow-ups share one `running` interval; an owner must define its interval explicitly (durable inbox receipt → next whole-agent `idle`) and handle the "nothing to wait for" branch or hang.

## Code Examples
```ts
// fs gates (dispatched by tool-fs / tool-str-replace-editor)
ctx.waterfall('fs/write-intent', intent)    // → fs-observation-policy
ctx.emit('fs/observed', obs)                // → fs-observation-policy, skill-filesystem

// Both-sides contract: LlmAdapter vs LlmRuntime
adapter.stream():  may throw OR emit finish { kind: 'error' | 'aborted' }
runtime.stream():  model-request failures ONLY as terminal finish chunks

// Dispose to quiescence
registry.close(); proc.kill(); await done   // close listeners BEFORE killing

// Unlink link-shaped paths
if (lstatSync(p).isSymbolicLink()) unlinkSync(p)  // rmSync(junction) → ERR_FS_EISDIR
```

## Reference Tables

### Tool execution stages (exact order)
| # | Stage | Notes |
|---|---|---|
| 1 | model tool-call block | assistant message contains tool-call |
| 2 | `tool/call` session event | logged before execution |
| 3 | UI pending card | `presentCall(args)` |
| 4 | `tools/pre-execute` waterfall | hooks, permission, sandbox → allow / deny / ask |
| 5 | `ctx.approval` (ask path) | one-shot; rejected/cancelled/unavailable → denied |
| 6 | monotonic guards | deny or abstain; identity protected |
| 7 | `tools/execute` waterfall | around-dispatch: timeout, retry, metrics |
| 8 | tool `execute()` body | may fire fs gates + tool-owned events (`todo/write`, `fs/observed`, `hook/invoked`, `hook/result`, `tool/code-dispatch`) |
| 9 | `tools/post-execute` waterfall | accept, block, replace, add context |
| 10 | registry outer normalization | snapshot throws → `isError` |
| 11 | `ToolDefinition.finalizeContent` | last content-only invariant |
| 12 | `tools/result` emit | frozen authoritative outcome |
| 13 | `tool/result` session event | single model-facing outcome; batch settled |
| 14 | `additionalContexts` FIFO | injected after recorded tool results |
| 15 | UI completed card | `presentResult(args, result)` |

Throws from stages 4–9 route to stage 10; denied calls skip the body but still traverse `tools/post-execute`.

### Load-bearing events
| Event | Mode | Dispatcher → listeners |
|---|---|---|
| `agent/pre-step` | waterfall | agent-loop → 15 pkgs (time-context, agent-instructions, plan-mode, hooks-*, tool-skill, tool-subagent…) |
| `agent/request` · `agent/request-error` | waterfall | agent-loop → agent, webhook · compaction-basic, llm-retry |
| `agent/turn-stopping` | serial | agent-loop → hooks-claude-code, hooks-codex |
| `llm/stream` | waterfall | llm → agent-loop, llm-replay, session-checkpoint-policy, session-title |
| `session/event` | emit | session → 27 pkgs (persistence, projection, telemetry, tools, server…) |
| `session/flush` | parallel | session → session-persistence-jsonl, session-telemetry |
| `system-prompt/assemble` | waterfall | system-prompt → agent, agent-presets |
| `tools/pre-execute` · `execute` · `post-execute` | waterfall | tools → hooks-*, tool-jobs · session-checkpoint-policy, timeout-policy · spill-policy, repeat-tool-reminder, tool-fs-search |
| `fs/write-intent` · `fs/edit-intent` | waterfall | tool-fs, tool-str-replace-editor → fs-observation-policy |
| `approval/request` | waterfall | user-approval → acp, remotes |
| `webserver/index-inject` | emit | webserver → inspector, modules |

### Shared-instance hubs (fan-in, ~790 peer edges)
`session` (92) > `llm` (83) > `agent` (64) > `tools` (42) > `invariants` (34) > `system-prompt`/`session-projection` (29) > `scope` (21). Top consumers: `api-session-controller` (26 peers), `subagent` (19). `llm` has zero outgoing peers (pure foundation); `tools --> agent` but not reverse; `session --> scope` only.

## Key Takeaways
1. Read the peer graph before adding a dependency — an edge means "require the host's shared instance", and fan-in hubs (session, llm, agent, tools) are the services everyone shares.
2. Pick event hooks by matrix lookup, not guesswork: Mode defines the contract, Dispatchers define the owner, empty Listeners mark open extension points.
3. Insert tool policy only at its designated waterfall; keep order-sensitive rules as registered monotonic guards, with `ctx.approval` resolving asks before guards.
4. Normalize both sides of every public contract (adapter throws vs runtime terminal finish chunks) and report orthogonal outcome flags (`timedOut`, `signal`, `exitCode`) independently.
5. Teardown must reach quiescence: close listener registries before killing, then `kill → await done`; dispatch loops must contain listener exceptions.
6. Scrub env (`*KEY*/*SECRET*/*TOKEN*/*PASSWORD*`) and use 0700 dirs + random `'wx' 0o600` files around untrusted output; unlink — never recursively delete — link-shaped paths.

## Connects To
- **Ch 4**: peer = shared Cordis service instance; duplicate-identity errors.
- **Ch 6**: the package groups/layers the graph visualizes.
- **Ch 7**: the event matrix is the canonical capability-seam inventory.
- **Ch 14**: agent-loop as chief dispatcher of `agent/*` events.
- **Ch 15**: tool-execution subsystem detail behind the stage table.
- **Ch 17**: `LlmAdapter`/`LlmRuntime` failure contract.
