# Chapter 9: API Gateway & LLM Wire Extensions

## Core Idea
dsh exposes Host business logic to the Client through the **Typert API Gateway**: `@Remote`/`@RemoteScope` decorators select unary service methods, the build generates strict Host+Client contracts, and calls reuse the Connection RPC over `POST /api/<namespace>/<method>`. Separately, `@deepseek-ai/dsh-llm-deepseek` adds DeepSeek-specific HTTP headers and additive request-body fields (`dsh_plugin_packages`, `dsh_session_log`) that never enter model input.

## Frameworks Introduced
- **Typert API Gateway**: unary-only Remote-method bridge. Layers run `remotes → gateway → connection → webserver`; `packages/api` holds BFF+Typert, `packages/client/connection` and `packages/host/webserver` hold transport.
  - When to use: any Host service method a browser/SDK client must call with one request → one result.
  - How: mark methods `@Remote`/`@RemoteScope`, extend `TypertRemoteService`, generate contracts, mount via `api-remotes`, call `ctx.remote.<namespace>.<method>(...)`.
- **`@Remote`**: calls a Cordis service registered on the root Host Context. Host objects (e.g. `Agent`) cannot cross the wire — declare a `TypertLookupMap` so a parameter `agent` becomes an `agentId` wire field the Gateway resolves back to the object.
- **`@RemoteScope(key)`**: resolves an identity to a scoped Context via `ctx.typert.contexts`, gets the service from that Context. Use when the method depends on scoped composition and needn't receive objects like `Agent` explicitly.
- **`TypertRemoteService` / `bindTypertRemote(this, serviceKey)`**: explicit service-key + namespace binding (no compiler-injected symbol). `bindTypertRemote` for services with another base class.
- **Strict generation pipeline**: root build runs `build:lib:host` → `build:lib:client` → `build:web`. Host pass = `tsc -b tsconfig.host.json` then `tsdown --env.DSH_BUILD_FACE host` (runs Typert generator); Client pass = `tsc -b tsconfig.client.json` + `tsdown --env.DSH_BUILD_FACE client`, consuming generated artifacts without restarting Typert.
- **SRC development fallback**: `node --import tsx/esm` skips the Typert compiler; decorator initializers still record a versioned descriptor so the Gateway builds a weaker descriptor with no `ts.Program`. Solves Host dispatch from source only — Client still refuses SRC descriptors lacking strict codecs.
- **`DeepSeekLlmApiExtensionRegistry`**: one provider per top-level extension name; empty/padded names, duplicate registrations, and collisions with the base request fail before HTTP dispatch.
- **Body-extension transaction**: serialize base body (incl. exact `messages`) → ask registered providers to `prepare()` fields → merge as top-level siblings → on HTTP 2xx run `accept()` before reading SSE. No registry = unextended base body sent.

## Key Concepts
- **`ctx.remote.<namespace>`** (root) / **`agentCtx.remote.<namespace>`** (scoped): concrete Client functions on ordinary objects; each namespace is a traced Cordis child Service registered as `remote.<namespace>`, mounted through `ctx.remote.$mount()`.
- **`TypertLookupMap`**: wire-identity association for complex Host params; `ctx.typert.lookups.register()` = declaration+default resolver, `.configure()` = async Host-composition override scoped to an effect lifetime.
- **`api-remotes` assembly**: only `@deepseek-ai/dsh-api-remotes` is assembled; it imports business packages' `/remote` subpaths, mounts contributions, re-exports declaration merges. Host-method surface = only what's selected at generation time.
- **`/api` route**: Client calls `connection.rpc.call('/api', '<ns>/<method>', { args }, signal)` → `POST /api/<ns>/<method>` with `{ args }`. Gateway claims only two-segment endpoints with a strict descriptor or SRC marker; other requests 404.
- **Wire namespaces**: HTTP fields = lowercase kebab (`x-deepseek-harness-session-id`); request-body extensions = snake with reserved `dsh_` prefix; DSH-owned nested JSON = camelCase (`afterSeq`); tagged values = kebab, durable events `domain/action`.
- **`dsh_plugin_packages`** (enabled by default): complete active Loader-backed `{name,version}` package inventory; deduped, sorted by name then version; disabled/failed/unloading entries and non-package provenance absent; `packages: []` when none qualify.
- **`dsh_session_log`** (disabled by default): contiguous suffix of the canonical Session log, version 2. First upload `afterSeq: -1`; later uploads start after the greatest accepted watermark. `session` member projects `Session.header` (id, createdAt, `isSeeded` lineage bit, optional cwd/parentSession/origin/delegationDepth/agentPreset).
- **`delivery-accepted` watermark event**: appended after HTTP 2xx — type `session-log-deepseek/delivery-accepted`, data `{sessionId, sessionFormatVersion, throughSeq}`. Binds watermark to the logical format generation.
- **At-least-once delivery**: crash after acceptance but before persistence may resend an already-accepted range → duplicates, never a gap. Fork ignores inherited watermarks naming another Session.

## Mental Models
- **Use `@Remote` for root-Host services, `@RemoteScope` for scoped-composition methods.** Complex Host objects never cross the wire — think of the lookup map as the wire↔object identity table.
- **Think of Remote as unary-only.** Session event streams, pagination, incremental reduce, projection, entity substreams → register an exact Connection Fetch route, never a Remote method.
- **Think of the extension transaction as prepare-then-accept.** Only a 2xx endpoint accepts any contribution; a non-2xx or transport failure sends nothing and appends no watermark.
- **Think of extension fields as "outside the model."** They sit outside `messages`/system prompt/tool schemas, so they add no input tokens and don't alter the model-visible prefix.

## Anti-patterns
- **Modeling a streamed/browser-native feature as a Remote method**: Remote is strictly one request → one result; streaming must use a separate data protocol + registration model even if it shares the Connection.
- **Guessing whether an `Agent` object came from restoration**: lookup policy is per-key, so all `agent`/`session` params share cold-resume behavior; the method must not assume live-vs-restored provenance.
- **Treating `delivery-accepted` as persistence**: it asserts endpoint-level HTTP 2xx only — not SSE completion, not remote persistence.
- **Collapsing `dsh_plugin_packages` by package name**: receivers must preserve distinct simultaneous versions and ignore array order.
- **Reading generated `.d.ts` as ground truth for dispatch**: the strict contract (types/codecs) always comes from `lib/typert.remote-client.*`, never from a running source Host.

## Code Examples
```ts
export class GoalService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'goals') }   // namespace 'goals'
  @Remote('create')
  createForClient(agent: Agent, request: CreateGoalRequest, signal: AbortSignal): CreateGoalResult {
    signal.throwIfAborted(); return this.create(agent, request)
  }
  @RemoteScope('agent', 'current')                    // scoped: agentId → context → service
  currentForClient(): CreateGoalResult { return { accepted: true } }
}
// Client — inject ['remote', 'remote.goals']; single lookup param collapses the wire field:
await ctx.remote.goals.create(agentId, { objective: 'ship it' })
await agentCtx.remote.goals.create({ objective: 'ship it' })
```
```jsonc
// dsh_plugin_packages (version 1)
{ "dsh_plugin_packages": { "version": 1, "packages": [ { "name": "@deepseek-ai/dsh-example", "version": "0.1.1-rc.2" } ] } }
// dsh_session_log suffix (version 2)
{ "dsh_session_log": { "version": 2, "sessionFormatVersion": 2,
    "session": { "version": 2, "id": "session-id", "createdAt": 1780000000000, "isSeeded": false },
    "afterSeq": -1, "throughSeq": 0,
    "events": [ { "type": "turn/start", "seq": 0, "time": 1780000000001, "data": { "turn": 1 } } ] } }
// watermark appended after 2xx
{ "type": "session-log-deepseek/delivery-accepted", "seq": 8, "time": 1780000000002,
  "data": { "sessionId": "session-id", "sessionFormatVersion": 2, "throughSeq": 7 } }
```

## Reference Tables

**Request headers (`dsh-llm-deepseek`)**
| Header | Presence | Value |
|---|---|---|
| `user-agent` | every provider HTTP request | `product/version (+url)`; default product `deepseek-harness` |
| `x-deepseek-harness-user-id` | every authorized chat-completion | stable anonymous Harness-home UUID |
| `x-deepseek-harness-session-id` | chat-completion with a Session id | exact `sessionId` string |
| `x-deepseek-harness-compact` | purpose `compaction` | literal `1` |

**Component responsibilities**
| Package | Role |
|---|---|
| `dsh-typert-protocol` | decorators, Gateway bindings, invocation descriptors (no analysis/services) |
| `dsh-typert-generator` | build-time strict signature/type/lookup/Context analysis → artifacts |
| `dsh-typert-registry` + Loader | Host descriptors/schemas into `ctx.typert`, lookup+Context providers |
| `dsh-api-session-controller` | Agent/Session identity policy; standard `agent`/`session` resolvers |
| `dsh-api-gateway` | `ctx.typertGateway`; claims endpoints, resolves objects, invokes, validates |
| `dsh-api-gateway/client` | `ctx.remote`; mounts descriptors, initiates/validates/cancels |
| `dsh-api-remotes/client` | selects+mounts allowed `/remote` contributions |
| `dsh-client-connection` | RPC carrier, correlation, trust boundary, cancellation, `/api` bridge |

**Generated files per business package (`lib/`)**: `typert.host.js/.d.ts`, `typert.remote-client.js/.d.ts`, `typert.remote-client.d.ts.map`; entries exposed via `./typert` (Host) and `./remote` (Client).

## Key Takeaways
1. Gateway owns only the Remote data protocol + business dispatch; Connection owns transport, RPC ids, envelopes, cancellation — swap the carrier without touching descriptors.
2. The trust fence runs in Connection **before** the HTTP bridge, then dispatches inside the shared FetchHandler.
3. A strict endpoint withdrawn on the Host does **not** degrade to SRC inference — hot unload can't silently weaken validation.
4. `session/not-found` and `session/agent-busy` `RemoteError` codes pass to the wire unchanged; only unclassified throws fold into `gateway/internal`.
5. Extension fields are versioned independently per field; JSON member order is not protocol.

## Connects To
- **Ch06 architecture**: the `remotes → gateway → connection → webserver` layer stack and package split.
- **Ch07 capability-seams**: Remote is the unary seam; streaming seams use a different registration model.
- **Ch02 plugin-basics**: declaring `@Remote` methods and `inject`-ing `remote.<namespace>` is the plugin-author wiring.
- **Ch08 internals-pipelines**: the `build:lib:host`/`client`/`web` order and `DSH_BUILD_FACE` split.
- **Ch10 config-catalog**: `host-webserver.{host,port}`, `client-connection.trustedHosts`, `api-gateway.websocketHeartbeatIntervalMs` (default 2000 ms), `llm-deepseek.*`.
