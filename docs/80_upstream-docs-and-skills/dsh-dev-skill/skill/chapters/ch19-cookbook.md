# Chapter 19: Extension Cookbook

## Core Idea
Every dsh product feature is a listener on a documented Cordis extension point — the microkernel claim, made checkable. The cookbook gives the exact files, code shapes, and verify commands for each extension recipe; no row modifies the agent loop.

## Frameworks Introduced
- **defineTool (typed tool contract)**: `ctx.tools.register(defineTool({ name, description, parameters, output: { schema, render }, execute(args, exec) }))`. Raw JSON-Schema `ToolDefinition`s are also accepted (that is how MCP tools arrive); `defineTool` is the typed first-party helper.
  - When to use: any first-party model-facing tool.
  - How: registration is `ctx.effect`-based (dispose unregisters; HMR-safe); schemas auto-flow into the system-prompt assembly.
- **Tool execution policy waterfall**: `tools/pre-execute` (extensible allow/deny/ask) → `ctx.tools.guard()` (monotonic final deny) → `tools/execute` (wrap dispatch: deadline/retry/metrics) → `tools/post-execute` (transform result) → `tools/result` (observe immutable outcome).
- **LlmAdapter**: `class MyAdapter extends LlmAdapter { async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> }`, registered via `ctx.llm.registerAdapter(['my-provider'], new MyAdapter())`. One adapter per route; duplicates throw; multi-route registration is all-or-nothing.
- **TypertRemoteService / @Remote**: remote-API owner extends `TypertRemoteService`, marks methods `@Remote('list')`; failures are one `RemoteError` class + a `RemoteErrorDetailsMap` code table.
- **dsh.client packaging**: a plugin's browser half ships via `dsh.client` in package.json + `exports["./client"]`, served by the client module system — appears on page with no web-app rebuild.

## Key Concepts
- **Waterfall**: reorderable middleware chain on a Cordis interception point; `next()` continues, a returned value short-circuits.
- **Canonical value**: the single lossless-JSON value `execute` returns; snapshotted, validated, frozen, passed to `output.render(args, value)`.
- **exec identity**: `callId`, `name`, `arguments`, `agent`, `token`, `signal`, optional `parent` are immutable through dispatch; only an around-dispatch wrapper may replace `exec.signal` (to impose a deadline), never remove it.
- **presentationMeta**: `output.presentationMeta(args, value)` derives replayable JSON; core persists it on `tool/result` for cards.
- **Render-intent union**: `presentCall`/`presentResult` return a `card`-tagged view (`generic`/`terminal`/`diff`/`read`/`search`/`web`); pure functions of args (+result) — run on replay, so NO I/O/state/clock.
- **RemoteResult<T>**: client-remote call result; branch `if (!result.ok)`, discriminate by `code` (narrows `details`), never `instanceof`.
- **Vendoring**: pinned source under `vendor/<dir>/` (not an npm dep); publishable release member (no `private`, `publishConfig.access: public`).
- **Role suffix**: `Controller`/`Store`/`Directory`/`Presenter`/`Registry`/`Runtime`/`Resolver`/`Binder`/`Engine`/`Policy`/`Executor`/`Gateway`/`Provider`/`Backend`/`Handle`/`Config`/`Service` — name the stable current responsibility, not the first implementation.
- **settingsScope**: browser-side `ctx.settingsScope.bind({ namespace })` fences each write with the revision it read; `set(field,value)`/`unset(field)`.
- **stackEntry**: GitHub's authoritative stacked-PR object — `PullRequest.stack` + `stackEntry.position` prove recognition; base branches establish order.

## Mental Models
- **Think of a permission gate as the reorderable policy layer**: hook plugins return a typed decision from `tools/pre-execute`; sandbox, permission, and plan-mode plugins reuse the same point. A "native hook" is an ordinary Cordis plugin — no external protocol.
- **Use `tools/result` for observation, `tools/post-execute` only to transform**: observing the immutable final outcome vs. replacing value/content/attaching context.
- **Think of the namespace as the join key**: the Host serves a settings namespace; the Plugins tab keys its card on that namespace; both halves register the same string → auto-paired, no repo change.
- **Think of a Remote call as non-throwing**: it returns `RemoteResult<T>`, never rejects; an assembly mistake should crash, not a defensive catch.

## Anti-patterns
- **Parsing prose for ids**: PTC mode / background branches must never recover a `jobId` from human prose — return `{ kind: 'background', jobId }` as the canonical handle.
- **UI formatting in the model result**: fenced `console` blocks, diffs, relativized paths belong in `presentationMeta` + card presenters, not `output.render`/canonical value.
- **Ad-hoc key files in adapters**: secrets are cordis-native (schemastery Config with env fallback, `!!js process.env.MY_KEY`); never read key files in code.
- **Silently dropping unsupported options**: throw `LlmError(..., 'UNSUPPORTED_OPTION')` rather than ignore a `GenerateOptions` field the provider can't honor.
- **`--force` on a rewritten stack push**: must be lease-protected, abort rather than overwrite a concurrently advanced remote head.
- **Copying the `api/remotes` split**: new packages never copy its repo-specific Host/Client phase split; an ordinary package joins exactly one aggregate.
- **Deep-comparing Remote errors**: assert `code` + details via `remoteErrorOf(...).toMatchObject`, never `toEqual` or `instanceof`.

## Code Examples

```ts
// Tool — minimal shape (typed args, canonical value, signal)
export const name = 'my-tool'; export const inject = ['tools']
export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file', description: 'Read a file from disk.',
    parameters: { path: { type: 'string', required: true, description: 'Absolute path' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    async execute(args, exec) {
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

```ts
// Hook (permission gate)
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) return { kind: 'deny', reason: 'Denied by policy.' }
    return next()
  })
}
```

```ts
// Remote API owner + failure table
export class NotesController extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'notesController', { namespace: 'notes' }) }
  @Remote('list')
  async remoteExportList(agent: Agent, signal: AbortSignal): Promise<NoteRow[]> { return this.list(agent, signal) }
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'note/not-found': { readonly noteId: string }
  }
}
throw new RemoteError('note/not-found', `no note "${noteId}"`, { noteId })
```

```ts
// Client remote consume
export const inject = ['remote', 'remote.notes']
const result = await ctx.remote.notes.list()
if (!result.ok) { if (result.error.code === 'note/not-found') return []; throw result.error }
```

```jsonc
// Browser-half packaging
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

## Reference Tables

### Recipe skeleton (goal → files → key shape → verify)

| Recipe | Files touched | Key shape | Verify |
|---|---|---|---|
| **New workspace package** | `packages/<group>/<pkg>/{package.json,tsconfig.json,src/index.ts,README.md}` + `tsconfig.{host,client}.json` references | `private:true`, cordis in peer+dev, schemastery in `dependencies`, `files` = `lib/index.js` + `lib/types/**/*.d.ts`; `.ts` import specifiers | `pnpm install` → `pnpm run doc-sync` → `pnpm run constraints && pnpm run typecheck && pnpm run lint` → `pnpm run build && pnpm run hygiene` |
| **Vendored package** | `vendor/<dir>/{package.json,tsconfig.json,src/,README.md}` + `tsconfig.base.json` paths + `tsconfig.host.json` ref (before `packages/*`) + `vendor/README.md` manifest row | rescope name, keep exports/type, `publishConfig.access:public` (no `private`), `outDir: lib/types`, strictness relaxations | `pnpm install` → `pnpm run typecheck` → `pnpm run build && pnpm run constraints`; stage manifest alongside source (`scripts/check-vendor-manifest.sh`) |
| **Add a tool** | one `src/index.ts` plugin; card methods `presentCall`/`presentResult` | `defineTool` + `execute(args, exec)` returning one canonical value | repository testing policy + owning package test docs |
| **Settings card** | Host `src/` + browser `src/client/` in one package, `dsh.client` export | Host `settingsCtx.settings.installSection(ctx, NS, Config, config, {validate, setSource, onChange})`; browser `ctx.slots.inject('settings.plugin.item', …)` | no repo change; appears when `cordis.yml` mounts it |
| **LLM adapter** | `packages/llm/llm-<name>/` | `extends LlmAdapter` + `stream()` generator + `registerAdapter` | repository testing policy (real-provider checks) |
| **Remote API** | Host controller (`packages/api/`) + client consumer | `TypertRemoteService` + `@Remote` + `RemoteErrorDetailsMap`; client `inject ['remote','remote.<ns>']` | `pnpm run build:lib` (after signature/code-table/namespace change) → `pnpm run typecheck` → `npx vitest run <owner> <client>` |

### LLM adapter protocol obligations
| Obligation | Rule |
|---|---|
| Ordering | Emit `usage` BEFORE `finish`; emit NOTHING after `finish` |
| Tool args | RAW JSON strings end-to-end; stream as `argumentsDelta`; re-stringify at `block-end` |
| Block index | Allocate in first-seen stream order; reuse for every delta |
| Errors | THROW (`LlmError` + stable code) OR `finish {kind:'error'|'aborted'}` — pick per class, document |
| Unsupported | `LlmError(..., 'UNSUPPORTED_OPTION')` for unhonoable `GenerateOptions` |
| Replay | `finish.replayState` = minimal lossless-JSON projection; validate when rebuilding history |

### Remote failure code placement
| Situation | Declare where |
|---|---|
| One producer | In the producing package, next to the throw |
| Several producers | Lowest domain package both depend on |
| Carrier codes `gateway/bad-request|cancelled|internal` | In protocol/gateway — use, never copy |
| Never crosses wire | Out of the code table; caller's own type |

## Key Takeaways
1. Every extension is a listener on a documented point; `ctx.effect`-based registration means vendored HMR "just works".
2. A tool's `execute` returns one canonical value; keep human prose in `output.render` and replayable UI state in `presentationMeta` + card presenters — they are pure (replay-safe).
3. Gate long work through `ctx.jobs.start({ kind, label, owner: exec.agent, run })`; a successful background branch returns `{ kind: 'background', jobId }`, never prose.
4. Register a new package by copying `packages/core/tools` and joining exactly one aggregate (`tsconfig.host.json` OR `tsconfig.client.json`); `pnpm run constraints` enforces the package.json invariants.
5. Vendor upstream Cordis packages as pinned `vendor/` source, not npm deps; stage the manifest alongside source or the pre-commit hook fails.
6. Remote failures are one `RemoteError` + code table, consumed as `RemoteResult<T>`; discriminate by `code`, not `instanceof`.
7. On a stacked-PR chain, fix the introducing PR then propagate up-stack (`gh stack rebase`/`gh stack push`), one worktree per PR, distinct commit per fix, never raw `--force`.

## Connects To
- **Ch 02**: `defineTool`/`ctx.tools.register` is the plugin-basics authoring path.
- **Ch 05**: `ctx.on`/`ctx.effect`/waterfall semantics are the Cordis API these recipes build on.
- **Ch 06**: the architecture doc owns the system + extension-point map that the feature→mechanism table summarizes.
- **Ch 09**: decorator semantics, lookup resolution, and the `/api` route (Remote mechanism) live in the API Gateway reference.
- **Ch 11**: `defineTool` soft-validation, `output.render`, and the card union feed the tool catalog.
- **Ch 15**: `tools/pre-execute`/`execute`/`post-execute`/`result` and the background-job runtime are the tool-execution subsystem.
- **Ch 20**: repository testing policy owns coverage/real-provider checks each recipe defers to.
