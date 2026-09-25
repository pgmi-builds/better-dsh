# Chapter 2: Plugin Development Basics

## Core Idea
A dsh plugin is a Cordis module — `apply(ctx)` plus declarative `name` / `inject` / `Config` exports — where every `ctx` registration is a lifecycle-managed effect; shipping it means packaging a patch layer (bundle) that a profile composes in a fixed order.

## Frameworks Introduced
- **Plugin apply contract**: a TypeScript module exporting `name`, optional `inject`, and `apply(ctx)` (or object/class default export). The framework calls `apply` only after every injected service is ready.
  - When to use: function form covers most cases; class form (`extends Service`, `static inject`, `super(ctx, 'svc')`) when the plugin provides a service to other plugins.
  - How: dev overlay `- insert: [{id, name: '/absolute/path/src/my-plugin.ts'}]` → `pnpm dsh web --patch ./cordis.yml`.
- **Schemastery Config schema**: `export interface Config` + `export const Config: Schema<Config> = Schema.object({...})` with `.default()` / `.required()` / `.union()`.
  - When to use: anything two deployments may want to set differently — Harness requires this as a config field.
  - How: `apply(ctx, config)` receives validated, default-filled config. Cordis validates while loading; invalid config fails the load with an actionable error. Config values arrive via the plugin row's `config:` key.
- **`defineTool` DSL** (`@deepseek-ai/dsh-tools`): declarative tool — `parameters` (arg inference/validation), `output.schema` (canonical value type), `output.render` (value → model-facing content), `execute`.
  - When to use: exposing any model-callable capability.
  - How: `export const inject = ['tools']`, then `ctx.tools.register(defineTool({...}))`.
- **Bundle manifest**: npm package declaring `dsh: { bundle: { patch: './cordis.patch.yml' } }`; patch rows reference the package by name so Node resolution finds the installed code. Answers "what does this package contribute?"
- **Profile manifest**: `$DSH_HOME/profiles/<name>/` — `package.json` with ordered `dsh.profile.bundles` + a user `cordis.patch.yml` layer. Answers "which bundles compose this setup, in what order?" Created and maintained by `dsh plugin`, never written by hand.
- **App-owned command line**: a provider plugin with `inject = ['cmdlineArgs']` calling `parseCmdline` from `@deepseek-ai/dsh-cmdline` with its own commander program, publishing an app-owned service from the program's action.

## Key Concepts
- **`ctx.effect(() => disposer)`**: escape hatch for resources `ctx` doesn't track (sockets, intervals); the returned function runs on unload.
- **Automatic cleanup**: `ctx.on`, `ctx.tools.register`, `ctx.llm.registerAdapter`, `ctx.effect` are all undone at unload — no manual `removeListener`/`clearInterval`.
- **HMR**: a config or source edit hot-replaces the plugin (unload old → load new → run new `apply`); old registrations never leak.
- **Layer order**: bundle patches in `dsh.profile.bundles` list order → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays in argv order. Later layers win per row.
- **Row override**: a patch replaces a row's entire `config` value, never deep-merging keys — restate every key the row needs.
- **In-box bundles** (`@deepseek-ai/dsh-base`): always resolve from the dsh installation itself; pnpm manages only out-of-tree packages.
- **`prepare` script**: what pnpm runs after a git install; must be self-contained (no sibling-monorepo assumptions). turtle-ui's dedicated tsdown config is the working example.
- **`allowBuilds`**: pnpm ≥10 gate for a git dependency's build scripts, keyed in the profile's `pnpm-workspace.yaml` (`allowBuilds: { 'dsh-hello-plugin': true }`); granting it = permission to execute the package's code on your machine at install time.
- **Plain dependency**: a package without `dsh.bundle` installs with a warning and activates no layer — the library format for code that plugin packages import.

## Mental Models
- Think of a plugin as a block scoped to `apply`: when the block exits (unload, HMR, dependency loss), everything it registered vanishes.
- Think of a bundle as "one patch layer in an npm package" and a profile as "an ordered list of such layers with user patches on top"; a bundle is authored and distributed, a profile is booted — nothing is both.
- Use absolute paths in dev overlays because a patch contributes configuration only — it never changes the directory the loader resolves module paths from.
- Treat `dsh --profile <name> --dump-config` as the no-boot layer inspector: each bundle shows as a `# == <pkg>` section.

## Anti-patterns
- **Plain-object `Config` export**: doesn't implement the Standard Schema interface Cordis requires.
- **Hardcoded tunables**: if `cordis.yml` cannot change the value without a code edit, it must become a config field.
- **Partial row override**: patching only the changed key drops the rest of the row's config (whole-value replacement).
- **Relative plugin path in an overlay**: loader resolves from the profile directory, not the patch file's location.
- **Git install without `prepare`**: sources arrive unbuilt — a TS package loads without its `lib/`.
- **Unpinned git adds with `allowBuilds`**: a later push silently changes what executes at install time; pin `github:you/pkg#<sha>` and only allowlist source you trust.

## Code Examples
Config + tool in one plugin:
```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export interface Config { greeting: string; maxRetries: number }
export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: { name: { type: 'string', required: true, description: 'The name to greet' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) { return `${config.greeting}, ${args.name}!` },
  }))
}
```
Bundle package + patch:
```json
{ "name": "dsh-hello-plugin", "version": "0.1.0", "type": "module", "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```
```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin     # package name, not a path
```
Surface-bundle flag row (rows stay dormant under `--help` because the provider publishes no service):
```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```
Install / inspect / remove:
```sh
dsh plugin --profile demo add ./hello-plugin   # pnpm link + append to dsh.profile.bundles
dsh --profile demo --dump-config               # shows the "# == dsh-hello-plugin" layer
dsh plugin --profile demo remove dsh-hello-plugin
```

## Reference Tables
| Plugin form | Export | Use when |
|---|---|---|
| Function | `export const name` / `inject` + `export function apply` | most cases |
| Object | `export default { name, inject, apply }` | grouping options |
| Class | `export default class extends Service` | providing a service to other plugins |

| Distribution | User command | Build happens |
|---|---|---|
| npm | `dsh plugin --profile demo add your-package` | at `pnpm publish` (ship built `lib/`) |
| tarball | `dsh plugin add ./hello-plugin-0.1.0.tgz` | at `pnpm pack` |
| git | `dsh plugin add github:you/pkg#<sha>` | author's `prepare` + user's `allowBuilds` |

Layer composition (later wins per row): 1. bundle patches in `bundles` list order (`@deepseek-ai/dsh-base` first) → 2. profile `cordis.patch.yml` → 3. home `$DSH_HOME/cordis.patch.yml` → 4. `--patch` overlays in argv order. App arguments are not a patch layer.

## Key Takeaways
1. `dsh plugin --profile <name> <args...>` just forwards to pnpm in the profile directory — every pnpm verb works; first use initializes the profile with `@deepseek-ai/dsh-base` first in `bundles`.
2. `execute` returns the canonical value declared by `output.schema`; `output.render` converts that value into model-facing content blocks.
3. Fail loudly at load: self-contained constraints belong in the schema; constraints referencing live services or registered resources need dependency injection (Ch 3).
4. Users can override your rows in their profile patch without touching your package — prefer defaults they'll keep and let the schema carry the rest.
5. A surface bundle needs no launcher change for its own flags: all plugins receive the same immutable post-launcher args snapshot, and multiple plugins may parse it independently.
6. Loader evaluates a row's `!!js` config only after that row's ordinary injections resolve — config expressions can read injected services with a deployment fallback beside them.

## Connects To
- **Ch 3**: lifecycle, events, services, and the three-role capability split build directly on `apply` / `inject` / `ctx.effect`.
- **Ch 4 / Ch 5**: Cordis fundamentals and API own the loader, Fiber, and patch semantics summarized here.
- **Ch 11**: full tool-authoring reference — nested schemas, canonical values, background work, policy hooks, PTC mode, UI cards.
- **Ch 10**: the generated config catalog is derived from these `Config` schemas.
