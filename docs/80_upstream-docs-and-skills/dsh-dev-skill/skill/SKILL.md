---
name: dsh-dev-skill
description: "Reference knowledge base distilled from the official DeepSeek Harness (dsh) developer documentation. Use when developing, extending, or debugging dsh plugins, Cordis services/events, LLM adapters, tools, sandbox/approval policy, web UI slots, session/persistence internals, or the Typert API gateway."
---

# DeepSeek Harness (dsh) — Official Docs, Distilled

**Source**: official `deepseek-ai/deepseek-harness` master `docs/` (123 English files, fetched 2026-09-06 into `../src/docs/`) | **Chapters**: 22 | **Generated**: 2026-09-06 | **Depth**: reference (decision-ready lookup)

## How to Use This Skill

- **Without arguments** — load the core mental models below before touching dsh code
- **With a topic** — ask about `compaction`, `slots`, `sandbox`, `fibers`; I read the matching chapter file first
- **With a chapter** — ask for `ch15` to load that chapter only
- **Browse** — ask "what chapters do you have?" for the full index

Chapters are on-demand: only the one you load counts against context.

---

## Core Mental Models

**1. Everything is a Cordis plugin; layers compose the app.**
A running dsh is a plugin tree composed at boot from ordered layers — bundles (listed order) → profile patch → home patch → `--patch` argv — with no privileged core. A patch row targets a plugin id and **replaces its whole config value** (no deep merge): restate every key or lose fields. Ordering between plugins comes from `inject` dependencies, never YAML position. Prefer mounting a plugin or patching a row over forking core, because registrations are reversible effects.

**2. The session log is the single source of truth; history is derived.**
Every model-visible fact is an append-only `SessionEvent` (`{type, seq, time, data}`). Message history is folded from it (`deriveMessages()`), never stored. Only three surface types produce transcript messages: `user/message`, `assistant/message`, `tool/result` — everything else is audit/state. "Model-visible means logged" is a runtime invariant. State-carrying events carry **whole values, not deltas**. When you need derived per-session state, register a `ProjectionDefinition` — the registry drives, backfolds, and checkpoints it for you.

**3. Capabilities are three-role seams.**
A swappable capability = abstract Service Definition (`ctx.fs`, `ctx.llm`, `ctx.subagents`) + Provider + thin provider-neutral Consumer tools. Filesystem/subprocess/sandbox form one "execution world" — swap them together. Build a seam only when ≥2 implementations are plausible. Remote controllers project seams onto the wire and own redaction/refusal. Never depend on `ctx.agentLoop`; extension packages use `dsh-agent` events/services.

**4. Tool calls cross a fixed policy pipeline.**
`tools/pre-execute` (allow/deny/ask decision) → approval (fail-closed: absent asker = deny) → monotonic guards (deny-or-abstain, can never force-allow) → execute → `tools/post-execute` (transform) → `finalizeContent` → snapshotted result (throws become `isError`). Sandbox mode and approval policy are two independent, per-call-resolved knobs. No usable sandbox backend ⇒ `SANDBOX_UNAVAILABLE`, never silent passthrough; escalation is one-shot, strictly wider.

**5. Packages share instances via peer dependencies.**
The module graph is a peer-dependency graph of shared service instances: an edge means "consume the host's instance" — bundling your own copy breaks identity. Use `ctx.get(name)` for undeclared optional services; `ctx.<name>` throws through foreign fibers. Service visibility is ancestor/isolate only; `provide` throws on duplicates within a scope — sibling shadowing does not exist.

**6. Events have contracts; waterfalls have discipline.**
Dispatch mode (emit / serial / parallel / bail / waterfall) is part of each event's public contract — call the matching method. In waterfalls, observers must call `next()`; omitting it is a deliberate veto. Policy that must not be reordered belongs in monotonic guards, not pre-execute listeners (which other listeners can reshape).

**7. LLM adapters are thin and provider-neutral at the wire.**
`LlmAdapter.stream()` emits the closed `StreamChunk` union; the shared `BlockAssembler` reassembles blocks (never per-adapter). One adapter call = one attempt; retries live at agent level (`ResolvedRetryPolicy`). Usage arrives at provider end-of-stream. Credentials are `CredentialRef`s resolved per operation (rotation without restart). Can't honor a `GenerateOptions` field ⇒ throw `LlmError('UNSUPPORTED_OPTION')`.

**8. The web surface is a dumb carrier plus typed slots.**
`ctx.webServer` owns no TLS/auth/Origin policy — trust is supplied at composition (or a second isolated server for webhooks). The browser app boots from `WebBootGraph` (`window.__DSH_BOOT__`). The only sanctioned UI extension is `ctx.slots.inject` with a fresh list id; single/keyed cells are replacement points. Settings writes are CAS (`SettingsPathOp` + expectedRevision, `redactSecrets` on wire) — never `replace()` from a redacted view. Remote (Typert) methods are strictly unary; streamed responses use Connection Fetch routes; client calls return non-throwing `RemoteResult<T>`.

---

## Chapter Index

| # | Title | Key contents |
|---|---|---|
| [ch01](chapters/ch01-user-guide.md) | User Guide | providers, credentials, compat blocks, MCP memory, proxy, Python SDK, schedules |
| [ch02](chapters/ch02-plugin-basics.md) | Plugin Dev Basics | plugin anatomy, Config schema, defineTool, bundles/profiles, layer order, publishing |
| [ch03](chapters/ch03-plugin-framework-practice.md) | Framework & Practice | fibers, events, service isolation, capability split, LlmAdapter, dynamic Cordis |
| [ch04](chapters/ch04-cordis-fundamentals.md) | Cordis Fundamentals | plugin shapes, inject, PENDING, dispatch modes, waterfall veto, HMR, `!!js` |
| [ch05](chapters/ch05-cordis-api.md) | Cordis API | Context scoping (extend/isolate/intercept), fiber API, service store symbols |
| [ch06](chapters/ch06-architecture.md) | Architecture & Lifecycle | boot layers, profiles, turn/step model, session generations, rescope |
| [ch07](chapters/ch07-capability-seams.md) | Capability Seams | seam taxonomy, execution world, event-gate companions, selection table |
| [ch08](chapters/ch08-internals-pipelines.md) | Internals & Pipelines | module graph, event producer–consumer matrix, tool pipeline, defensive patterns |
| [ch09](chapters/ch09-api-gateway.md) | API Gateway | Typert `@Remote`, `/api` routes, trust fence, DeepSeek wire extensions |
| [ch10](chapters/ch10-config-catalog.md) | Config Catalog | `config:` blocks, `Requires:` lines, package classes, runtime-only seams |
| [ch11](chapters/ch11-tool-catalog.md) | Tool Catalog | boot-and-read registry, capability seams, `run_code` transport, aliases |
| [ch12](chapters/ch12-persistence-catalog.md) | Persistence Catalog | `SessionEventMap`, surface vs log-only, compaction shadow price, migrations |
| [ch13](chapters/ch13-subsystems-core-session.md) | Subsystems: Core & Session | core spine, event log, inbox, system-prompt assembly, invariants |
| [ch14](chapters/ch14-subsystems-agent-loop.md) | Subsystems: Agent Loop | subagents, teams, workflows, goals, plan mode, compaction, spill |
| [ch15](chapters/ch15-subsystems-tool-execution.md) | Subsystems: Tool Execution | ToolRuntime, shell/fs/subprocess, sandbox backends, approval, presets |
| [ch16](chapters/ch16-subsystems-session-data.md) | Subsystems: Session Data | projections, session-query, storage domains, attachments, jobs |
| [ch17](chapters/ch17-subsystems-llm-streaming.md) | Subsystems: LLM Streaming | StreamChunk, BlockAssembler, token meter, typert, credentials, client-modules |
| [ch18](chapters/ch18-subsystems-web-ui.md) | Subsystems: Web & UI | webServer, slots, settings, commands, skills, terminals, webhooks, schedule |
| [ch19](chapters/ch19-cookbook.md) | Extension Cookbook | recipes: packages, vendoring, tools, settings cards, adapters, PR stacks |
| [ch20](chapters/ch20-development-testing.md) | Dev & Testing | build faces, test tiers, coverage gates, doc budgets, type-equiv fences |
| [ch21](chapters/ch21-postmortems.md) | Postmortems | export-default trap, `!!js` scope, GUI feedback loop, Landlock classification |
| [ch22](chapters/ch22-i18n.md) | i18n & Translation | zh pairing contract, terminology, protected tokens, translation pipeline |

## Topic Index

- **adapters (LLM)** → ch03, ch17, ch19
- **agent lifecycle / turn model** → ch06, ch13
- **agent-team** → ch14
- **approval / escalation** → ch07, ch15
- **architecture / boot** → ch06, ch08
- **attachments** → ch16
- **background jobs** → ch16, ch19
- **build / DSH_BUILD_FACE** → ch09, ch20
- **bundles / profiles / layers** → ch02, ch06
- **client modules / WebBootGraph** → ch17, ch18
- **compaction** → ch12, ch14
- **config (cordis.yml, catalog)** → ch02, ch10
- **cookbook recipes** → ch19
- **credentials** → ch01, ch17
- **Cordis (framework, API)** → ch04, ch05
- **defensive patterns** → ch08
- **defineTool / tool authoring** → ch02, ch11, ch19
- **dispatch modes / waterfalls** → ch03, ch04, ch08
- **dynamic Cordis** → ch03, ch13
- **events (Cordis vs session)** → ch03, ch12
- **fibers / registry** → ch04, ch05
- **filesystem / observation policy** → ch11, ch15
- **goals** → ch14
- **HMR** → ch03, ch04
- **hooks (lefthook)** → ch20
- **inbox / steering** → ch13
- **invariants** → ch13
- **i18n** → ch22
- **isolate / intercept** → ch05
- **jobs** → ch16
- **LlmError / retries** → ch03, ch17
- **MCP** → ch01
- **module graph** → ch08
- **persistence / session log** → ch12, ch16
- **plan mode** → ch14
- **postmortems** → ch21
- **projections** → ch16
- **providers (user config)** → ch01
- **Python SDK** → ch01
- **Remote / Typert gateway** → ch09, ch19
- **sandbox (modes, backends)** → ch10, ch15
- **schedules** → ch01, ch18
- **session-query / title / telemetry** → ch16
- **settings cards / CAS** → ch18, ch19
- **skills subsystem** → ch18
- **slots / UI injection** → ch18
- **spill** → ch14
- **StreamChunk / streaming** → ch17
- **subagents** → ch14
- **system prompt** → ch13
- **testing tiers / coverage** → ch20
- **tools registry / pipeline** → ch08, ch11, ch15
- **typert (typing)** → ch17
- **vendoring / packages** → ch19
- **web server / client / trust** → ch18
- **webhooks** → ch18
- **workflows** → ch14
- **workspace** → ch16

## Supporting Files

- [glossary.md](glossary.md) — ~55 key terms with exact definitions
- [patterns.md](patterns.md) — 17 techniques: when / how / trade-offs
- [cheatsheet.md](cheatsheet.md) — seam-selection table, hard rules, defaults, smells

---

## Scope & Limits

Distilled exclusively from the **official** `deepseek-ai/deepseek-harness` master docs (English) fetched 2026-09-06; the raw source is preserved at `../src/docs/` (241 files incl. zh pairs) with URL mapping in `../src/site-pages-map.txt` for verbatim lookups. No local research, forks, or third-party analysis was folded in. Generated catalogs (config/tool/module-graph) are summarized, not reproduced — consult the source files for exhaustive per-entry detail. Docs describe the harness at the fetched master revision; verify against your deployed version when behavior matters.
