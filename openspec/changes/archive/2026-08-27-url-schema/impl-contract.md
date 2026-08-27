# DASHR URL Schema implementation contract (v0.1.8d)

Cross-task shared contract. Every doer reads this file + `openspec/changes/url-schema/design.md` + `tasks.md`.

## Repository baseline
- **Repo root** `/home/u1/workspaces/dashr/`; **package root (npm/tsc working dir)** = `/home/u1/workspaces/dashr/dashr/`. All source paths below are relative to the package root (`src/index.ts`, `cordis.patch.yml`, `tsconfig.json`, `node_modules/@deepseek-ai/dsh-tools/`).
- build: `npm run build` (tsdown, from the package root); typecheck: `npm run typecheck` (tsc --noEmit); test: `npm run test` (vitest --run).
- Every task acceptance runs at least `npm run typecheck`. Full suite runs once at integration time (8.1 / 9.12 — green at 239/239 for v0.1.8d).

## Architecture decisions (binding — see design.md for rationale)
1. One plugin `dsh-url-schema`, module dir `dashr/src/url-schema/`, mounted by `dashr-repl` via `ctx.plugin()`; `inject = ['tools','fs','skills','subagents','sessions','settings','agents']` (NO `replRuntime` — nothing reads it anymore).
2. The plugin owns: the URL resolver, the URL-aware read/write/grep/glob, the vendored hashline, all scheme handlers, the dvc write placeholder. `dashr-repl` contributes only the `'skill'` entry in `MASKED_TOOL_NAMES`.
3. **Delegation architecture (v0.1.8d)**: at `agent/session-start`, `captureNativeTools(ctx, agent)` snapshots the native `write`/`grep`/`glob` definitions via `ctx.tools.get(name, agent)` — strictly BEFORE the wrappers register on the agent's own scope layer (a later capture would resolve to the wrapper itself: infinite recursion). Cached per agent in a `WeakMap`. Non-URL inputs delegate verbatim: `native.execute(args, exec)`. Missing definitions surface as `NATIVE_*_UNAVAILABLE` only at call time.
4. `read` captures nothing: URL branch → resolver; file branch → vendored hashline (`readAndServe` over `ctxFsIO`, anchors + snapshot store for the vendored edit chain).
5. `write` URL branch: every scheme write rejected this wave via the structured dispatch (`writeScheme` hook overridable when a real write channel lands).

## File layout (landed)
```
dashr/src/url-schema/
  index.ts            # plugin entry: name='dsh-url-schema', inject=[...], apply(ctx)
  resolver.ts         # UrlResolver: register/resolve/resolvePath
  selector.ts         # parseUrl + applySelector + UrlSchemaError
  native-capture.ts   # captureNativeTools (capture-before-register, WeakMap<Agent>)
  docs-dir.ts         # resolveDocsDir: nearest-first walk-up for the docs tree
  handlers/{skill,agent,dsh,ctx,dvc,http}.ts
  tools/{read,write,grep,glob}.ts
  tools/materialize.ts  # withTempMaterialization for content-backed searches
  vendored/hashline/    # vendored dsh-better-edit lib (JS + .d.ts)
```

## Resolver + factory signatures (as landed)
```ts
// selector.ts
export type Selector =
  | { kind: 'raw' }
  | { kind: 'lines'; ranges: Array<[number, number]> }
  | { kind: 'path'; value: string }
  | { kind: 'query'; q: string }
export interface ParsedUrl { scheme: string; path: string; selector: Selector | null }
export function parseUrl(raw: string): ParsedUrl          // no scheme → URL_NO_SCHEME
export function applySelector(text: string, sel: Selector | null): string
export class UrlSchemaError extends Error { code: string } // structured error carrier

// resolver.ts
export interface ResolverEnv {}                            // handlers widen it (agent/cwd/rawUrl)
export interface SchemeHandler {
  resolve(env: ResolverEnv, path: string): Promise<string>                    // FULL text
  resolvePath?(env: ResolverEnv, path: string): Promise<string | undefined>   // path-backed only
}
export class UrlResolver {
  register(scheme: string, handler: SchemeHandler): void
  resolve(env: ResolverEnv, url: string): Promise<string>      // parse → dispatch → applySelector
  resolvePath(env: ResolverEnv, url: string): Promise<string | undefined>  // selectors NOT applied
}

// native-capture.ts
export function captureNativeTools(ctx: Context, agent: Agent): NativeToolSet // {write?,grep?,glob?}

// handlers
createSkillHandler(deps: { skills: SkillRegistrySurface; fs: SkillFsSurface }): SchemeHandler   // + resolvePath
createAgentHandler(deps: { sessions; subagents; agents? }): SchemeHandler
createDshHandler(deps: { settings?: SettingsProvider; docsDir?: string }): SchemeHandler
createCtxHandler(): SchemeHandler                                 // reads env.agent
createDvcHandler(deps?: DvcHandlerDeps): SchemeHandler            // placeholder
createHttpHandler(): SchemeHandler                                // register under HTTP_SCHEMES both
export const HTTP_SCHEMES = ['http', 'https'] as const
export function dispatchDvcWrite(path: string, content: string): never  // DVC_NO_DEVICE

// tools (registered on the agent's own scope layer)
createReadTool(deps: { resolver; fs: FileSystem; ctx: Context }): ToolDefinition
createWriteTool(deps: { nativeWrite?: ToolDefinition; writeScheme?: (...) => Promise<WriteOutcome> }): ToolDefinition
createGrepTool(deps: { resolver; nativeGrep?: ToolDefinition }): ToolDefinition
createGlobTool(deps: { resolver; nativeGlob?: ToolDefinition }): ToolDefinition

// docs-dir.ts
export function resolveDocsDir(): string | undefined
```

## Registered schemes (v0.1.8d)
`skill`, `agent`, `dsh`, `ctx`, `dvc`, `http`, `https` (http/https share one stateless handler instance). `history://` has no special case → `URL_UNREGISTERED_SCHEME`. The device scheme is `dvc://` (the `xd` name is gone).

## Error-code inventory (structured `UrlSchemaError.code`)
- **Parse/routing**: `URL_NO_SCHEME`, `URL_UNREGISTERED_SCHEME`, `URL_BAD_SELECTOR`, `URL_INVALID` (http URL parse/protocol)
- **skill**: `URL_SKILL_NOT_FOUND`, `URL_SKILL_NO_RESOURCE_BASE`, `URL_SKILL_RESOURCE_ESCAPE`
- **agent**: `AGENT_UNKNOWN_ID` (unknown id / unknown child / child not live), `AGENT_BAD_PATH` (>2 segments)
- **dsh**: `URL_DOCS_UNAVAILABLE`, `URL_DOC_NOT_FOUND` (missing / escape / not a file), `URL_SETTINGS_UNAVAILABLE`, `URL_UNKNOWN_SETTINGS_NAMESPACE`, `URL_UNKNOWN_RESOURCE`
- **ctx**: `CTX_NO_AGENT`, `CTX_UNKNOWN_KEY`
- **dvc**: `DVC_NO_DEVICE` (write dispatch)
- **http**: `URL_HTTP_TIMEOUT`, `URL_HTTP_FETCH_FAILED`, `URL_HTTP_STATUS`, `URL_HTTP_TOO_LARGE`, `URL_HTTP_UNSUPPORTED_MEDIA`
- **write dispatch**: `URL_READ_ONLY` (ctx), `URL_WRITE_UNSUPPORTED` (other registered schemes), plus `URL_UNREGISTERED_SCHEME`
- **delegation**: `NATIVE_WRITE_UNAVAILABLE`, `NATIVE_GREP_UNAVAILABLE`, `NATIVE_GLOB_UNAVAILABLE`

## vendored hashline
- Source: dsh-better-edit's published `lib/` (compiled JS + `.d.ts`; no TS source ships in the package), copied into `src/vendored/hashline/`.
- Runtime deps carried by DASHR: `diff`, `file-type`, `xxhash-wasm`.
- Attribution: LICENSE/README carry the 4-layer copyright chain (see design.md D2). The external BetterEdit mount was removed from `cordis.patch.yml`.

## Acceptance principles
- Doer output is verified by a reviewer: contract consistency, `npm run typecheck` green, behavior matching the task's acceptance line.
- Final acceptance is run by the main agent per task group; the v0.1.8d full-suite run is 9.12 (239/239 green).
