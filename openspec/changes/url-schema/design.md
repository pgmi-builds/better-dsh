## Context

Motivation: proposal.md - Why. This document covers only the "how".

Key constraints and starting state:

- The dsh tool pipeline (`dsh-agent-loop` README): `tools/pre-execute` (deny/ask) → `tools/execute` → `tools/post-execute` (result decisions) → `tools/result`. **`pre-execute` can only deny/ask, never return content; `post-execute` can only replace results; `execute` is not extensible.** So the only extension point that can both see URLs and produce content is a same-name tool registered nearer in scope.
- `read`/`write` live in `dsh-tool-fs`, `grep`/`glob` in `dsh-tool-fs-search` — all upstream, which DASHR must not patch (distro principle: rebranding §5.4). BetterEdit shadowed `read`/`edit`/`batch_edit`/`undo_last_edit`; it never replaced `write`/`grep`/`glob`.
- BetterEdit proved agent-scope same-name shadowing works: register on the agent's own scope layer, nearest layer wins, unwind on dispose.
- DASHR already had a presentation-layer masking mechanism (masked `send_message`/`report`).
- dsh services available: `ctx.skills` (skill registry), `ctx.sessions`/`ctx.subagents` (agent roster and outputs), `ctx.settings` (resolved settings), `ctx.agents` (live agent registry), `ctx.fs` (sandboxed filesystem).

## Goals / Non-Goals

**Goals:**
- `read`/`write`/`grep`/`glob` accept `scheme://` URLs; one handler per scheme (skill/agent/dsh/ctx/dvc, plus one shared http/https handler), one selector syntax applied uniformly by the resolver.
- DASHR's `read` provides URL routing + hashline in one tool (hashline vendored into DASHR, no external BetterEdit mount), with no competing second read.
- Keep the tool plane flat: no new model-visible tools; `skill` is masked on the REPL surface only.
- Non-URL behavior byte-identical to native: `write`/`grep`/`glob` delegate to the captured native definitions instead of reimplementing them.

**Non-Goals:**
- No `local://`, `artifact://`, `vault://`, `rule://`, `issue://`, `pr://` (see proposal).
- No remote/embedded skill provider (`skill://` covers the filesystem provider; remote skills are a known gap).
- No patching of upstream `dsh-tool-fs`/`dsh-tool-fs-search` source.
- No write channels: every `scheme://` write is rejected this wave.

## Decisions

### D1. The URL resolver is a standalone plugin-layer service, not part of the `dashr-repl` kernel

**Decision**: `dsh-url-schema` is its own plugin row (mounted by `dashr-repl` via `ctx.plugin()`), holding the scheme→handler registry and exposing `resolve(url) → selected text` plus `resolvePath(url) → disk path | undefined`. `dashr-repl` contributes only the `'skill'` mask entry.

**Rationale**: URL schema is infrastructure (blueprint §2.1) shared by all modes; `dashr-repl` is REPL capability. After v0.1.8d removed the kernel-variable mapping, `ctx://` needs no REPL service at all — the plugin's `inject` no longer lists `replRuntime`; the ctx handler reads the calling agent out of the resolver env.

**Alternative rejected**: merging into `dashr-repl` — it would saddle the REPL plugin with routing duties unrelated to REPL, and only one of the schemes ever touched the kernel.

### D2. One `read` with two branches: URL routing + vendored hashline; `write`/`grep`/`glob` delegate

**Decision**: DASHR's `read` tool is one implementation with two branches — `scheme://` → resolver; ordinary file → the vendored hashline read pipeline (`readAndServe` over the `ctxFsIO` bridge, preserving the `HASH│content` anchors and snapshot store the vendored `edit` tool depends on). The hashline code was vendored by direct source copy into `src/vendored/hashline/` (published compiled JS + `.d.ts` from dsh-better-edit's `lib/`), attributed in LICENSE/README as a 4-layer chain: pi-hashline-edit / pi-hashline-edit-pro (RimuruW + Yugimob) → pi-hashline-edit-lsz (Prime Intellect) → dsh-better-edit (Rianico) → DASHR. The external BetterEdit mount in `cordis.patch.yml` was removed; DASHR owns the whole hashline toolchain (the OMP model).

**v0.1.8d correction — write delegation restored (D2-restore)**: v0.1.8c briefly made the URL-aware `write` reject-or-handle everything itself, which dropped the native write-intent policy gate from ordinary writes. v0.1.8d restored the correct split: `write` is a delegation shell — non-URL paths forward verbatim to the captured native `write` definition (policy gate, sandbox resolution, observation events intact), URL paths go to the structured scheme dispatch (all rejected this wave). See D7.

**Why `read` does NOT delegate**: the read file branch is not "the native read" — it is the vendored hashline pipeline, a DASHR-introduced capability (anchors + snapshot store consumed by the vendored `edit`/`batch_edit`/`undo_last_edit`). There is no native definition to capture that would produce hashline output; capturing would silently downgrade file reads to un-anchored native reads and break the edit chain. So `read` captures nothing and owns both branches.

**REPL side**: the REPL's `read` is `tool.read` = bridge → this host read. No independent prelude read implementation. Guards don't escape: the hashline branch goes through `ctx.fs` and the fs policy gate (`fs/write-intent` + `fs/observed`).

### D3. Scheme handler contract (landed v0.1.8d)

| scheme | handler output | deps | notes |
|---|---|---|---|
| `skill://<name>` `/<path>` | skill body / internal resource text (full text) | `ctx.skills`, `ctx.fs` | discovery is workspace-cwd-sensitive (see D8); path-backed (`resolvePath`) |
| `agent://`, `agent://<id>`, `<id>/transcript`, `<id>/<child>` | roster table / output artifact / transcript / nested output | `ctx.sessions`, `ctx.subagents`, `ctx.agents` | roster has five columns: id, status, kind, parent, last activity; `status` from the live agent registry (`-` when not live), `kind` = `header.origin` (default `main`), `parent` = `header.parentSession` (`-` at top level), last activity = last session event time (ISO 8601, `-` when empty); output = last non-empty assistant message (`SubagentResult.output` semantics) |
| `dsh://docs[/<doc>]`, `dsh://config[/<ns>]` | docs listing/content; resolved settings (namespaced, secrets stripped) | docs dir, `ctx.settings` | config redacts `role('secret')` fields AND a defensive key-name denylist; docs dir resolved by nearest-first walk-up (`docs-dir.ts`) so source/lib/installed layouts all work |
| `ctx://` | curated read-only snapshot: `session` `{id,status,origin,delegationDepth}`, `model` `{provider,model,maxTokens}`, `cwd` (bare string); bare `ctx://` lists the keys | resolver env (`env.agent`) | strictly read-only; `CTX_NO_AGENT` / `CTX_UNKNOWN_KEY`; see D4 |
| `dvc://`, `dvc://<device>` | `no devices mounted` / `unknown device: <name>` placeholder text; write → `DVC_NO_DEVICE` | none | renamed from `xd://` (global rename; no `xd` remains anywhere) |
| `http://`, `https://` | disclaimer line + blank line + fetched text body | none (stateless; one handler instance serves both schemes) | GET-only, 20 s, 2 MiB, text whitelist; see D9 |

**Unified selector syntax**: `:N-M`, `:raw`, `:path/…`, `?q=` are parsed once by `parseUrl` and applied uniformly by the resolver after the handler returns full text (see D10 for the http caveat). Handlers never truncate: no default line limit; only explicit selectors page.

### D4. `ctx://` is a curated read-only environment snapshot (v0.1.8d reversal)

**Decision**: `ctx://` exposes exactly three snapshot keys — `session` (JSON `{id, status, origin, delegationDepth}`, undefined fields omitted), `model` (JSON `{provider, model, maxTokens}`), `cwd` (the session header cwd as a bare string, `''` when absent) — plus a bare `ctx://` listing of the key names. It reads the calling agent from the resolver env (`env.agent`, supplied by the tool layer per call). Every write is rejected (`URL_READ_ONLY`). Errors: `CTX_NO_AGENT` (no live agent in the env) and `CTX_UNKNOWN_KEY` (listing the known keys).

**Why the v0.1.8c kernel-variable mapping was wrong**: that design wired `ctx://<var>` to the persistent kernel's user namespace over a new query/set channel (JSON-safe → JSON, else `repr`). Two flaws surfaced. (1) Semantic mismatch: the kernel namespace is the model's own REPL scratchpad — program state, not environment. Calling it "ctx" promised the calling context (who am I, what model, what cwd) but delivered Python variables, most of which the model had itself just created. (2) Cost/complexity: it required a kernel protocol extension, a `replRuntime` dependency in the plugin's `inject`, and a serialization boundary (dill/`repr`) for a benefit `eval` already provides — the model can read its own variables natively. The curated snapshot is the actual "context as resource": small, static, agent-derived, and readable with zero kernel coupling. The `queryVar`/`setVar` channel itself stays in the runtime layer (`runtime-surface.ts`, optional seam methods) as retained infrastructure — just no longer wired to `ctx://`.

**Roadmap**: later phases may add snapshot keys (e.g. `preset`); none implemented yet.

### D5. Mask the `skill` tool — presentation-only, REPL surface only (ADR-0002)

**Decision**: `'skill'` joins `MASKED_TOOL_NAMES` (`send_message`, `report`, `skill`). Per ADR-0002 masking is presentation-only and scoped to two surfaces: the REPL `tool.*` binding names and the dashr tool-catalog section. The host-layer native `skill` tool stays registered, executable, and dispatchable; the `<available_skills>` discovery catalog is untouched. Category (e) in masking terms: alive, just not on the REPL surface.

**Rationale**: `skill({name})`'s body-loading role is replaced by `read skill://<name>` on the REPL surface the model actually programs against, trimming the binding surface by one. Keeping the host tool intact preserves upstream behavior for any host-plane consumer and makes the mask trivially reversible.

### D6. No local/artifact/spill scheme

**Decision**: no scheme equivalent for local filesystem addressing (`local://`, `artifact://`, spill URIs).

**Rationale (user-decided)**: passing file paths directly is zero-friction for the model; another scheme has marginal benefit. The dsh-spill locator is already a readable path (`read <path>` works). **Only when cloud storage enters (cloud skill loading, S3) does a scheme earn its place** — the hook stays open, nothing is hard-coded.

### D7. Delegation architecture: capture-before-register (v0.1.8d)

**Decision**: `write`/`grep`/`glob` are delegation shells. At `agent/session-start`, BEFORE the wrappers register on the agent's own scope layer, `captureNativeTools(ctx, agent)` snapshots the native definitions via `ctx.tools.get(name, agent)` (names `write`, `grep`, `glob`), cached in a `WeakMap` per agent. Non-URL inputs call `native.execute(args, exec)` verbatim — native write-intent policy gate, sandbox resolution, ripgrep behavior, result shapes all preserved (each wrapper's declared output schema mirrors the native shape, so delegated returns validate unchanged). URL inputs take the URL branch. A missing definition is not an error at capture time; the corresponding wrapper reports `NATIVE_WRITE_UNAVAILABLE` / `NATIVE_GREP_UNAVAILABLE` / `NATIVE_GLOB_UNAVAILABLE` only if actually invoked without a delegate.

**Why capture must happen BEFORE registration**: `ctx.tools.get(name, agent)` resolves through the agent's scope layers. Once the wrapper is registered on the agent's own layer, a scoped lookup of `write` resolves to the wrapper itself — delegating would recurse infinitely. Capture-before-register is the load-bearing invariant (asserted in `wiring.spec.ts`).

**Why per-agent WeakMap**: each agent's inherited surface may differ (presets, other plugins); the snapshot must reflect what THAT agent would have called. The WeakMap keeps the snapshot alive with the agent and makes repeated session starts cheap. Tools register on the agent's own layer via `agent.ctx.effect` and unwind automatically on dispose — the dsh-better-edit pattern.

**Why delegate at all instead of reimplementing**: the native `write` embeds policy (write-intent gate, observation events) and the native `grep`/`glob` embeds ripgrep semantics (walk order, caps, ignore rules). Reimplementing would fork behavior silently. v0.1.8c's self-implemented write proved the point by dropping the policy gate; D2-restore fixed it.

### D8. skill:// discovery is workspace-cwd-sensitive

**Decision**: every `ctx.skills.get(name, …)` lookup from the skill handler passes `{ cwd }` — the explicit env cwd if the tool layer resolved one, else the calling agent's `session.header.cwd`. This is the same source `dsh-tool-skill` uses when it renders `<available_skills>`, so `skill://` can address exactly the skills the catalog advertises. Without a cwd the lookup degrades to the registry's empty default workspace and every skill reports unknown (the pre-fix failure mode).

### D9. http(s):// handler: curl-style plain-text GET with a disclaimer

**Decision**: one stateless handler instance registered under both `http` and `https`. Contract:

- **GET only**, default redirect following, one global `fetch` with a 20 s `AbortController` deadline (`URL_HTTP_TIMEOUT`).
- **2 MiB body cap**, enforced twice: `Content-Length` precheck, then streaming byte accounting while decoding (`URL_HTTP_TOO_LARGE`, reporting the actual byte count). A degenerate bodyless runtime falls back to buffer-then-recheck.
- **Text-only media whitelist**: `text/*` plus `application/{json,xml,yaml,toml,xhtml+xml,javascript,plain}` (charset params ignored); a missing content-type fails the check; anything else → `URL_HTTP_UNSUPPORTED_MEDIA` — binary decoding is deliberately NOT guessed.
- **Structured failures**: non-2xx → `URL_HTTP_STATUS` (status + statusText); network/DNS → `URL_HTTP_FETCH_FAILED` (with the nested cause message); non-http(s) protocol or unparseable URL → `URL_INVALID`. Precedence: status → size precheck → media → streamed body.
- **No scheme-specific selector; whole-URL fetch**: the handler consumes the exact raw URL from the env (`env.rawUrl` — the scheme-stripped `path` cannot recover scheme/port/query) and strict-parses it with `new URL(raw)`, so ports and queries survive at the handler level.
- **Disclaimer first line**: every result starts with `[url-fetch] plain-text result of a direct HTTP GET (curl-equivalent). No JS execution or interaction — use browser tools, if any, for that.` followed by a blank line and the body. Rationale: a plain fetch is not a sandbox read and not a browser — the consumer must see the semantics on line one, before any body content that might otherwise be mistaken for an interactive page dump.

**Known limitation (documented, not fixed)**: the shared `parseUrl` runs before the handler on the tool-layer path. Its selector markers collide with URL syntax: `?…` in a URL is consumed as a query selector (the fetch itself still uses the full raw URL via `env.rawUrl`, so only the result filtering doubles up), and a `:port` currently fails `URL_BAD_SELECTOR` end-to-end. Port-carrying URLs work only at the handler level (as tested directly); through `read` they are rejected by the shared parser. Fixing this needs an http-aware parse exemption — deferred, not silently claimed.

### D10. grep/glob over URLs: path-backed translation vs content-backed materialization

**Decision**: handlers MAY implement `resolvePath(env, path) → disk path` (path-backed schemes). Today only `skill://` does (skill root or joined subpath, same escape guard, `undefined` for unknown/non-directory/escaping so callers fall back to text resolution).

- **grep, URL in `path`**: path-backed → translate the URL to its disk path, rewrite only `args.path`, delegate to native grep (real ripgrep over real files). Content-backed (agent, ctx, `dsh://config`, http, …) → resolve full text, write it into a fresh temp dir as `content.txt` (`withTempMaterialization`), point the native grep at it, and remove the dir in a `finally` whatever the native call returns or throws.
- **glob, URL in `pattern`**: path-backed → native glob with `pattern: '**/*'` rooted at the resource's disk dir. Content-backed → the resolved text IS the listing: non-empty lines returned directly as `paths` (a roster table, a key list), no native call involved.
- **glob, URL in `path`**: path-backed → translate the root; content-backed → materialize into a temp dir, glob it, clean up in `finally`.

**Rationale**: reuse native ripgrep semantics wherever a real disk location exists; never reimplement search over text. Temp materialization keeps the native tool as the only search engine while conceding that content-backed resources have no disk address. Cleanup in `finally` guarantees no temp litter on error paths.

### D11. Scheme-space hygiene: `history://` gone, `xd://` renamed `dvc://`

**Decision**: no special cases in the scheme registry. The v0.1.8c `history://` alias ("merged into agent://" message) was deleted — `history://` now produces the generic `URL_UNREGISTERED_SCHEME` error like any other unregistered scheme. The device scheme was globally renamed `xd://` → `dvc://` (module, scheme key, error codes `DVC_NO_DEVICE`; read-side unknown device is placeholder text, not an error). One registry, one error vocabulary.

## Risks / Trade-offs

- [Vendor maintenance] BetterEdit upstream updates need manual sync of the hashline logic → mitigation: source commit + attribution recorded; periodically diff against upstream CHANGELOG.
- [`dsh://config` secret leak] resolved settings may carry API keys → mitigation: `describe({redactSecrets: true})` plus a defensive key-name denylist (`isSecretKey`) as a second net.
- [Mask `skill` loses remote skills on the REPL surface] remote/embedded providers are not reachable via `skill://` → mitigation: known gap; revisit if `ctx.skills` grows a remote provider.
- [Delegation capture drift] if a host deploys tools late (after `agent/session-start`), the captured set may miss them → mitigation: capture errors are logged, wrappers report `NATIVE_*_UNAVAILABLE` loudly instead of silently reimplementing.
- [http fetch surface] a GET-only fetcher still reaches the network → mitigation: hard budget (20 s / 2 MiB), text-only whitelist, disclaimer line, no selectors of its own; no JS execution by construction.
- [Selector/URL syntax collision] `:port` fails the shared selector parse on the tool path (see D9) → mitigation: documented as a known limitation; fixing requires an http-aware parse exemption.

## Migration Plan

- No destructive migration: one new plugin row + one mask entry + the delegation wrappers. Non-URL behavior is delegated, not forked.
- Rollback: unmount `dsh-url-schema` and drop the `'skill'` mask → back to the pure native tool plane.
- Deploy: DASHR `read` (URL routing + vendored hashline), delegation-shell `write`/`grep`/`glob`, 7 scheme names (skill/agent/dsh/ctx/dvc/http/https), skill mask on the REPL surface.

## Open Questions

- **spike #1 (vendor mechanism)** — RESOLVED: vendor = direct copy of the published compiled JS + `.d.ts` from dsh-better-edit's `lib/` into `src/vendored/hashline/` (no TS source exists in the package); runtime deps `diff`, `file-type`, `xxhash-wasm` carried by DASHR; external mount removed.
- **http selector exemption** — OPEN (see D9 known limitation): whether `parseUrl` should skip selector extraction for `http`/`https` so port-carrying URLs resolve end-to-end. Answer changes only parser behavior, not the handler contract.
