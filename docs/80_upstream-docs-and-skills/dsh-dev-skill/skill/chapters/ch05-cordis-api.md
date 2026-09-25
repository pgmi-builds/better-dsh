# Chapter 5: Cordis API Reference

## Core Idea
The exact generated API surface of Cordis core: `Context` is a proxy over the service store whose `extend()/isolate()/intercept()` create scoped child contexts; plugins are loaded as fibers through the registry; events dispatch in five fixed modes. Master the member table and the inherited-vs-isolated visibility rules and you can read any dsh subsystem page's `cordis-surface` regions.

## Frameworks Introduced
- **Context scoping trio**: `extend(meta?)`, `isolate(name, label?)`, `intercept(name, config)` — all return child contexts without mutating the parent.
  - When to use: `extend` for extra metadata; `isolate` when two subtrees need different implementations of one service name; `intercept` to merge service-specific config for plugins started below a context.
  - How: `isolate` joins scopes when passed the same `label` (default: fresh unique symbol); `intercept` config merges ancestor-entries-first via `Service[symbols.resolveConfig]`.
- **Event dispatch API**: five modes, each with an exact method; mode is fixed per event.
  - When to use: never pick a mode — the event's declaration owns it; call the matching method.
  - How: `emit` (sync, returns ignored), `parallel` (await all), `serial` (await in order, first truthy bail wins), `bail` (sync serial), `waterfall` (last arg is innermost `next`; not calling it vetoes). `ctx.on(name, listener, options?)` registers; disposer returns `true` if the listener was still registered.
- **Fiber lifecycle API**: `ctx.plugin()` returns `Fiber & PromiseLike<Fiber>` — awaiting it settles loading and rethrows config/startup errors.
  - When to use: `fiber.update(config, noSave?)` for live reconfig; `fiber.restart()` for reload with current config; `fiber.await()` to surface startup errors; `fiber.getEffects()` for diagnostics.
  - How: `update` runs the `internal/update` waterfall first — update hooks and HMR can veto or replace the restart.
- **Registry injection**: `ctx.inject(deps, callback)` — shorthand for `ctx.plugin({ inject, apply: callback })`.
  - When to use: run-once-available logic without a named plugin.
  - How: callback is unloaded and re-run whenever a required service changes; `deps` is an array (no intercept config) or name→config map (per-service intercept config, normalized by `Inject.resolve`).
- **Service store primitives**: `get`/`set`/`provide`/`accessor`/`mixin` on the reflect layer backing the proxy.
  - When to use: `provide` to register a plain value (not a `Service` subclass); `get(name, strict?)` for optional reads; `mixin` to expose service members directly on `ctx`.
  - How: all are fiber-owned — `provide`/`accessor`/`mixin` unwind with the owning fiber.

## Key Concepts
- **Context proxy**: normal property reads go through the service resolver; scoping methods never mutate the parent.
- **`ctx.root`**: the root context every child shares (`@experimental`).
- **`fiber.uid`**: unique id within the registry; `0` for the root fiber, `null` once disposed.
- **`fiber.inertia`**: the in-flight load/unload transition promise, if one is running.
- **`fiber.store`**: snapshot of required service implementations while loaded; `undefined` otherwise.
- **`Runtime`**: mutable registry record shared by all fibers of one plugin callback — `{name, fibers, callback, Config}`; `callback` is the registry identity key.
- **`Effect`**: disposer, promise of one, or async iterable yielding several (generator effects register each yielded disposer as produced).
- **`EffectMeta`**: `{label, children}` tree exposing nested effect labels for diagnostics (e.g. `ctx.on("event")`).
- **`CordisError`**: framework error with stable code (`INACTIVE_EFFECT`); `ValidationError extends TypeError` aggregates standard-schema issues.
- **Strict get**: `ctx.get` by default only returns implementations whose providing fiber is currently active.

## Mental Models
- Think of the scope tree as: parent → `extend`/`isolate`/`intercept` children; service reads/writes below an `isolate(name)` resolve against the new label, so siblings never see each other's overrides.
- Use `Plugin.Base` metadata (`name`, `Config`, `inject`, `provide`, `intercept`) when authoring any plugin shape — the registry and loaders (including HMR) read it uniformly.
- Think of `ctx.events`/`ctx.registry`/`ctx.reflect` as ambient handles whose methods are mixed onto `ctx` itself (`ctx.on` → `ctx.events.on`, `ctx.plugin` → registry, `ctx.get` → reflect).
- Use symbol-keyed static members (`Context.effect/filter/isolate/intercept`, `Service.init/check/config/invoke/extend/tracker/resolveConfig`) as the framework's extension sockets — e.g. `Context.filter` is consulted on every event dispatch, `Service.invoke` makes a service callable like `ctx.logger(name)`.

## Anti-patterns
- **`instanceof Context` checks**: fails across realms and duplicate cordis copies — use `Context.is(value)` (global-symbol brand).
- **`ctx.set` on a name you don't provide**: only the providing fiber may set; unprovided name throws. Duplicate `provide` in the same scope also throws (no sibling shadowing).
- **Registering effects after dispose**: throws `CordisError('INACTIVE_EFFECT')`; invalid effect return shape throws `TypeError`.
- **Ignoring `EventOptions.global`**: context listener filters apply on every dispatch — a scoped-out listener silently never fires unless `global: true`.
- **Awaiting `fiber` but expecting config**: the awaited value is the fiber; read validated config from `fiber.config` (updated by `update()`).

## Code Examples
```ts
// Scoping
const child = ctx.extend({ locale: 'en' })            // prototypal inherit, meta shadows
const scoped = ctx.isolate('shell', myLabel)          // join scopes via same label
const patched = ctx.intercept('tools', { timeout: 5e3 }) // merged into service config below

// Service store
ctx.provide('greeter', value): () => void             // returns disposer
ctx.get('greeter')                                     // strict by default (active fibers only)
ctx.get('greeter', false)                              // include inactive providers
ctx.accessor('token', { get, set })                    // computed ctx property
ctx.mixin('events', ['on', 'emit'])                    // forward members onto ctx

// Events
ctx.on(name, listener, { prepend: true, global: true })
ctx.once(name, listener)                               // self-disposes after first call
await ctx.parallel(name, ...args)                      // Promise<void>, all settled
await ctx.serial(name, ...args)                        // first truthy bail wins
ctx.waterfall(name, ...args, innermostNext)            // returns outermost listener's value

// Fibers
const fiber = ctx.plugin(MyPlugin, config)             // Fiber & PromiseLike<Fiber>
await fiber                                            // rethrows startup/config errors
fiber.update(newConfig, true)                          // internal/update waterfall, noSave hint
fiber.restart()                                        // dispose + reload current config

// Plugin.Base metadata (any shape)
{ name?: string; Config?: StandardSchemaV1; inject?: Inject;
  provide?: string | string[]; intercept?: Dict<boolean> }
```

## Reference Tables
Context members:

| Member | Kind | Purpose |
|---|---|---|
| `ctx.root` | prop | root context (experimental) |
| `ctx.baseUrl` | prop | resolve relative module specifiers |
| `ctx.events` / `ctx.registry` / `ctx.reflect` | prop | event bus / plugin registry / service-resolver backing |
| `ctx.logger` | prop | call `ctx.logger(name)` for named logger |
| `ctx.fiber` | prop | the fiber owning this context |
| `ctx.on/once` | method | disposable listener (opts: `prepend`, `global`) |
| `ctx.emit/parallel/serial/bail/waterfall` | method | the five dispatch modes |
| `ctx.plugin/inject` | method | load plugin / deps+callback shorthand |
| `ctx.effect(body, label?)` | method | cleanup-aware effect on current fiber |
| `ctx.get/set/provide/accessor/mixin` | method | service-store primitives |
| `ctx.extend/isolate/intercept` | method | child-context scoping |
| `ctx.timer` (+ `interval/timeout/throttle/debounce`) | mixed | disposable timer helpers (vendor timer) |
| `ctx.loader` / `ctx.hmr` | service | present under loader / hmr plugins |

Fiber members: `uid`, `ctx`, `config`, `state` (transitions emit `internal/status`), `dispose`, `store`, `inertia`, `name` (nearest named ancestor, else `'root'`); methods `assertActive()`, `effect()`, `getEffects()`, `await()`, `restart()`, `update()`.

Inherited internal events (cordis core + loader/hmr/timer): `internal/plugin` (fiber created), `internal/status` (state change), `internal/service` (binding interception hook, no core producer), `internal/update` (config-update waterfall), `internal/get` / `internal/set` (store read/write waterfalls), `internal/listener`, `internal/dispatch`; `hmr/change`, `hmr/reload`; `exit`; `loader/config-update`, `loader/entry-init`, `loader/partial-dispose`, `loader/patch-context`.

## Key Takeaways
1. Dispatch mode is per-event and fixed: call the method that matches the declaration — `serial`'s "first truthy wins" is a bail, `waterfall`'s veto is skipping `next()`.
2. Isolation is label-joinable: two `isolate('name', label)` calls with the same label share one scope; visibility is ancestor/isolate shadowing only.
3. `provide` is duplicate-hostile within a scope and wakes dependents on unregister — service hot-swap is `dispose` + `provide` under the same name.
4. `intercept` config merges ancestor-first; declare consumption via `Plugin.Base.intercept` or the object form of `inject` so the context carries the entry.
5. Dispose semantics: reverse registration order, async disposers awaited but concurrent, double-dispose a no-op.
6. Diagnostics path: `fiber.getEffects()` → `EffectMeta` label tree; fiber state via `internal/status`; registry enumeration via `ctx.registry.values()` → `runtime.fibers`.

## Connects To
- **Ch 4**: the conceptual primer for every API listed here.
- **Ch 7**: which harness events/waterfalls to target with these APIs.
- **Ch 13**: session-core subsystem services mounted through this registry.
- **Ch 20**: regenerating/verifying the generated catalog (`gen-cordis-catalog`, `verify-cordis-catalog`).
