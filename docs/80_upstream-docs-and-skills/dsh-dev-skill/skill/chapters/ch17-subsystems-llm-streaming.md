# Chapter 17: Subsystems — LLM Streaming, Tokens & Credentials

## Core Idea
dsh's LLM spine is provider-neutral at the wire: adapters emit a closed `StreamChunk` protocol, one shared `BlockAssembler` folds it back into `ContentBlock`s, and four edges handle the rest — credentials (secrets stay out of config), token metering (request-pressure pricing), typert (Remote-call typing), and client-modules (browser bundle loading).

## Frameworks Introduced
- **`StreamChunk`**: closed discriminated union (7 variants) — raw adapter protocol; `switch` over `type` ends in `assertNever`, so a new variant breaks every consumer that must handle it.
  - When to use: every adapter `stream()` return; every consumer fold.
  - How: emit `usage` before `finish`, nothing after; `index` ties deltas to a block, `block-end` carries the assembled `ContentBlock`.
- **`LlmAdapter`** (abstract class): the provider contract — subclass, implement `stream()`, register with `ctx.llm.registerAdapter(providers, adapter)`.
  - When to use: adding a model provider.
  - How: `GenerateOptions.provider` selects the adapter; `model` need not be registered at lifecycle start; duplicate routes fail atomically.
- **`BlockAssembler`**: single shared fold from `StreamChunk` stream → `ContentBlock[]` + usage + finish + replay.
  - When to use: any consumer needing the assembled result without re-implementing the fold.
  - How: `push()` each chunk, then read `blocks()` / `message()` / `usage` / `finish`; `interruptedBlocks()` on cancellation.
- **`CredentialProvider`** (abstract seam): two disjoint key spaces answer two questions.
  - When to use: reading/writing secrets for plugins.
  - How: `CredentialRef` (env-var name) resolves per operation; `CredentialKey` (plugin id) uses read-modify-write only.
- **`TokenMeter`**: replay owner for request-pressure + surface pricing; `measure(session, requestHeader?)` / `estimateMessage(message)`.
- **Typert**: generated Remote-call typing via `InvocationDescriptor` + `TypertCodec` (`strict` schema | `src-json`).
- **`ClientModuleRegistry`**: Node half of `dsh.client` scan → `WebBootGraph` → `/plugins` combo route + index-injection rows.

## Key Concepts
- **`ContentBlockMap`** — merge-extensible union: `text`, `reasoning`, `image`, `file`, `tool-call`, `tool-result`; a new modality lands only when adapter, UI, compaction, and replay all honor it.
- **`Message`** — immutable `{ id, role: 'system'|'user'|'assistant', content: ContentBlock[], source }` shared by delivery, durable history, and model requests.
- **`MessageSourceMap`** — merge-extensible provenance sum: `user`, `plugin` (with `plugin` + `ContextFormed`), `model`, `tool`.
- **`ContextForm`** — semantic producer-declared info kind: `instructions` | `catalog` | `snapshot` (has `sections`) | `notice` (has `summary`) | `relay` | `recall`; never visual (colors/icons/ordering are the consumer's).
- **`TokenUsage`** — disjoint counts: `inputTokens` (uncached only) + `cacheReadTokens?` + `cacheWriteTokens?` = billed input; `outputTokens`; `reasoningTokens?` already inside `outputTokens`; `totalTokens?` exact or omitted.
- **`LlmFailure`** — serializable provider-neutral failure: `message`, `code`, `status?`, `providerRetryAfterMs?` (validated delay, not a retry decision), `requestId?: ProviderRequestId`.
- **`FinishReasonMap`** — `stop`, `tool-calls`, `max-tokens`, `aborted {failure}`, `error {failure}`.
- **`ReplayEnvelope`** — `{ response: unknown, blocks?: readonly unknown[] }`; adapter-owned halves, shared split so assembly prunes per-block entries in step with dropped blocks.
- **`ResolvedRetryPolicy`** — immutable discriminated union: `normal` (`maxRetries`, `retryableCodes`, `initialDelayMs`, `maxDelayMs`, `jitterRatio`) or `always` (same backoff, no cap); normal default = 5 retries.
- **`CredentialRef`** — `Branded<'CredentialRef'>`; a POSIX-style env-var name (shell-identifier syntax validated).
- **`WebBootGraph`** — `{ rev, entries, batches }` injected as `window.__DSH_BOOT__`; single wire source between Node and browser halves.

## Mental Models
- **Use one adapter call = one provider attempt**: adapters disable library retries; agent-level recovery opens another numbered turn.
- **Think of credential resolution as a per-operation read**: `resolve(ref)` re-reads every call; that (not the `reference-updated` event) is the hot-update path — a rotated credential reaches the next request with no restart.
- **Think of the model catalog as advisory, never a whitelist**: routing keys on the registered provider; adapters may accept unlisted ids.
- **Think of `usage before finish` as the ordering invariant**: defer both to the provider's end-of-stream marker so a trailing usage-only chunk can't violate it.

## Anti-patterns
- **Caching a credential across operations**: breaks hot-update; re-resolve per operation.
- **Folding cache hits into `inputTokens`**: counts are disjoint; DeepSeek adapters subtract `prompt_tokens` cache fold back out.
- **Treating catalog absence as request rejection**: `listModels` is advisory; consumers must not turn absence into a 404.
- **Re-stringifying parsed tool args mid-stream**: keep `arguments` raw JSON end-to-end; partials via `argumentsDelta`.
- **Hand-copying the version into `AppIdentity`**: source it from package metadata; all fields are public product facts (no secrets, paths, session ids).

## Code Examples

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope }
```

```ts
abstract class LlmAdapter {
  providerInfo(provider: string): LlmProviderInfo
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined
  imageRequestPricing(_provider: string, _model: string): LlmImageRequestPricing | undefined
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>
  resolveModel(provider, model, _signal?): Promise<LlmResolvedModelInfo>
  async prepareCall(provider, model, signal?): Promise<PreparedAdapterCall>
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

```ts
ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle
ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>  // wrapped by 'llm/stream' waterfall
ctx.credentials.resolve(ref): Promise<ResolvedCredential | undefined>
ctx.credentials.modifyRecord(key, mutate): Promise<CredentialRecord | undefined>
ctx.tokenMeter.measure(session, requestHeader?): TokenMeasurement
ctx.clientModules.rebuilt(id): string | undefined   // ONLY entry point for bundle content changes
```

`/plugins/??<a>/client.js,<b>/client.js&rev=<rev>` — one-or-more-resource combo; `sourceMappingURL` mirrors as `.client.js.map` (Indexed Source Map v3); unknown/altered/stale lists → 404, other methods → 405.

## Reference Tables

| StreamChunk | payload |
|---|---|
| `block-start` | `index`, `blockType` |
| `text-delta` / `reasoning-delta` | `index`, `text` |
| `tool-call-delta` | `index`, `id`, `name?`, `argumentsDelta` |
| `block-end` | `index`, `block: ContentBlock` |
| `usage` | `usage: TokenUsage` |
| `finish` | `reason: FinishReason`, `replayState?` |

| LlmRuntime event | mode | purpose |
|---|---|---|
| `llm/stream` | waterfall | around every model call (retry/replay/routing); `next()` reaches adapter |
| `llm/adapters-updated` | emit | registry topology changed; re-read `listProviders()` etc. |
| `credentials/reference-updated(ref)` | emit | set/unset/external edit; ambient env changes never emit |
| `credentials/record-updated(key)` | emit | `modifyRecord`/`deleteRecord`/external edit |
| `authorization/settled(key, settlement)` | emit | every terminal attempt outcome, failures included |

| Error code | meaning |
|---|---|
| `DUPLICATE_ADAPTER` | provider already has an adapter (all-or-nothing) |
| `REGISTRATION_DISPOSED` | `replace()` after release |
| `CONTEXT_WINDOW_EXCEEDED` | canonical overflow code; route on code, not provider text |
| `EMPTY_RESPONSE` | terminal `stop` with zero content blocks — retryable |
| `gateway/*` (e.g. `lookup-not-found`, `service-unavailable`) | `TypertGatewayErrorCode` — ordinary `RemoteError` codes |

## Key Takeaways
1. The `StreamChunk` closed union + `BlockAssembler` split means an adapter only emits well-formed chunks — block reassembly is never each adapter's problem.
2. Tool-call `arguments` stay raw JSON strings end-to-end; `block-end` re-stringifies if the provider parsed them.
3. Two sanctioned failure paths, one `LlmFailure` type: THROW from `stream()` (transport) or end with `finish {kind:'error'|'aborted'}` (in-band).
4. Secrets live in `CredentialProvider`, not config — settings carry `CredentialRef` names only; resolve per operation.
5. `TokenMeasurement` reprices images through `ctx.llm.imageRequestPricing` per route; `baseline.kind` is `usage` (reusable anchor) or `estimated`.
6. A browser page with no valid `dsh.client` manifest cannot boot; `rebuilt(id)` is the sole path by which bundle content reaches the graph.

## Connects To
- **Ch04 cordis-fundamentals / Ch05 cordis-api**: all services here (`ctx.llm`, `ctx.credentials`, `ctx.tokenMeter`, `ctx.typert`, `ctx.clientModules`) are Cordis services; `llm/stream` is a waterfall, others emit.
- **Ch06 architecture**: `ctx.llm.stream()` and the `llm/stream` waterfall sit in the turn flow.
- **Ch14 subsystems-agent-loop**: the loop builds `GenerateOptions` from logged `EpochHeader`, logs raw chunks, and commits `assistant/attempt` on failure.
- **Ch15 subsystems-tool-execution**: `ToolSchema` is the wire type; `ToolDefinition` (schema + `execute`) lives in dsh-tools.
- **Ch16 subsystems-session-data**: the Session log embeds `AssistantStreamRecord[]` under `assistant/message` / `assistant/attempt`; `EpochHeader` is the token meter's request envelope.
- **Ch18 subsystems-web-ui**: `ctx.clientModules` feeds the web stack's `webserver/index-inject`; `ctx.credentialsController` backs `ctx.remote.credentials`.
- **Ch09 api-gateway**: typert's `TypertGateway` and `gateway/*` codes are the Remote-call dispatch seam.
- **Ch10 config-catalog**: `LlmCallConfig` input fields and credential references surface in settings schemas.
