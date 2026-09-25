# Chapter 11: Tool Catalog

## Core Idea
This is a GENERATED registry of every model-facing tool a shipped plugin contributes to `ctx.tools`: the `name`, `description`, and JSON-Schema `parameters` delivered via system-prompt assembly. It is produced by BOOTING each tool plugin on a real context and reading `ctx.tools.schemas()` — not a static AST pass — because a tool schema is not statically knowable (runtime-spread enums, concatenated descriptions, config-driven names, raw-JSON-Schema MCP tools).

## Frameworks Introduced
- **Tool contribution = `{ name, description, parameters }` into `ctx.tools`**: a tool is the model-facing projection of a plugin's execute logic; `ctx.tools.schemas(scope)` projects an allowlist (name/description/parameters only) so `output`/`execute`/callbacks never leak into model requests.
  - When to use: every model-facing action. How: plugin contributes a `ToolDefinition`; the catalog generator boots it and reads the projected schema.
- **Capability-seam stability**: a tool keeps its provider behind an abstract seam (`ctx.lsp`, `ctx.web`, `ctx.subagents`, `ctx.codeRuntime`, `ctx.shell`, `ctx.fs`, `ctx.terminals`) so the model-visible schema stays stable across backend swaps.
  - When to use: any swappable backend (`lsp`, `web_search`/`web_fetch`, `subagent`).
- **Load-time config names / shipped aliases**: a registered `name` may be a load-time config (e.g. `tool-subagent`'s `toolName` default `subagent`, shipped alias `subagent_fork`); a deployment may expose a package under a different or additional name.
- **Reserved transport (`run_code`)**: owned by the tool registry outside filterable capability layers under `mode: ptc`/`mode: both`; under `ptc` it is the registry's only wire contribution — other capabilities are declared in a generated SDK section and re-enter the guarded tool pipeline via scheduled bindings (overlap up to `maxParallelSubCalls`).
- **Boot-and-read verification**: `gen-tool-catalog` generator + `verify-tool-catalog` (part of `doc-sync`); a completeness guard globs `packages/*/tool-*` and fails if a package is missing from the boot manifest, so a new tool cannot be silently undocumented.

## Key Concepts
- **ctx.tools**: the single registry of model-facing tools (see Ch 15 for the dispatch pipeline behind it).
- **Capability seam**: `ctx.shell`, `ctx.fs`, `ctx.subprocess`, `ctx.terminals`, `ctx.lsp`, `ctx.web`, `ctx.codeRuntime`, `ctx.subagents`, `ctx.workflowEngine`, `ctx.jobs` — abstract services a tool consumes; one provider per context.
- **Requires / Writes-affects**: the package map's two metadata columns — which seams a tool needs, and which events/durable effects it produces.
- **Shipped alias**: a second registered name for the same package (e.g. `subagent_fork` for a fixed-route delegation).
- **Reserved transport**: `run_code` — excluded from filterable capability layers; registry-owned.
- **Per-package deployment note**: records opt-in status, config branches, and defaults the generator had to choose (e.g. `todo_write`'s `allowParallelInProgress: true`).
- **Read-before-write policy**: added by `@deepseek-ai/dsh-fs-observation-policy` (an `fs/*` event-gate plugin) — no schema change; a deployment loading the fs tools is expected to also load it.

## Mental Models
- Think of the tool catalog as the **system-prompt assembly's menu**: what the model is *offered*, not what the runtime can *execute* (the Cordis surface is the latter).
- Think of a tool's schema as **runtime-spread**, never statically knowable — always boot to read it, never hand-transcribe.
- Use a **seam** when a capability may swap backends; keep the tool thin and let the seam own the vocabulary.
- Think of `run_code` as the **only non-filterable wire contribution** under `ptc` — everything else is reachable only through the code-runtime SDK.

## Anti-patterns
- **Hand-editing the generated catalog**: it is regenerated and re-verified by `doc-sync`; edits are overwritten.
- **Guessing an Inspect/LSP provider name**: `cordis_inspect_list`/provider discovery must precede `cordis_inspect_query`/`lsp`; an Inspect method is read-only, not a business Service plugin code can call.
- **Loading fs tools without the observation-policy plugin**: bare `write`/`edit` lose the read-before-write guard.
- **Treating `subagent`'s discovery schema as fixed**: model-selection on/off, background mode, and the registration name are per-instance config (`modelSelectionSettings`, `backgroundMode`, `enableRunInBackground`, `toolName`).

## Code Examples
```jsonc
// Tool schema shape every entry shares: { name, description, parameters }
{ "name": "bash",
  "description": "Execute a bash command (bash -c) and return stdout/stderr.",
  "parameters": { "type": "object",
    "properties": {
      "command": {"type":"string"},
      "description": {"type":"string"},
      "timeoutMs": {"type":"number"},
      "workdir": {"type":"string"},
      "run_in_background": {"type":"boolean"}
    }, "required": ["command","description"] } }
```
```ts
// run_code bridge: each nested call re-enters the guarded tool pipeline
// and links to the outer result via a tool/code-dispatch-start + tool/code-dispatch pair.
// sub-call id = `<parent>:code:<n>` (submission order); tool/result vocabulary carries content + isError.
```
```ts
type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover';
// schedule selectors: after_seconds | at | every_seconds (>= 300) — exactly one.
```

## Reference Tables
Full lookup table — name → one-line purpose, grouped by category. Per-tool JSON Schemas and exact field docs live in `src/docs/tool-catalog.md` (generated; ~90KB), package sections below its "Tool Package Map".

| Tool | Package | Purpose |
|---|---|---|
| **Human interaction** |||
| `ask_user_question` | dsh-tool-ask-user | Pause until the UI/provider returns a human answer (confirmation/choice/missing info). |
| `exit_plan_mode` | dsh-plan-mode | Present a plan for review; reject outside plan mode, no schema churn on policy change. |
| **Shell (one-shot, fresh process)** |||
| `bash` | dsh-tool-bash | Run `bash -c`, return stdout/stderr; `run_in_background` → job id. |
| `pwsh` | dsh-tool-pwsh | Windows `pwsh -Command` counterpart; mirrors bash minus sandbox controls. |
| **Shell (persistent PTY)** |||
| `bash` (persistent) | dsh-tool-bash-persistent | Owner-isolated persistent bash; cwd/env persist across calls. |
| `pwsh` (persistent) | dsh-tool-pwsh-persistent | Owner-isolated persistent pwsh. |
| **Filesystem** |||
| `read` / `write` / `edit` | dsh-tool-fs | UTF-8 read (line-numbered) / create-or-replace / literal-replace edit. |
| `read_image` | dsh-tool-fs | Read PNG/JPEG/WebP/GIF; refuses unless the routed model accepts image input. |
| `glob` / `grep` | dsh-tool-fs-search | Path discovery / ripgrep content search (packaged `@vscode/ripgrep`, no host rg). |
| `str_replace_editor` | dsh-tool-str-replace-editor | Standalone view/create/unique-literal-replace/insert editor. |
| **Terminals (opt-in)** |||
| `terminal_open`/`close`/`list`/`read`/`send`/`signal` | dsh-tool-terminal | Persistent terminal sessions; `send(run_in_background)` registers with `ctx.jobs`. |
| **Code runtime** |||
| `run_code` | dsh-tools | Execute a TypeScript program body against tools (PTC transport). |
| **Delegation & control** |||
| `subagent` / `list_subagent_models` | dsh-tool-subagent | Delegate a self-contained task / discover LLM routes. |
| `send_message` / `interrupt_agent` / `list_agents` | dsh-tool-subagent-control | Steer, interrupt, list continuable background subagents (global names). |
| `workflow` | dsh-tool-workflow | Orchestrate many subagents via a JS script (`agent`/`pipeline`/`parallel` hooks). |
| `ralph` | dsh-tool-ralph | Foreground fresh-agent loop; one immutable objective + optional round cap. |
| `spawn_teammate` | dsh-experimental-tool-agent-team | Create a named durable teammate (Team Lead only). |
| `team_task_*`, `wait_agent`, team `send_message`/`interrupt_agent`/`list_agents` | dsh-experimental-tool-agent-team | Shared task board (create/get/list/update) + team mailbox/status wait. |
| **Background jobs** |||
| `job_list` / `job_output` / `job_kill` | dsh-tool-jobs | Kind-agnostic controller: bash, PTY sends, subagents all through the same three. |
| **Goal (same-session)** |||
| `create_goal` / `get_goal` / `update_goal` | dsh-tool-goal | Persisted long-running objective; direct-human root authority for mutations. |
| **Schedule** |||
| `schedule_create` / `schedule_delete` / `schedule_list` | dsh-schedule | Session-local reminders (after_seconds | at | every_seconds≥300). |
| **Session query (opt-in)** |||
| `session_search` / `session_trace` / `session_event_read` / `session_event_search` / `session_event_trace` | dsh-tool-session-query | Read-only search/trace over the durable event log, authorized by the calling agent. |
| **Skill** |||
| `skill` | dsh-tool-skill | Load full instructions for a named skill from the session catalog. |
| **Web** |||
| `web_search` / `web_fetch` | dsh-tool-web | Search (1–4 queries) / fetch a URL; provider behind `ctx.web`. |
| **LSP** |||
| `lsp` | dsh-tool-lsp | Code navigation (definition/references/implementation/hover); `LSP_UNAVAILABLE` without a provider. |
| **Dynamic Cordis (opt-in)** |||
| `cordis_define`/`inspect_list`/`inspect_query`/`inspect_self`/`run`/`stop`/`undefine` | dsh-tool-cordis | Define/inspect/run immutable Cordis packages in a vm sandbox (not in any shipped tree). |
| **TODO** |||
| `todo_write` | dsh-tool-todo | Session-owned checklist; whole-list replace (no partial updates). |

## Key Takeaways
1. The catalog is the *offered* tools (name/description/parameters), generated by booting each plugin and reading `ctx.tools.schemas()` — never a static AST pass.
2. Every tool maps to a **package** + **seams** (`Requires`) + **durable effects** (`Writes/affects`); the package map is the primary index.
3. Keep swappable capabilities behind a seam (`ctx.web`, `ctx.lsp`, `ctx.subagents`) so the schema does not change on backend swap.
4. `run_code` is the registry's reserved transport — the only wire contribution under `ptc`; other capabilities reach it via scheduled bindings.
5. Registration names can be config-driven and aliased (`subagent`/`subagent_fork`); deployment notes record shipped aliases and generator-chosen defaults.

## Connects To
- **Ch 15**: `ctx.tools` dispatch pipeline (ToolDefinition, guards, observation policy) behind these schemas.
- **Ch 07**: capability seams — the Service/Provider/Consumer split each tool leans on.
- **Ch 16**: `tool/call`, `tool/result`, `tool/code-dispatch*` are the durable session-log facts tools emit.
- **Ch 10**: config keys that shape tools (`toolName`, `enableRunInBackground`, `sampleOverCapGlobResults`, preset tables).
- **Ch 14**: the agent loop requests these tools and commits their call/result events.
