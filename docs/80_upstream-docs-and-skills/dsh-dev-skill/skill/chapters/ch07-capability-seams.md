# Chapter 7: Capability Seams

## Core Idea
A seam is a swappable capability with three roles — a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it (commonly a model-facing tool); one role alone is not a seam, and adding a capability means designing all three. Because filesystem and subprocess providers share one execution world, one provider swap — e.g. to a remote sandbox — moves Bash, PTY, and LSP with it, with no provider forks.

## Frameworks Introduced
- **Three-role seam (Definition / Provider / Consumer)**: the unit of extensibility.
  - When to use: any capability that should be swappable — LLM, fs, shell, sandbox, storage, subagents, web, skills.
  - How: declare the interface as a Cordis service; providers register implementations into it; keep consumers provider-neutral.
- **Service classification (`core` / `seam` / `bundle`)**: every `ctx` service carries a Role in the capability graph — `core` = spine with one owner (project onto it, don't replace it), `seam` = swappable with named implementations, `bundle` = composition point (only `ctx.agentLoop`).
- **Execution world**: `ctx.fs` + `ctx.subprocess` + `ctx.sandbox` (+ `ctx.e2b`, one shared E2B SDK handle so both E2B providers inhabit the same Linux runtime) move together; swap the set, not one package.
- **Companion plugin / event gate**: policy contributed via events instead of a provider — `fs-observation-policy` adds observed-state checks through the `fs/*` gate without replacing `ctx.fs`; `spill-policy` decides spilling at `tools/post-execute` while `ctx.spillStore` just saves.

## Key Concepts
- **Sole-provider seam**: exactly one optional async provider allowed (`ctx.sessionTitle`: first-prompt-llm or all-prompts-llm), with the deterministic fallback owned by the seam itself.
- **Named side-by-side providers**: backends register under names in one registry (`ctx.storage` json/sqlite; `ctx.llm`; `ctx.web`).
- **Single-engine service**: no provider registry at all — `ctx.workflowEngine` is one engine per context.
- **Provider-neutral tool**: model-facing tools consume the seam, never an implementation (`tool-web` owns the stable model-facing names over `ctx.web` providers; `tool-bash`/`tool-pwsh` over `ctx.shell`).
- **Remote controller**: API controllers (`ctx.sessionController`, `ctx.settingsController`, `ctx.workspaceController`, `ctx.credentialsController`, `ctx.directoryPickerController`) project seams onto the generated Remote namespace — redaction and refusal classification live in the controller, not the seam Definition.
- **Fails-closed approval**: `ctx.approval` dispatches one-shot decisions over the `approval/request` waterfall; answerers are listeners (the ACP bridge for its own agents); absence fails closed to `unavailable`.
- **Per-operation credential resolution**: config carries references, providers own values (`ctx.credentials`); a rotated credential reaches the very next request; views are value-free, storage write-only.
- **`ctx.invariants`**: companion subpaths register owner-local checks; the service owns selection, uniqueness, child fibers, package-attributed failures.

## Mental Models
- Use a seam when two or more implementations are plausible (local vs sandbox vs remote); use `core` when the service is a spine others project onto.
- Think of providers as replaceable behind one interface, with tools as the stable model-facing names layered on top.
- Think of controllers as projection layers: the seam stays wire-free; redaction/refusal mapping never leaks into the Definition.

## Anti-patterns
- **Depending on `ctx.agentLoop`**: it is the one `bundle`-role concrete loop plugin; extension packages depend on `dsh-agent` events and services, not this package.
- **Expecting a provider registry where there is none**: `ctx.workflowEngine` is a single engine — don't design "workflow providers".
- **Adding a protocol escape hatch**: `ctx.lsp` exposes exactly four normalized operations; a backend translates into the normalized request/result, no raw-protocol bypass.
- **Shipping a provider without Definition and Consumer**: one role alone is not a seam.
- **Assuming approval defaults open**: no answerer = `unavailable` (fail closed), never auto-allow.
- **Reading sandbox mode ad hoc**: `ctx.sandboxPolicy` is the one home for deployment default mode + workspace root, read by both bash and fs enforcing families precisely so they cannot confine to different roots.

## Code Examples
Consumer → seam → provider wiring (from the capability graph):
```text
ctx.llm:        [llm-deepseek, llm-pi-ai, llm-replay] → seam → [agent-loop, compaction-basic]
ctx.subprocess: [subprocess-local, subprocess-e2b] → seam → [bash-local, bash-sandbox, terminal-bash, lsp-stdio, subagent-acp/codex/claude-code]
ctx.fs:         [fs-local, fs-sandbox, fs-e2b] → seam → [tool-fs]  (+ fs-observation-policy via fs/* event gate)
ctx.shell:      [bash-local, bash-sandbox, pwsh-local] → seam → [tool-bash, tool-pwsh, hooks-claude-code, hooks-codex]
```

## Reference Tables
Seam-selection decision table:
| Want to… | Seam | Implementations | Rule / limit |
|---|---|---|---|
| Swap LLM provider | `ctx.llm` | llm-deepseek, llm-pi-ai, llm-replay | loop + compaction call the provider-neutral stream service |
| Extend official DeepSeek requests | `ctx.deepseekLlmApiExtensions` | session-log-deepseek, plugin-package-inventory-deepseek | plugins prepare independent top-level fields; official adapter merges and commits delivery state after HTTP acceptance |
| Replace bash executor | `ctx.shell` | bash-local, bash-sandbox, pwsh-local | tools + hook bridges untouched by the swap |
| Relocate process spawning | `ctx.subprocess` | subprocess-local, subprocess-e2b | service owns process coordinates, tree/session lifetime, stdio, kill escalation |
| Swap filesystem | `ctx.fs` | fs-local, fs-sandbox, fs-e2b | fs-sandbox fences by shared sandbox mode; observation via `fs/*` gate |
| Confine spawns | `ctx.sandbox` | sandbox-local | consumers hand over the exact argv; backends wrap per-call and report enforcement |
| Gate permissions | `ctx.approval` | listeners (ACP bridge) | `approval/request` waterfall; fails closed to `unavailable`; `ctx.permissionPresets` bundles sandbox-mode + approval-policy knobs |
| Persist sessions | `ctx.sessionPersistence` | session-persistence-jsonl | one artifact per Session |
| Search sessions | `ctx.sessionQuery` | session-query-sqlite | interface = exact reads/filters/traces; backend adds full-text, ranking, snippets |
| Store typed state | `ctx.storage` → `ctx.storageDomain` | storage-json, storage-sqlite | backends side by side under names; domain form waits for every configured backend |
| Read/write settings | `ctx.settings` | settings-file | plugins register namespace schemas, resolve layered values; provider stores the raw document |
| Resolve secrets | `ctx.credentials` | credentials-local | references in config; resolve per operation |
| Delegate work | `ctx.subagents` | spawn/fork-in-process, acp, codex, claude-code, dsh-sdk | service owns continuation orchestration; tool-subagent picks one-shot vs continuable; tool-ralph requires one fresh structured-output route |
| Run background work | `ctx.jobs` | jobs-local | producers register; tool-jobs is the model-facing controller |
| Search/fetch the web | `ctx.web` | web-search-exa/perplexity/deepseek, web-fetch-http | tool-web owns model-facing names |
| Run model-written code | `ctx.codeRuntime` | code-runtime-worker-thread, experimental-code-runtime-python | consumed by `ctx.tools` for PTC mode |
| Compact context | `ctx.compaction` | compaction-basic | consumes post-step pressure + request-error recovery; no model-facing compact tool |
| Spill oversized output | `ctx.spillStore` | spill-local | returns model-facing locator + retrieval hint; spill-policy decides when |
| Language servers | `ctx.lsp` | lsp-stdio | exactly four operations, no escape hatch |
| Run workflows | `ctx.workflowEngine` | workflow-worker-thread | one engine per context; `agent()` fans out through `ctx.subagents` |
| Name sessions | `ctx.sessionTitle` | first-prompt-llm / all-prompts-llm | sole optional async provider; deterministic fallback + latest-title fold owned by seam |
| Ask a human | `ctx.userQuestions` | UI front ends | tool-ask-user pauses on the provider-neutral `ask()` promise |
| Pick directories | `ctx.directoryPicker` | native, browse | dual-face backends fill ui-workspace directory-flow slots from browser halves |
| Emit telemetry | `ctx.sessionTelemetry` | session-telemetry-otel | nothing else consumes it — output leaves the process |
| Authorize / telemetry / attachments | `ctx.authorization` / `ctx.sessionTelemetry` / `ctx.attachments` | — / otel / attachment-local | authorization owns the conversation + one-attempt-per-key lifecycle, never the protocol; telemetry output leaves the process; host commits images before session events |

Core spine services (one owner, not swappable): `ctx.sessions`, `ctx.systemPrompt`, `ctx.tools`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.sessionProjections`(+`Cache`), `ctx.planMode`, `ctx.agentPresets`, `ctx.goals`, `ctx.messageFeedback`, `ctx.workspaceRegistry`, `ctx.webServer`, `ctx.clientModules`, `ctx.webhookRuntime`, `ctx.typert`(+`Gateway`), `ctx.invariants`, `ctx.inspector`, `ctx.dynamicCordisRunner`/`cordisInspect`, `ctx.e2b`, `ctx.shellEnv`, `ctx.agentTeams` (experimental), API controllers.

Exclusivity & collision rules: sole-provider seams take one registration (`sessionTitle`); registries take named side-by-side providers (`storage`, `llm`, `web`, `skills`); single-engine services take none (`workflowEngine`); approval answerers are event listeners, not registrations.

Maintenance: the capability graph is `hybrid generated` — services are discovered from Cordis declarations; Definition/implementation/consumer roles are classified in `scripts/gen-doc-graphs.ts` with a completeness guard.

## Key Takeaways
1. Design Definition + Provider + Consumer together; a provider alone is not a seam.
2. Swap at the seam, not at the tool: tools own stable model-facing names over swappable providers.
3. Check the Role column first — `core` services are spines to consume/project onto, `bundle` (`ctx.agentLoop`) is depended on by nobody.
4. Prefer event-gate companions (`fs/*`, `tools/post-execute`) for policy that should not fork providers.
5. Keep seams wire-free: redaction, refusal mapping, and capability gating live in the Remote controllers.
6. Execution-world seams move together; read confinement config only from `ctx.sandboxPolicy`.

## Connects To
- **Ch 6**: architecture and lifecycle these seams hang off; the three-role definition.
- **Ch 8**: pipelines that fire the `tools/*` events companions listen to.
- **Ch 11**: tool catalog — the Consumer role made concrete.
- **Ch 12**: persistence seams (`sessionPersistence`, `storage`, `spill`) in depth.
- **Ch 13–17**: subsystem deep-dives per seam domain (session, agent loop, tool execution, session data, LLM streaming).
- **Ch 3**: how plugin code actually registers providers and companions.
- **Ch 19**: cookbook recipes mapped onto these seams.
