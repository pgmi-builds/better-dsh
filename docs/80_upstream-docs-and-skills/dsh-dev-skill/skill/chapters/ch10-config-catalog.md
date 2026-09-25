# Chapter 10: Config Catalog

## Core Idea
`config-catalog.md` is the **deployment-axis** reference: for every loadable harness package it pastes the verbatim `config:` block a `cordis.yml` entry can set, plus each plugin's `Requires:` injection line. It is **generated** from source (`scripts/gen-config-catalog.ts`), not a layering spec — the paste is the plugin's *full declared config type*, and any field the runtime schema deliberately excludes is a runtime-only seam that is **not settable from `cordis.yml`**.

## Frameworks Introduced
- **`config:` block (cordis.yml)**: the only settable surface catalogued here. The plugin's `apply`/service constructor receives the declared config type; referenced types are pasted (package-local) or linked.
- **`Requires:` line**: lists the service keys the plugin `inject`s — its `cordis.yml` tree must also load providers for those services. Scope = harness tier (`packages/`); vendored cordis plugins (`hmr`, console logger) are pinned upstream and not catalogued.
- **`static Config` / schemastery schema**: most plugins supply defaults statically and validate via a same-named schemastery schema; the generator cross-checks the schema against the pasted declaration so the paste cannot hide a loader-accepted field.
- **Generated + verified**: `pnpm run gen-config-catalog` regenerates; `verify-config-catalog` (part of `doc-sync`) checks freshness. Do not hand-edit.
- **Three package classes**: (1) **loadable** — with a `config:` block; (2) **loadable no-config** — a `cordis.yml` entry with no `config:`; (3) **seam** — abstract service classes (`AttachmentStore`, `SandboxProvider`, `SessionPersistence`, `CredentialProvider`, …) not directly loadable; (4) **library** — no plugin entry, cannot be loaded.

## Key Concepts
- **Home path convention**: `dshHome` (settings/credentials/shell-env/agent-instructions) defaults to `$DSH_HOME` then `~/.dsh`.
- **Runtime-only seam**: a field the schema excludes by design — its JSDoc says so; not settable from `cordis.yml`.
- **Preset-root precedence**: `agent-presets` `roots[]` scanned in precedence order (earlier wins a duplicate id); `includeShippedRoot` prepends the bundled `system` root, `includeUserRoot` appends the home `user` root.
- **`SandboxMode` / `ApprovalPolicy`**: shared deployment knobs — `sandbox-policy.mode` default `read-only`; `user-approval.policy` = `ask` (fail-closed) or `never` (deterministic CI/unattended).
- **Backend routing**: `storage-domain.backend` = default route, `routes` overrides per domain name; unknown backend fails `open` with `backend-not-found`.
- **No-default `root`s**: `session-persistence-jsonl.root`, `storage-json.root` have no default on purpose — a `process.cwd()` fallback would scatter files as cwd changes (bash/subprocess).

## Mental Models
- **Read the config type as the wire surface, not the runtime object**: the paste is exactly what `cordis.yml` may set; anything else is a runtime-only seam.
- **Think of each capability seam as "abstract service + concrete package"**: the *concrete* package (`dsh-bash-sandbox`, `dsh-storage-sqlite`, …) carries the config; the abstract seam package is never loaded directly.
- **Think of sandbox policy vs runner as split**: `sandbox-policy` owns `mode`/`workspaceRoot` (per-session resolution); the runner choice is the `ctx.sandbox` provider's config, not the executor's.

## Anti-patterns
- **Setting a runtime-only seam from `cordis.yml`**: it is deliberately excluded from the schema and will not apply.
- **Loading a seam or library package in `cordis.yml`**: seams are abstract (load a concrete impl), libraries have no plugin entry.
- **Defaulting storage/session `root` to `process.cwd()`**: scatters unit files across whatever cwd the process is in — the doc forces an explicit `root` for exactly this reason.
- **Assuming a full CLI>env>home>profile precedence chain lives in this doc**: it does not — this file documents the `config:` surface only; the layering/merge model is in ch01/ch02.

## Reference Tables

**Most-needed config keys** (`@deepseek-ai/` prefix omitted; type + default where declared)

| Key (package) | Type | Default | Purpose |
|---|---|---|---|
| `agent-default-model.provider` / `.model` | string | required | default provider route + model id |
| `agent-loop.agents[]` | array | required | agents created/resumed at startup (`id`, `sessionId`, `cwd`, `resumeSessionId`) |
| `agent-loop.maxParallelToolCalls` | number | `DEFAULT_MAX_PARALLEL_TOOL_CALLS` | parallel-safe calls per agent step (1 = serial) |
| `agent-presets.default` | string | required | preset id when caller names none (missing = loud fail) |
| `agent-presets.roots[]` | array | required | preset scan roots in precedence order |
| `agent-presets.includeShippedRoot` / `includeUserRoot` | bool | `true` | prepend bundled `system` / append home `user` root |
| `agent-tool-presentation.mode` | `'native'\|'ptc'\|'both'` | required | model-visible tool form |
| `agent-instructions.maxBytes` | number | required | UTF-8 byte cap per rendered baseline/dynamic batch |
| `llm-deepseek.apiKeyEnv` | string | `DEEPSEEK_API_KEY` | credential env-var name, resolved per request |
| `llm-deepseek.baseURL` | string | `$DEEPSEEK_BASE_URL` → public API | endpoint base |
| `llm-deepseek.thinking` | `'enabled'\|'disabled'` | provider default | deployment thinking policy |
| `llm-deepseek.reasoningEffort` | `'off'\|'low'\|'high'\|'max'` | `high` | default thinking effort |
| `llm-deepseek.maxTokens` | number | `256000` | default per-request output cap |
| `llm-deepseek.defaultContextWindow` | number | `1000000` | context capacity fallback |
| `llm-deepseek.models[]` | `DeepSeekCatalogModel[]` | V4 Flash/Pro/Flash Vision Exp | advertised selector models |
| `bash-local.cwd` | string | `process.cwd()` | default command working dir |
| `bash-local.timeoutMs` / `maxTimeoutMs` | number | — | foreground timeout + per-call override cap |
| `bash-local.maxOutputBytes` / `maxSpillBytes` | number | — | in-memory output / spill-file caps |
| `host-webserver.host` | `'127.0.0.1'\|'0.0.0.0'` | — | listen host |
| `host-webserver.port` | number | — | listen port (0 = OS-assigned) |
| `host-webserver.compression` | `'none'\|'gzip'` | `none` | response compression |
| `client-connection.trustedHosts` | string[] | — | non-loopback authorities for `/api` trust fence |
| `client-connection.cookieMaxAgeDays` | number | `30` | browser-session lifetime |
| `client-connection.maxRequestBodyBytes` | number | `300 MiB` | max buffered `/api` JSON body |
| `sandbox-policy.mode` | `SandboxMode` | `read-only` | file-sandbox default (fail-safe) |
| `sandbox-policy.workspaceRoot` | string | `process.cwd()` | fallback root (agentless / no-cwd) |
| `user-approval.policy` | `'ask'\|'never'` | `ask` | approval default (never = CI/unattended) |
| `permission-presets.presets` / `defaultPreset` | map / string | `workspace-write`,`danger-full-access` | preset knob table + new-session default |
| `session-persistence-jsonl.root` | string | required | session files root |
| `session-persistence-jsonl.compression` | `'zstd'\|'none'` | `zstd` | physical encoding |
| `storage-domain.backend` / `routes` | string / map | required | default backend + per-domain overrides |
| `storage-json.root` | string | required | `<unit>.json` file dir |
| `storage-sqlite.path` / `journalMode` | string / `'wal'\|'delete'\|'truncate'\|'persist'` | `:memory:` / `wal` | DB file + journal pragma |
| `mcp-client` (per server) | `StdioConfig`\|`StreamableHttpConfig` | — | `transport`, `serverName` (`mcp__<name>__<tool>`), `command`/`url`, `toolCallTimeoutMs` |
| `web.searchProvider` / `fetchProvider` | string | auto-select | pin which provider wins per capability |
| `web-app.openBrowser` / `printUrl` / `surfaceContext` / `trustedHosts` | bool/bool/bool/string[] | — | browser handoff, URL line, `app:web-surface` context, `--trusted-host` |
| `settings-file.path` | string | `settings.yaml` under home | settings doc location |
| `credentials-local.path` | string | `.credentials.yaml` under home | credentials doc location |
| `compaction-basic.thresholdRatio` / `retainRatio` | number | `0.8` / `0.16` | compact-at / retain fractions of context window |
| `persona.text` / `complete` | string / bool | — | persona prose; `complete` = whole system prompt |
| `tool-web.search` / `fetch` / `fetchMaxOutputChars` | bool/bool/number | `true`/`true`/`200000` | tool registration + fetch output cap |
| `tool-todo.allowParallelInProgress` | bool | required | allow multiple `in_progress` todos |
| `api-gateway.websocketHeartbeatIntervalMs` | number | `2000` | WS ping interval (1…2147483647 ms) |

**Where the rest lives**: the source doc's `## @deepseek-ai/dsh-*` sections (one per package, ~110 packages) carry the full verbatim declarations + JSDoc; its tail lists `Loadable plugins with no config`, `Seam packages`, and `Library packages`. For the runtime wire surface, see the generated Cordis API region on each `subsystems/core.md` page; model-facing tool schemas live in `tool-catalog.md`.

## Key Takeaways
1. Config is delivered through `cordis.yml` `config:` blocks — this catalog is the authoritative list of what each package accepts.
2. Every key's default and validation come from the plugin's `static Config` + schemastery schema, not from a central registry.
3. `Requires:` is load-critical: a config tree that omits an injected service fails to compose.
4. Storage/session `root` paths are deliberately default-less — state them explicitly to avoid cwd-scatter.
5. Deployment policy (sandbox mode, approval policy, trusted hosts, compaction thresholds) is spread across dedicated policy packages, not one global config.

## Connects To
- **Ch01 user-guide / Ch02 plugin-basics**: the `cordis.yml` layering and merge semantics (this doc covers only the per-package surface).
- **Ch05 cordis-api**: the generated Cordis API region on subsystem pages that these declarations reference.
- **Ch07 capability-seams**: the "seam packages" here are the abstract classes the seams chapter names.
- **Ch09 api-gateway**: `host-webserver`, `client-connection.trustedHosts`, and `api-gateway.websocketHeartbeatIntervalMs` configure the gateway transport.
- **Ch11 tool-catalog**: the model-facing tool schemas that `tool-web`, `tool-todo`, `tool-workflow`, `tool-bash` config keys shape.
- **Ch12 persistence-catalog**: `session-persistence-jsonl`, `storage-*`, `session-query-sqlite`, `session-projection-cache` backends.
