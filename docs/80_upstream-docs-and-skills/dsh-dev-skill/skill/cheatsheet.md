# Cheatsheet — dsh-dev-skill

Decision rules and quick tables. Every line helps you decide something.

## Which extension surface? (seam-selection)

| You want to… | Use | Not |
|---|---|---|
| Add a model-facing tool | `defineTool` into `ctx.tools` | fork a core |
| Change policy on existing tools | event gates (`tools/pre-execute`, monotonic guards) | rewrite tools |
| Add policy w/o forking providers | companion plugin on `fs/*` or `tools/post-execute` | provider fork |
| Swap a capability (shell/fs/llm) | provide at the seam (Definition+Provider+Consumer) | bundle a copy |
| Contribute UI | `ctx.slots.inject` + fresh list id | runtime-import other plugins |
| Change a plugin's config | later-layer row restatement (whole config) | field merge (doesn't exist) |
| Iterate on a local plugin | `--patch` absolute-path insert row | install loops |
| New provider backend | `LlmAdapter.stream()` + `registerAdapter` | wrap another adapter |
| Stream to browser | Connection Fetch exact route | Remote method (unary only) |
| Long-running tool work | `ctx.jobs.start` → `{kind:'background',jobId}` | prose ids |
| Per-session derived state | `ProjectionDefinition` | manual `session/event` fold |
| Plugin persistent data | `defineDomain` + `storageDomain.open` | ad-hoc files |
| Model-visible input | extend `SessionEventMap` (log it) | inject outside the log |

## Hard rules (fail-loud / fail-closed)

- Sandbox mode unavailable ⇒ `SANDBOX_UNAVAILABLE` — never silent unconfined passthrough.
- Approval absent/unanswerable ⇒ deny. Only `allowed-once` grants; escalation is one-shot, strictly wider.
- `provide` throws on duplicate name within a scope — sibling shadowing doesn't exist (ancestor/isolate only).
- Unrecognized session event type ⇒ treated required (refuse reconstruction); opt-in `ignorable:true` only for loss-safe records.
- Non-JSON payload ⇒ rejected at `Session.append`.
- Adapter can't honor a `GenerateOptions` field ⇒ throw `LlmError('UNSUPPORTED_OPTION')`, never drop silently.
- Plugin reading undeclared optional service ⇒ `ctx.get(name)`, never `ctx.<name>` (ancestor-only walk throws).
- Config row override ⇒ restate every key; whole-config replacement, no deep merge.
- A config tree omitting an injected `Requires:` service fails to compose.
- Model-visible means logged: model requests must be reconstructable from the session log.

## Key defaults & thresholds

| Thing | Default / value |
|---|---|
| `SandboxMode` | `read-only` |
| `ApprovalPolicy` | `ask` (fail-closed); `never` for CI |
| Retry policy | `ResolvedRetryPolicy` 5 retries, agent-level |
| `dshHome` | `$DSH_HOME` → `~/.dsh` |
| Session formats | v0 `session.jsonl[.zstd]`; v1+ `session.vN.jsonl[.zstd]`; committed paths never renamed |
| Surface event types | exactly 3: `user/message`, `assistant/message`, `tool/result` |
| Profiles | `web`, `headless`, `sdk`, `sdk-minimal`, `acp` |
| Layer order | bundles → profile → home → `--patch`; later wins |
| LLM usage counts | input + cacheRead + cacheWrite = billed input |
| Env-var hygiene | scrub `*KEY*/*SECRET*/*TOKEN*/*PASSWORD*`; spill dirs 0700, files `'wx'` 0o600 |

## Tells & smells

- New plugin does nothing ⇒ check `FiberState.PENDING` (silent wait on missing service) and module-specifier spelling.
- Plugin exports look dropped ⇒ `unwrapExports` trap: Loader prefers `exports.default` (postmortem 0001).
- `!!js` in `disabled` always-truthy ⇒ expression objects are never falsy — silent permanent disable (postmortem 0002).
- Tools suddenly ungated ⇒ observation-policy plugin not loaded beside fs tools.
- Settings lost secrets ⇒ someone did `replace()` from a redacted descriptor.
- Exit-code-based sandbox blame ⇒ use runnerFailureRules + denialSignatures, not exit status (postmortem 0004).
- Git-installed plugin broke ⇒ missing `prepare` script or `allowBuilds` entry.

## Workflow quickies

- Verify composed config: `--dump-config` (grep your plugin).
- Catalogs are generated: rerun `gen-tool-catalog`/`gen-config-catalog` style build steps; never hand-edit.
- After changing client-visible signatures: rerun the strict build pipeline (`build:lib` faces) to regenerate Client declarations/codecs.
- Stacked PR fix: fix the introducing PR, propagate up-stack.
- i18n pair edited ⇒ update counterpart + re-record hashes in the same PR (CI red-flags drift).
