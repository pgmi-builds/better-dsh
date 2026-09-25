# Chapter 3: Plugin Framework & Practice

## Core Idea
Cordis runs each plugin in a Fiber whose dependency-driven lifecycle makes every registration self-cleaning; on that runtime, dsh's extension architecture is two contracts — the three-role capability split (Definition / Provider / Consumer) and the `LlmAdapter` streaming protocol.

## Frameworks Introduced
- **Fiber state machine**: `PENDING → LOADING → ACTIVE` (or `FAILED`); `ACTIVE → UNLOADING → DISPOSED`. `inject` gates PENDING→LOADING; `apply` throwing → FAILED; a required service disappearing unloads the plugin automatically and reloads it when the service returns.
  - When to use: reasoning about any plugin's load, HMR, or teardown behavior.
  - How: declare `export const inject = ['tools', 'llm']`; inside `apply` every injected service is ready.
- **Service extension**: `class MetricsService extends Service { static inject = ['llm']; constructor(ctx) { super(ctx, 'metrics') } }` mounts `ctx.metrics`; typed via `declare module '@deepseek-ai/cordis' { interface Context { metrics: MetricsService } }`.
  - When to use: exposing a capability to other plugins; required deps via `inject`, optional via `const m = ctx.get('metrics'); m?.record(...)`.
- **Event modes**: `emit` (synchronous broadcast, return values ignored) · `bail` (first result other than `null`/`false`/`undefined` wins) · `serial` (registration order, async awaited, first non-null stops) · `waterfall` (each listener wraps the downstream result; must call `next()`).
  - When to use: notification → emit; veto/policy check → bail; ordered setup → serial; middleware/interception → waterfall.
- **Three-role capability design**: Service Definition (abstract class + Request/Result types) / Service Provider (subclass, `apply(ctx) { ctx.plugin(MyCapLocal) }`) / Consumer (`inject: ['tools', 'myCap']`). The complete capability is its seam; no individual role is.
  - When to use: only when roles need independent evolution or provider replacement — Bash = `dsh-shell` / `dsh-bash-local` / `dsh-tool-bash`.
  - How: swap providers by replacing one `cordis.yml` row; Provider and Consumer never depend on each other, only on the Definition.
- **`LlmAdapter` contract**: extend `LlmAdapter` from `@deepseek-ai/dsh-llm`, implement `async *stream(options: GenerateOptions): AsyncIterable<StreamChunk>`, register with `ctx.llm.registerAdapter(providerNames, adapter)` under `inject = ['llm']`; optionally override `resolveModel()` and `listModels()`.
- **Dynamic Cordis** (`@deepseek-ai/dsh-tool-cordis`): agent tool that inspects the live Cordis process and mounts/unmounts model-authored plugins in memory — temporary (gone on unmount or exit), and may affect other sessions in the same process.

## Key Concepts
- **Disposer semantics**: unload invokes disposers in reverse registration order, but multiple async disposers run concurrently with no serial guarantee — put order-dependent cleanup in a single `ctx.effect()` and await its steps serially.
- **`ctx.plugin(child)`**: nested Fiber inheriting the parent context with an independent lifecycle; `await fiber.dispose()` guarantees (1) registrations removed, (2) child plugins recursively unloaded, (3) promise resolves after all async cleanup.
- **Declaration merging**: `interface Events` (payload types) and `interface Context` (service types) — the type-safe extension mechanism for both events and services.
- **Cordis events vs session events**: `agent/pre-step`, `agent/request`, `agent/request-error`, `tools/result`, `session/event` are Cordis events (`namespace/action`); `turn/*`, `step/*`, `tool/call`, `tool/result`, `compaction/*` are durable session-event types — observe them by listening to `session/event` and inspecting `event.type`.
- **Service isolation**: `cordis-plugin-group` rows with `group: true` + `isolate: { shell: true }` + nested `config` list give separate plugin groups private instances of the same service.
- **`resolve(request): Spec`**: explicit default-resolution step in a capability — prefer it over hiding `?? default` expressions inside `run()`.
- **StreamChunk protocol**: `block-start` / `text-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`; every `block-start` has a matching `block-end`; `index` increases from 0; `usage` before `finish`; `finish` is last (`reason.kind: 'stop' | 'tool-calls'`).
- **`LlmError`**: stable-code error type for transport/protocol failures; the agent loop preserves message and code — it does not convert ordinary `Error`.
- **`attributionHeaders()` / `options.signal`**: merged into / forwarded on every provider HTTP request an adapter makes.
- **`brandString<ToolCallId>`**: branded id type carried by tool-call deltas and blocks.

## Mental Models
- Think of `inject` as a dataflow dependency: readiness gates loading, loss triggers disposal, return triggers reload — never hand-guard service access.
- Think of an adapter as a translator: `GenerateOptions` (provider-neutral: model, reasoning-effort id, history, system prompt, tool schemas, params, stop sequences, abort signal) → provider request; provider stream → `StreamChunk`s. A field the provider can't honor throws `LlmError`, never a silent drop.
- Treat the three-role split as an option, not a rule: a simple tool plugin is one package; split only for real replaceability.
- Think of `resolveModel` as capability advertisement: it returns identity + `context` + `reasoning` metadata (ordered opaque ids, display names, optional default); the service validates the aggregate and rejects unsupported explicit efforts before `stream()`.

## Anti-patterns
- **Listening on `tool/call` or `compaction/*` as Cordis events**: they are session-log record types; only `session/event` fires.
- **Waterfall listener omitting `next()` by accident**: short-circuits the pipeline by design — interception is the feature, not an error path.
- **Splitting the three roles preemptively**: separate packages only when independent evolution or provider replacement is real.
- **Throwing plain `Error` from an adapter**: the loop won't map it; diagnostics and policy lose the stable code.
- **Promoting reasoning-effort ids into a core enum**: preserve the adapter's authoritative opaque selectable list, including `off` when the upstream capability API returns it.
- **Counting on cross-effect disposal ordering**: concurrent async disposers have no serial completion guarantee.

## Code Examples
Adapter skeleton (registration + chunk protocol + error contract):
```ts
import { LlmAdapter, LlmError, attributionHeaders,
         type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...attributionHeaders() },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!res.ok) throw new LlmError(`Provider API error: ${res.status}`, 'PROVIDER_HTTP_ERROR')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Hello world' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello world' } }
    yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }
    yield { type: 'finish', reason: { kind: 'stop' } }   // or 'tool-calls'
  }
}
export const inject = ['llm']
export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(config.providers, new MyAdapter(config.apiKey))
}
```
Tool-call chunk (arguments stream as raw JSON text):
```ts
yield { type: 'tool-call-delta', index: 1, id: brandString<ToolCallId>('call-123'),
        name: 'bash', argumentsDelta: '{"command":"ls"}' }
```
Typed events:
```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```
Three-role wiring — Definition: `export abstract class MyCapService extends Service` + `interface Context { myCap: MyCapService }` + `abstract execute(request): Promise<MyCapResult>`; Provider: `class MyCapLocal extends MyCapService` registered via `ctx.plugin(MyCapLocal)`; Consumer: tool with `inject: ['tools', 'myCap']` calling `await ctx.myCap.execute({ input })`. Compose: one `cordis.yml` row per package; replace the provider row to swap implementations.

## Reference Tables
| Fiber state | Meaning |
|---|---|
| PENDING | declared; required dependencies not ready |
| LOADING | dependencies ready; `apply` running |
| ACTIVE | running |
| FAILED | `apply` threw an error |
| UNLOADING / DISPOSED | disposing resources / fully unloaded |

| Mode | Order | Stops when | Result |
|---|---|---|---|
| emit | all, sync | never | ignored |
| bail | registration | first non-null/false/undefined | that value |
| serial | registration, awaited | first non-null/false/undefined | that value |
| waterfall | chain via `next()` | a listener omits `next()` | wrapped downstream value |

Adapter facts: `GenerateOptions.provider` selects the registered adapter; `GenerateOptions.model` is an adapter-owned id with no lifecycle registration; `listModels()` advertises choices to selectors; `resolveModel(provider, model, signal?)` honors the optional signal so cancellation and disposal reach quiescence; omitting `reasoning` metadata means the model has no selectable reasoning-effort capability.

## Key Takeaways
1. All `ctx.*` registrations are effects — HMR, dependency loss, and `fiber.dispose()` clean up without manual teardown; use `ctx.effect` only for untracked resources.
2. Pick the event mode by contract: notification (emit), veto (bail), ordered setup (serial), wrapping/interception (waterfall).
3. The Service Definition owns Request/Result types; Providers and Consumers depend only on it — swapping providers is a one-row `cordis.yml` change.
4. Reference implementations: `packages/llm/llm-deepseek/` (OpenAI-compatible format) and `packages/llm/llm-pi-ai/` — the same harness contract over different provider SDKs.
5. The generated `cordis-surface` regions on subsystem pages record complete event signatures and modes — consult them and the service's TypeScript interface instead of maintaining a second static list.
6. Dynamic Cordis plugins are in-memory and process-wide: ephemeral by design, so never rely on them for durable composition.

## Connects To
- **Ch 4 / Ch 5**: Cordis fundamentals and the full API beneath the lifecycle/events/services summarized here.
- **Ch 7**: capability seams — the built-in three-role families and package links.
- **Ch 14**: the agent loop consumes `LlmError` codes and reasoning metadata.
- **Ch 17**: LLM streaming subsystem owns the complete chunk/adapter pipeline.
- **Ch 11**: tool-authoring reference (nested schemas, policy hooks, UI cards) for the consumer role.
