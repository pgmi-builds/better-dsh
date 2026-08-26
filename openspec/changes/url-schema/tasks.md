## 1. Spike: vendor mechanism (resolved)

- [x] 1.1 Fix the vendor scope (direct copy into `src/vendored/hashline/` of dsh-better-edit's published `lib/` — compiled JS + `.d.ts`, no TS source in the package; runtime deps `diff`, `file-type`, `xxhash-wasm` carried by DASHR) + remove the external BetterEdit plugin mount (the `cordis.patch.yml` line). Conclusion recorded in design.md D2. Verified: vendor compiles, attribution files carry the 4-layer copyright chain.

## 2. URL resolver infrastructure

- [x] 2.1 Create the `dsh-url-schema` plugin row (mounted by `dashr-repl` via `ctx.plugin()`), inject `['tools','fs','skills','subagents','sessions','settings','agents']`. Verified: plugin mounts, wiring spec asserts the shape (incl. `agents` present, `replRuntime` absent).
- [x] 2.2 Implement the scheme→handler registry + unified selector parsing (`selector.ts`, `resolver.ts`). Verified: unit tests cover `:N-M` / `:raw` / `:path/` / `?q=` and the structured `URL_NO_SCHEME` / `URL_UNREGISTERED_SCHEME` / `URL_BAD_SELECTOR` errors.
- [x] 2.3 Vendor the BetterEdit hashline into `src/vendored/hashline/` with LICENSE/README attribution (Rianico / dsh-better-edit + pi-hashline-edit-lsz). Verified: vendored code compiles; attribution carries the layered copyrights.
- [x] 2.4 Implement the DASHR `read` tool (one implementation, two branches: `scheme://` → resolver; ordinary file → vendored hashline via `ctxFsIO`). Verified: read `skill://…` returns resolved content, plain files return hashline anchors, the fs policy gate covers both branches. (v0.1.8d: URL branch additionally hands the resolver env `{agent, cwd, rawUrl}`.)
- [x] 2.5 Implement URL routing for write/grep/glob. Landed shape (v0.1.8d, superseding the v0.1.8c self-implementation): delegation shells over the captured native definitions — non-URL inputs call `native.execute(args, exec)` verbatim; URL inputs take the scheme branch. Verified: `tools-delegation.spec.ts` (native passthrough, scheme dispatch, temp materialization, capture-before-register ordering); see also 9.1–9.3.

## 3. skill://

- [x] 3.1 Implement the `skill://` handler (`ctx.skills` → body/resources, full text, no default truncation; sandboxed resource reads; escape guard). Verified: body + resource reads, `URL_SKILL_NOT_FOUND` / `URL_SKILL_NO_RESOURCE_BASE` / `URL_SKILL_RESOURCE_ESCAPE` structured errors.
- [x] 3.2 Mask the upstream `skill` tool. Verified per the corrected v0.1.8d acceptance wording: `'skill'` is in `MASKED_TOOL_NAMES`, so it disappears from the REPL `tool.*` binding surface and the dashr tool-catalog section ONLY — the host-layer native `skill` tool stays registered/executable, `<available_skills>` is retained (presentation-only, ADR-0002), and `skill://` addressing works.

## 4. agent://

- [x] 4.1 Implement the four `agent://` shapes (roster / output / `/transcript` / `/<child>`). Verified: bare `agent://` returns the roster, `<id>` the output artifact (last non-empty assistant message), `/transcript` the full history, `/<child>` the nested output; `AGENT_UNKNOWN_ID` / `AGENT_BAD_PATH` structured errors. (v0.1.8d: roster fixed at five columns with live status — see 9.7.)
- [x] 4.2 Fold `history://` semantics into `agent://`. Verified in the landed form (v0.1.8d): the `history://` special case was deleted — `history://` hits the generic `URL_UNREGISTERED_SCHEME` error; transcripts are read via `agent://<id>/transcript`.

## 5. dsh://

- [x] 5.1 Implement `dsh://docs` (static docs mapping, traversal guard). Verified: `dsh://docs` lists docs as JSON, `dsh://docs/<doc>` returns content, `URL_DOCS_UNAVAILABLE` / `URL_DOC_NOT_FOUND` structured errors. (v0.1.8d packaging fix — see 9.9.)
- [x] 5.2 Implement `dsh://config` (resolved settings, namespaced, secrets blocked). Verified: `dsh://config` returns redacted resolved config, `dsh://config/<ns>` one namespace; `role('secret')` redaction plus the key-name denylist; `URL_SETTINGS_UNAVAILABLE` / `URL_UNKNOWN_SETTINGS_NAMESPACE` / `URL_UNKNOWN_RESOURCE` structured errors.

## 6. ctx:// (superseded by 9.4)

- [x] 6.1 Add the kernel query/set channel (protocol message types). Verified in v0.1.8c: variables could be queried/set by name. Status (v0.1.8d): the channel remains as optional runtime-layer infrastructure (`runtime-surface.ts` `queryVar`/`setVar`) but is no longer wired to `ctx://`.
- [x] 6.2 Implement the v0.1.8c `ctx://` variable handler (JSON-safe→JSON else repr; bare listing; write-through). Verified in v0.1.8c. **Superseded in v0.1.8d by the curated read-only snapshot (9.4)** — the kernel-variable semantics were reversed; see design.md D4 for the rationale.

## 7. Device scheme (renamed)

- [x] 7.1 Implement the empty device handler. Landed as `dvc://` (renamed from `xd://` in v0.1.8d): bare = `no devices mounted`, `<device>` = `unknown device: <name>` placeholder text, write = structured `DVC_NO_DEVICE`. Verified: `wiring.spec.ts` resolves both read shapes; write dispatch covered in the delegation spec.

## 8. Integration verification (v0.1.8c wave)

- [x] 8.1 Full retest: plain-path read/write/grep/glob without regression + all schemes end-to-end; hashline anchors and sandbox/approval effective on both branches. Verified for the v0.1.8c wave (suite green at the time); re-run for v0.1.8d in 9.12.

## 9. v0.1.8d patch (all landed)

- [x] 9.1 Delegation architecture: `native-capture.ts` captures the native `write`/`grep`/`glob` definitions via `ctx.tools.get(name, agent)` at `agent/session-start`, BEFORE the wrappers register (WeakMap per agent); non-URL inputs call `native.execute(args, exec)` verbatim, preserving the native write-intent policy gate and ripgrep. Verified: capture-before-register ordering asserted in `wiring.spec.ts`; passthrough tests in `tools-delegation.spec.ts`.
- [x] 9.2 grep/glob URL branch: path-backed schemes (handler `resolvePath`; `skill://` today) translate the URL to a disk path and delegate to native; content-backed schemes (agent/ctx/`dsh://config`/http) materialize the resolved text into a temp dir and clean it up in a `finally` (`tools/materialize.ts`). Verified: materialization + cleanup tests in `tools-delegation.spec.ts`; `resolvePath` tests in `skill.spec.ts`.
- [x] 9.3 `http://`/`https://` handler: GET-only, 20 s timeout, 2 MiB cap (Content-Length precheck + streaming accounting), text whitelist (`text/*` + the application allowlist), structured codes (`URL_HTTP_TIMEOUT` / `URL_HTTP_FETCH_FAILED` / `URL_HTTP_STATUS` / `URL_HTTP_TOO_LARGE` / `URL_HTTP_UNSUPPORTED_MEDIA` / `URL_INVALID`), whole-URL strict parse from `env.rawUrl`, disclaimer first line. Verified: `http.spec.ts`.
- [x] 9.4 `ctx://` semantics reversal: curated read-only snapshot (`session`/`model`/`cwd`; bare lists keys); `CTX_NO_AGENT` / `CTX_UNKNOWN_KEY`; writes rejected `URL_READ_ONLY`; kernel-variable mapping removed (`queryVar`/`setVar` stay runtime-layer, unwired). Verified: `ctx.spec.ts`.
- [x] 9.5 Global rename `xd://` → `dvc://` (scheme key, handler module, `DVC_NO_DEVICE` code; no `xd` residue). Verified: wiring + delegation specs use `dvc://` exclusively.
- [x] 9.6 Delete the `history://` special case — unregistered schemes (history included) get the generic `URL_UNREGISTERED_SCHEME` error. Verified: no history special-casing remains in the source.
- [x] 9.7 `agent://` roster fixed at five columns: `id` / `status` (live registry state via `ctx.agents`, `-` when not live) / `kind` (`header.origin`, default `main`) / `parent` (`header.parentSession`, `-` at top) / `last activity` (last session event, ISO 8601, `-` when empty). Verified: roster rendering in the agent handler tests.
- [x] 9.8 `skill://` cwd fix: every registry lookup passes `{cwd: agent.session.header.cwd}` (same source as `dsh-tool-skill`'s `<available_skills>`), so `skill://` sees exactly the advertised skills. Verified: cwd-sensitivity tests in `skill.spec.ts`.
- [x] 9.9 `dsh://docs` packaging fix: `package.json` `prebuild` copies `../docs` → `docs/`, the `files` array ships it, and docs-dir resolution moved to `docs-dir.ts` (nearest-first walk-up covering source/lib/installed layouts). Verified: `resolveDocsDir` walk-up behavior; packaged layout includes docs.
- [x] 9.10 Mask acceptance wording corrected: the mask is presentation-only and scoped to the REPL `tool.*` binding surface + dashr tool-catalog section (ADR-0002); the host native `skill` tool and `<available_skills>` stay. Verified: `MASKED_TOOL_NAMES` contains `'skill'`; presentation spec covers binding/catalog exclusion only.
- [x] 9.11 Write D2-restore: non-URL writes delegate to the captured native `write` (write-intent policy gate back on the ordinary path); URL writes all rejected per scheme (`DVC_NO_DEVICE` / `URL_READ_ONLY` / `URL_WRITE_UNSUPPORTED` / `URL_UNREGISTERED_SCHEME`). Verified: delegation spec covers native passthrough and every rejection code.
- [x] 9.12 Full suite re-run for v0.1.8d: 239/239 tests green (vitest), covering plain-path non-regression and every scheme end-to-end.
- [x] 9.13 Post-verifier fixes: (a) `parseUrl` selector exemption for `http`/`https` (`SELECTOR_EXEMPT` in `selector.ts`) — port URLs no longer throw `URL_BAD_SELECTOR` and query strings are no longer applied as the `?q=` line filter (regression tests go through the real `UrlResolver`, the hole the original handler-direct tests missed); (b) the 20 s deadline now covers the WHOLE GET (headers + body streaming) and a mid-stream abort maps to `URL_HTTP_TIMEOUT` instead of a bare AbortError; (c) skill lookups pass the calling agent as `scope` alongside `cwd`, matching `dsh-tool-skill`'s lookup exactly. Verified: `http.spec.ts` 35/35 (3 new resolver-path regressions), `skill.spec.ts` scope-aware assertions, full suite 242/242.
