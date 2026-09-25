# Chapter 4: Cordis Fundamentals (Primer + Tutorial)

## Core Idea
Cordis is the vendored plugin framework underneath dsh: every capability — tools, LLM adapters, the agent loop itself — is a plugin mounted into a shared `Context`, composed by a `cordis.yml` file. A plugin describes what it contributes (services, events, effects); the config file composes the application.

## Frameworks Introduced
- **Plugin = `{ name?, inject?, Config?, apply(ctx, config) }`**: three accepted shapes — function plugin (most common), object plugin with `apply` method, class plugin (`Service` subclass).
  - When to use: function form until you need to expose a service; then `extends Service` with `super(ctx, 'name')`.
  - How: module exports `apply` (plus optional `name` display metadata); the Loader resolves it from a `cordis.yml` entry `name:` field (module specifier: relative path or npm package).
- **Service provide/consume**: a named capability one plugin provides (`ctx.<key>`) and others consume via `inject`.
  - When to use: any shared capability — harness's `ctx.tools`, `ctx.llm`, `ctx.agents` are services.
  - How: provider mounts a `Service` subclass (`super(ctx, 'greeter')` registers as `ctx.greeter`); consumer declares `export const inject = ['greeter']` — Cordis holds it PENDING until the service exists, so `apply` sees it ready. Load order comes from `inject`, never YAML position.
- **Typed events via declaration merging**: `declare module '@deepseek-ai/cordis' { interface Events { 'ns/action'(args): void } }` declares name + listener signature; generates no runtime code.
  - When to use: announce something without knowing listeners (tool results, model requests, approval decisions).
  - How: `ctx.emit(name, ...args)`; listen with `ctx.on(name, listener)` (an effect — auto-removed on unload). Event names use `namespace/action` convention.
- **Effect/disposer cleanup model**: every registration is a reversible effect, undone when the owning plugin unloads.
  - When to use: any resource — Cordis-managed APIs (`ctx.on`, `ctx.plugin`, service/harness registrations like `ctx.tools.register`) are already effects; wrap unmanaged resources (timers, connections, watchers) in `ctx.effect(() => { ...acquire; return () => release })`.
  - How: disposers run in reverse registration order; async disposers run concurrently — if teardown order matters, keep steps in one disposer and await them there.
- **Config schema + static declarations**: exported `Config` is both a TS interface and a runtime schema; validated before `apply` runs.
  - When to use: any `cordis.yml` entry `config:` block.
  - How: Schemastery `Schema.object({...})` with `.default()`s — `apply` always receives complete, validated config; invalid config → fiber FAILED, loud `ValidationError` (never half-started).
- **Composition & HMR**: `cordis.yml` entries carry `{id, name, config, inject, disabled}`; HMR = unload + reload a plugin on file save.
  - When to use: editing plugins or the config file at dev time; `@deepseek-ai/cordis-plugin-hmr` (needs `logger-console` + `timer` plugins, runs under tsx).
  - How: give entries explicit `id`s — the loader diffs by `id`; an id-less entry gets a fresh generated id each read, so any config edit remounts it as removed-plus-added. `disabled: true` unmounts without deleting the entry. Groups nest entries that load/unload as one unit; `isolate` gives a group its own instance of a service name.
- **Loader `!!js` expressions**: `@deepseek-ai/cordis-plugin-include` parses `!!js` into expression nodes.
  - When to use: config values computed at load time (e.g. `greeting: !!js process.env.DEMO_GREETING ?? 'Hello'`) or gating rows by environment.
  - How: works only inside `config` (evaluated after declared injections activate, against that plugin's context) and in `disabled` (evaluated against loader context at every mount decision). Other metadata stays literal.

## Key Concepts
- **Context (`ctx`)**: the object `apply` receives; the repository of services through which the plugin registers everything it contributes.
- **Fiber**: the runtime handle for one loaded plugin instance; `ctx.plugin(fn)` returns it, `fiber.dispose()` resolves after all cleanup.
- **`inject`**: hard service requirements; re-checked live — if a required service disappears, dependents unload and reload when it returns (this is how service replacement works in config).
- **PENDING**: legitimate wait state — plugin's `inject` names a service nobody provides; prints nothing, keeps no event loop alive (app exits 0 silently).
- **Dispatch mode**: part of an event's public contract (`@mode` tag); decides awaitedness, order, and return semantics.
- **Waterfall veto**: a listener returning without calling `next()` short-circuits the chain (innermost default never runs).
- **Declaration merging**: TS `declare module` blocks add to `Context`/`Events` interfaces for typechecking only; consumers pull them in via `import type {} from './provider.ts'`.
- **`ctx.get('name')`**: optional-dependency probe — `undefined` when no provider; the plugin still runs (vs `inject` for hard requirements).
- **Service namespace**: one flat namespace per application; harness claims plain names (`tools`, `llm`) — prefix your own distinctively.

## Mental Models
- Think of `cordis.yml` as the application: there is no framework bootstrap code in your file; the dsh base profile is just a longer plugin composition that deployment overlays patch.
- Use `inject` (not list position) when plugins must start in an order — entries start concurrently; dependencies, not file order, decide startup.
- Think of a waterfall as around-middleware: each listener wraps the rest of the chain; the value propagates through `next()`'s return.
- Use `fiber.state` inspection when a plugin "does nothing": iterate `ctx.registry.values()` → `runtime.fibers`, filter `FiberState.PENDING`.

## Anti-patterns
- **Forgetting `next()` in an observe/annotate waterfall listener**: silently swallows default behavior for everyone downstream — deliberate short-circuit only.
- **Managing resources outside `ctx.effect()`**: leaks on unload/hot-reload; the pending callback fires on a dead app.
- **Trusting YAML entry order**: guarantees nothing; unsatisfied `inject` = eternal silent PENDING.
- **Relying on boot-time crash for unresolvable entries**: a typo'd module specifier is reported through the Cordis logger service — lost before a console exporter watches; check spelling first when a new entry does nothing.
- **Plain-object `Config` export**: Cordis accepts any Standard Schema validator, but a plain object is not one — validation silently skipped/failed shape.
- **Separate async disposers needing sequence**: they run concurrently; sequence must live inside one disposer.

## Code Examples
```ts
// Three plugin shapes
export function apply(ctx: Context) {}                       // 1. function
export const objectPlugin = { name, apply(ctx) {} }          // 2. object
export class MyService extends Service {                    // 3. class (Service)
  constructor(ctx: Context) { super(ctx, 'myTutorialService') }
}

// Service + declaration merging + consumer
declare module '@deepseek-ai/cordis' {
  interface Context { greeter: GreeterService }
  interface Events { 'stats/report'(name: string, count: number): void }
}
export const inject = ['greeter']
export function apply(ctx: Context) { ctx.greeter.greet('world') }

// Optional dependency
const greeter = ctx.get('greeter')  // undefined-safe probe

// Effect with disposer
ctx.effect(() => {
  const timer = setInterval(tick, 200)
  return () => clearInterval(timer)
})

// Waterfall listener discipline
ctx.on('demo/transform', async (input, next) => {
  if (input.includes('blocked')) return '** blocked **'  // veto
  return (await next()).toUpperCase()                     // wrap
})

// Config schema
export interface Config { greeting: string; targets: string[] }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

// Diagnosing silent plugins
for (const runtime of ctx.registry.values())
  for (const fiber of runtime.fibers)
    if (fiber.state === FiberState.PENDING)
      console.log(`${fiber.name} is PENDING — a required service is missing`)
```

## Reference Tables
Dispatch modes (event's contract, checked by `@mode` in generated catalogs):

| Mode | Call | Awaited? | Order | Return |
|---|---|---|---|---|
| `emit` | `ctx.emit(name, ...args)` | No | registration order | none |
| `parallel` | `await ctx.parallel(...)` | Yes | all concurrent | none |
| `serial` | `await ctx.serial(...)` | Yes | registration order | first non-null/false/undefined wins, stops rest |
| `bail` | `ctx.bail(...)` | No | registration order | first bail value |
| `waterfall` | `ctx.waterfall(name, ...args, next)` | — | around-middleware | outermost listener's return |

Fiber state machine: `PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`, `LOADING → FAILED` (apply or config validation threw).

Config entry fields: `id` (stable identity for diffing), `name` (module specifier), `config` (validated; `!!js` allowed), `inject`, `disabled` (`!!js` allowed, evaluated per mount decision), groups + `isolate`.

## Key Takeaways
1. Encapsulate behavior into plugins by domain: tool pipeline events belong to `ctx.tools`, model streaming to `ctx.llm`, agent coordination to `ctx.agents`.
2. Prefer events for interception and policy; prefer service methods for direct capability calls.
3. Every registration should have a disposer — return one from `ctx.effect()` or use a Cordis helper that does it for you (`ctx.on`, `ctx.plugin`, `ctx.tools.register`).
4. `fiber.dispose()` recursively unloads child plugins mounted via `ctx.plugin`; mount-from-code and YAML loading are the same operation.
5. Silent plugin = check fiber state first; PENDING is the usual answer.
6. `inject` is live-tracked after load: hot-swapping a provider cleanly restarts all dependents.
7. `apply` receives `(ctx, config)` — config always complete and validated; reject schema-valid-but-unresolvable references (e.g. missing provider) as early as you can detect them.

## Connects To
- **Ch 2**: plugin packaging and loading of these Cordis shapes into dsh profiles.
- **Ch 3**: framework practice — how real dsh plugins use services/events/config composition.
- **Ch 5**: exact API signatures for every `ctx` member introduced here.
- **Ch 6**: the architecture map these plugins compose into.
- **Ch 7**: capability seams — which harness events/waterfalls (e.g. `agent/request`, `approval/request`) to hook.
