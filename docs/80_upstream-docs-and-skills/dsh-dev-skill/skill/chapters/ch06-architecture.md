# Chapter 6: Architecture & Agent Lifecycle

## Core Idea
A running dsh is a Cordis plugin tree composed at boot from ordered layers — bundles, then profile/home/CLI patches — with no privileged core: the model adapter, tool registry, session log, and agent loop itself are all replaceable plugins. The agent lifecycle is a durable session-event log projected into model history (`deriveMessages()`), driven by live waterfall events.

## Frameworks Introduced
- **Profile**: a named composition stored in the Harness home; lists stacked bundles, holds out-of-tree plugins, keeps the user's `cordis.patch.yml`. Ships as templates: `web`, `headless`, `sdk`, `sdk-minimal`, `acp`.
  - When to use: selecting or composing an application shape without writing a new executable.
  - How: `dsh --profile <name>`; the profile's `package.json` `dsh.profile` field lists its bundles.
- **Bundle**: a distribution format for Cordis config rows plus the code they mount — whatever it inserts stays patchable by layers above. `dsh-base` is the shared first layer of `web`/`headless`/`sdk`/`acp` (model adapters, tools, persistence, sandbox and approval policy, settings, credentials, telemetry); `dsh-web-app`, `dsh-headless` (one-shot, no server), `dsh-sdk-app` (SDK JSON-RPC), `dsh-acp-app` (automation-only ACP) add app shells; `dsh-sdk-minimal` is the deliberate exception owning a complete explicit SDK tree without `dsh-base`.
  - When to use: shipping a stackable layer of plugins + config.
  - How: `dsh.bundle` in `package.json` points at the bundle's patch file.
- **Layer order**: empty entry list ← each bundle in listed order ← profile `cordis.patch.yml` ← home-level patch ← `--patch` overlay. A patch targets a row by id, replaces its whole config, or inserts new rows.
- **Turn/Step model**: a **step** = one model request plus the tools it calls; a **turn** = zero or more steps, opening before its first input is claimed and closing once nothing is owed.
- **Vendor rescope**: upstream Cordis-family packages vendored under `vendor/` and published as `@deepseek-ai/*`, because every harness package declares the framework as a peer — publishing under upstream names would squat them on the registry.

## Key Concepts
- **Live patch reload**: custom profiles and `web` reload patches live; `headless`/`sdk`/`sdk-minimal`/`acp` apply all layers once at startup — swapping a one-shot or stdio app's dependencies after it owns work would invalidate that lifecycle.
- **Launcher invariant**: every supported Node app starts at the `dsh` CLI with a named profile (`dsh web` = the alias for `--profile web`); `verify-application-entrypoints` rejects Node app paths that bypass `dsh`. The TS SDK resolves its same-version `dsh` dependency and selects `sdk`.
- **Python SDK runtime**: wheel packages the CLI as `deepseek-harness-sdk-runtime-<platform>-<arch>`; client launches `dsh --profile sdk` with an explicit home; minimal example uses `sdk-minimal`; plugins install via `dsh plugin`.
- **Event domains**: Session events = durable facts on `session/event` (survive reload); Agent events (`agent/*`) = live control/observation carrying an `Agent`; Capability events (`fs/*`, `tools/*`, `telemetry/*`) = policy and adapters at a seam, without importing the loop.
- **Waterfall vs serial**: `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls — listeners must call `next()` to delegate; `agent/turn-stopping` is serial with no `next()`.
- **Durable vs live streaming**: `agent/assistant-stream` frames are process-local; the loop commits the complete compact timed stream as `assistant/message` or log-only `assistant/attempt` before the committed end frame. Replay reads durable settlements only; process loss before settlement leaves no durable attempt stream.
- **Model-visible means logged**: anything reaching a model request must be reconstructable from the log (runtime invariant) — new model-visible input ⇒ new session event via `SessionEventMap`, rendered from the log.
- **Session format generations**: v0 `session.jsonl[.zstd]`; v1+ lowercase `session.vN.jsonl[.zstd]`; committed generation paths are never renamed, replaced, or deleted. `open` picks the highest canonical generation, refuses future versions, or composes the adjacent migration chain in memory, validates, and exclusively publishes the version-named successor beside the unchanged source; each migration package owns exactly one `vN -> vN+1` step.
- **Projection seam**: `ctx.sessionProjections` — registered units fold committed events; hosts read typed `stateOf()`, carriers batch cropped `snapshot()` views; a host reader requires the service at activation or fails explicitly. The loop registers shared `turnBoundary` state.

## Mental Models
- Use `--dump-config` as the map of what your machine boots: any row it prints can be replaced by a patch — later layers restate whole rows by id, never merge fields.
- Think of the turn as a claims loop: one inbox, wake-on-message; next-step input is claimed per step, and injected context waits in the inbox until another message wakes the driver.
- Treat the session log as the only source of model context: fork, resume, transcripts, telemetry, and persistence all derive from durable settlements; live UI incrementality comes from `agent/assistant-stream`.

## Anti-patterns
- **Patching a privileged core**: there is none — mount a plugin beside the others; registrations are effects that unwind when their plugin unloads.
- **Adding a second executable or inline application tree**: not an application launcher; the entrypoint verification gate rejects it.
- **New model-visible input without a session event**: breaks the log-reconstructability invariant.
- **Rebuilding a pre-step decision instead of spreading it**: `{ ...decision, messages }` — otherwise a downstream `startsRequestSeries` declaration is lost. A rejected or empty first claim still closes a durable turn that spent no step, so the log records the attempt.
- **Renaming vendored imports by hand**: `scripts/rescope-vendor.ts` owns the mapping; hand edits drift from it.

## Code Examples
```sh
dsh --profile web --dump-config   # print the booted plugin tree; every row is patchable
```
Turn-flow spine (D = durable session event, L = live):
```text
turn/start(D) → claim next-step input + one queued message →
agent/pre-step(L; reject | enter(messages, startsRequestSeries?)) →
step/start(D) → user/message(D) → agent/request(L) → llm/stream(L) →
agent/assistant-stream start/chunk*/end(L) →
assistant/message(D) | assistant/attempt(D) →
tool/call*(D) → tools/pre-execute → tools/execute → tools/post-execute → tool/result*(D) →
step/end(D) → agent/turn-stopping(L; serial, no next()) → turn/end(D)
```
Rescope tooling:
```sh
pnpm run rescope-vendor            # report what would change
pnpm run rescope-vendor --apply    # rewrite every reference
pnpm run rescope-vendor:check      # assert post-state; runs in the hygiene gate
pnpm run rescope-vendor --apply --reverse   # return to upstream names
```
Import rename: `import { Context } from 'cordis'` → `'@deepseek-ai/cordis'`; `declare module 'cordis'` → `declare module '@deepseek-ai/cordis'`. After upstream sync: re-apply rescope, then `pnpm install`, `pnpm run gen-third-party-notices`, `pnpm run verify-translation-pairing --write`.

## Reference Tables
Core packages:
| Package | Owns | `ctx` key |
|---|---|---|
| `core/session` | append-only `SessionEvent` log + store | `ctx.sessions` |
| `core/system-prompt` | prompt-section + tool-schema assembly | `ctx.systemPrompt` |
| `core/tools` | tool registry + guarded execution | `ctx.tools` |
| `core/agent` | `Agent` interface, registry, `agent/*` events | `ctx.agents` |
| `core/agent-loop` | default driver | `ctx.agentLoop` |
| `core/scope` | per-agent scoped registration | library, no key |
| `llm/llm` | stream vocabulary + adapter seam | `ctx.llm` |
| `webhook/webhook` | authenticated dispatch + Session creation | `ctx.webhookRuntime` |

Where new behavior goes (selected):
| Goal | Mechanism |
|---|---|
| Model provider | adapter on `ctx.llm` |
| Model-facing capability | register on `ctx.tools`; schema joins prompt assembly |
| Per-session capability set | agent preset; a service row there needs an `isolate` realm |
| Shell execution | `ctx.shell` backend; local one spawns through `ctx.subprocess` |
| Intercept request/tool/turn | `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Model-facing context | `agent.inject()`; lands in the next admitted request |
| Durable session state | extend `SessionEventMap`; render and replay from the log |
| Fork at turn boundary | `ctx.agents.create({ sessionId, seed, meta: { parentSession, seedLength } })` — only agent-loop-published sessions persist |
| New session backend | implement `SessionPersistence` (`create`/`open`/`stat`/`list`/`export`) |
| Scope to one agent | that agent's `agent.ctx` |

Vendored name mapping (subpath exports keep their path): `cordis` → `@deepseek-ai/cordis` (4.0.0-rc.7) · `cosmokit` (1.8.1) · `schemastery` (3.18.0) · `@cordisjs/plugin-loader` → `@deepseek-ai/cordis-plugin-loader` (1.0.0-rc.5) · plugin-include/group/timer/hmr/logger-console (1.0.4/1.0.0/1.1.2/1.0.15/1.0.0) → `@deepseek-ai/cordis-plugin-*`. Never touched: dependency ranges (key changes, range stays), the `cordis:` builtin prefix, the `cordis.yml` family, upstream runtime identifiers (`Symbol.for('schemastery')`, `vendor:`), prose outside `docs/`.

Doc graph atlas (relationships the catalogs don't show; exact signatures live in subsystem pages): module-graph and tool-catalog (`generated`); capability-seams, dsh-base composition, event-producer-consumer (`hybrid generated`); agent-lifecycle and tool-execution-pipeline (`curated`). Regenerate `pnpm run gen-doc-graphs`; verify `pnpm run verify-doc-graphs`.

## Key Takeaways
1. Extend by mounting plugins and patching rows by id — never by forking a core; later layers restate whole rows.
2. Inspect before composing: `--dump-config` prints every replaceable row your machine boots.
3. Route facts by domain: durable facts → session events; live control → `agent/*`; capability policy → capability events.
4. Waterfall listeners must call `next()`; pre-step decisions are authoritative — spread them, don't rebuild them.
5. Anything model-visible must be logged: extend `SessionEventMap` and render from the log; live streams are transient.
6. Don't rely on patch reload under one-shot profiles (`headless`/`sdk`/`sdk-minimal`/`acp` apply layers once).
7. After a vendor sync, rescope via script and run the regenerations it prints.

## Connects To
- **Ch 4**: Cordis primitives (Context, Service, events) the plugin tree is built from.
- **Ch 7**: the full seam catalog behind "where new behavior goes".
- **Ch 8**: tool-execution pipeline and turn-flow internals.
- **Ch 13/14**: session and agent-loop subsystems in depth.
- **Ch 2**: plugin-basics mechanics of bundles and patch rows.
- **Ch 20**: dev gates (`verify-application-entrypoints`, `rescope-vendor:check`).
