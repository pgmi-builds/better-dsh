## Why

DASHR started with only a "tool plane" (flat `tool.*` + `eval`) and no resource layer: to read a skill body, a subagent output, harness docs, or runtime context, the model had to fire one-shot actions — a `skill({name})` tool call, or reaching into the `eval` kernel to `print()` variables. Upstream OMP proved the alternative: put resources into a URL space and address them with `read`/`write` uniformly, keeping the tool plane flat and the model's learning cost zero (it already knows `read`). This is the infrastructure layer that takes DASHR "from plugin to complete App" (distro-blueprint §2.1, "URL Schema infrastructure layer").

## What Changes

- A unified URL resolver: `read`/`write`/`grep`/`glob` accept `scheme://` URLs, route by scheme to a handler, and share one selector syntax (`:50-100`, `:raw`, `:path/…`, `?q=`) applied uniformly by the resolver layer.
- Registered schemes (one capability each, except http/https which share one handler):
  - `skill://` — skill body + internal skill resources (workspace-cwd-sensitive discovery).
  - `agent://` — merged agent roster, output artifact, `/transcript` (absorbs upstream `history://`).
  - `dsh://` — harness docs + resolved effective config/env (static self-description).
  - `ctx://` — a curated read-only snapshot of the calling agent's environment (`session`, `model`, `cwd`).
  - `dvc://` — device I/O placeholder (renamed from the earlier `xd://`; no device mounted, structured `DVC_NO_DEVICE` write error).
  - `http://` / `https://` — curl-style plain-text HTTP GET with a strict budget (20 s, 2 MiB, text-only media whitelist) and a first-line disclaimer.
- Delegation architecture for the shadowing tools: `write`/`grep`/`glob` capture the NATIVE tool definitions before the wrappers register (`ctx.tools.get(name, agent)`, cached per agent) and forward non-URL inputs verbatim (`native.execute(args, exec)`), preserving the native write-intent policy gate and ripgrep. `read` keeps its own file branch: the vendored hashline pipeline (DASHR-introduced capability, not delegated).
- **BREAKING**: the upstream `skill` tool is masked — presentation-only (ADR-0002), on the REPL `tool.*` binding surface and the dashr tool-catalog section. The host-layer native `skill` tool stays registered/executable, and the `<available_skills>` discovery catalog is retained; skill content addressing moves to `skill://`.
- **BREAKING**: `history://` semantics live under `agent://` only. There is no history special case: `history://` hits the generic `URL_UNREGISTERED_SCHEME` error like any other unregistered scheme.
- Writes: non-URL paths delegate to the native `write` (write-intent policy gate restored — the v0.1.8c all-rejected behavior was rolled back); every `scheme://` write is rejected with a scheme-specific structured error.
- Not done (recorded as boundaries): `local://` (dropped — plain file paths are zero-friction, marginal benefit), `artifact://` (hook kept — the spill locator is already a readable path; revisit when cloud storage lands), `vault://` (Work mode), `rule://` / `issue://` / `pr://`.

## Capabilities

### New Capabilities
- `url-schema`: unified URL resolver infrastructure (scheme routing + delegation-shell read/write/grep/glob + selector syntax).
- `skill`: `skill://` resource addressing.
- `agent`: `agent://` roster / output / transcript addressing.
- `dsh`: `dsh://` docs + config/env self-description.
- `ctx`: `ctx://` curated read-only environment snapshot.
- `dvc`: `dvc://` device I/O placeholder.
- `http-read`: `http(s)://` plain-text GET read.

### Modified Capabilities

(None — this repository's first openspec change; no prior specs exist.)

## Impact

- New plugin layer `dsh-url-schema` (mounted by `dashr-repl` via `ctx.plugin()`), owning the resolver, the four URL-aware tools, the vendored hashline, all scheme handlers, and the skill mask entry.
- BetterEdit hashline vendored into the DASHR package (`src/vendored/hashline/`, attributed to Rianico/dsh-better-edit + pi-hashline-edit-lsz); DASHR's `read` is one tool with two branches — URL routing and hashline file reads. `write`/`grep`/`glob` are delegation shells over the captured native definitions (no hashline conflict).
- Mask of the upstream `skill` tool is presentation-only and scoped to the REPL surface (ADR-0002).
- Dependencies: `ctx.skills` + `ctx.fs` (skill), `ctx.sessions`/`ctx.subagents`/`ctx.agents` (agent roster/output), `ctx.settings` (dsh config), and no kernel channel for `ctx://` — the ctx handler reads the calling agent out of the resolver env (the v0.1.8c kernel-variable mapping was removed; `queryVar`/`setVar` remain runtime-layer infrastructure, unwired).
