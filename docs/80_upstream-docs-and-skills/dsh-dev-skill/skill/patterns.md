# Patterns — dsh-dev-skill

Techniques and design patterns from the official docs. Format: name, when, how, trade-offs.

## Three-Role Capability Seam
**When to use**: a capability has ≥2 plausible implementations (shell backend, LLM provider, storage).
**How**: abstract Service Definition (the seam, e.g. `ctx.fs`) + Provider subclass + thin provider-neutral Consumer tools. Keep model-facing tool names stable over providers.
**Trade-offs**: more files/roles; pays off only for real replaceability — don't split a simple tool.

## Request/Spec Split
**When to use**: a seam has implementation defaults or caps.
**How**: `resolve(request)` materializes a fully-resolved spec (workdir/timeout/stdoutMaxBytes…) before run/start; no hidden `??` inside execution.
**Trade-offs**: one extra object; execution code becomes branch-free and testable.

## Event-Gate Companion Plugin
**When to use**: adding policy without forking providers (read-before-write, spill policy).
**How**: listen at `fs/write-intent`/`fs/edit-intent` or `tools/post-execute` waterfalls instead of registering a provider.
**Trade-offs**: policy lives beside, not inside, the provider — must be loaded alongside (bare fs tools lose the guard).

## Framework-Drives-Domain-Computes (Projection)
**When to use**: per-session derived state needed by host or clients.
**How**: register a pure synchronous `ProjectionDefinition`; never subscribe to `session/event` and fold yourself.
**Trade-offs**: constrained shape; the registry gives you backfolds, checkpoints, and `asOfSeq` for free.

## Typed Domain over Routed Backend
**When to use**: plugin persistence that is not a session event.
**How**: `defineDomain` spec (zod, layout, compatibleVersions) + `storageDomain.open`; sync reads, write-chain durability before `domain/changed`.
**Trade-offs**: schema discipline; backend routing becomes config (`storage-domain.backend`), not code.

## One-Adapter-Call-One-Attempt
**When to use**: writing an LLM adapter.
**How**: disable provider-library retries; adapter `stream()` emits `StreamChunk`s; recovery happens at the agent-loop level; fold blocks with the shared `BlockAssembler`.
**Trade-offs**: adapter stays thin; retry policy centralizes in `ResolvedRetryPolicy`.

## Per-Operation Credential Read
**When to use**: any code touching secrets.
**How**: config holds a `CredentialRef` (env-var name); `resolve(ref)` on every call; never cache the value.
**Trade-offs**: negligible cost; rotation reaches the next request with no restart.

## Slot Injection with Fresh List Id
**When to use**: contributing UI to a slot you don't own.
**How**: `ctx.slots.inject(key, cb)` → `register({name, id, order}, Component)`; use a fresh list id; never runtime-import another plugin's client module.
**Trade-offs**: single/keyed cells are replacement points — id reuse replaces, it does not merge.

## Settings CAS Write
**When to use**: any browser-side settings edit.
**How**: `mutate()` with `SettingsPathOp` (set/unset) + expectedRevision; never `replace()` from a redacted view.
**Trade-offs**: one extra round; wholesale replace from redacted descriptors silently deletes secrets.

## Layer Restatement (Patch Override)
**When to use**: changing a composed plugin's config.
**How**: target the row by id in a later layer (profile/home/`--patch`) and restate every key — whole-config replacement, no deep merge.
**Trade-offs**: verbose but explicit; partial restatement silently drops keys.

## Dev Overlay via `--patch`
**When to use**: iterating on a local plugin.
**How**: absolute-path insert row + `--patch` flag (or persist in `cordis.patch.yml`); HMR hot-replaces on edit.
**Trade-offs**: zero-install loop; remember it's a layer — shipping wants a bundle+profile.

## Boot-and-Read Cataloging
**When to use**: documenting tool/config surfaces.
**How**: boot the real profile through the Loader and read `ctx.tools.schemas()` / generated catalogs; never hand-transcribe runtime-spread schemas.
**Trade-offs**: needs a bootable environment; the generated+verified catalogs stay truthful.

## Remote Non-Throw
**When to use**: consuming client-remote calls.
**How**: calls return `RemoteResult<T>`; branch `if(!result.ok)` and discriminate by `code`, never `instanceof`; assembly mistakes still crash loudly.
**Trade-offs**: explicit error handling everywhere; no lost failures.

## Background Job Gate
**When to use**: a tool does long-running work.
**How**: `ctx.jobs.start({kind, label, owner: exec.agent, run})` and return `{kind:'background', jobId}`; kill requests, never forces.
**Trade-offs**: PTC mode must never parse prose for ids; job lifecycle (notices, `reported` flag) is managed.

## Waterfall Discipline
**When to use**: listening on any `@mode waterfall` event.
**How**: observers always call `next()`; omitting it is a deliberate veto. Match the dispatch method to the event's declared mode.
**Trade-offs**: misuse = accidental short-circuit; postmortem 0002 is the cautionary tale.

## Dispose-to-Quiescence
**When to use**: teardown of listeners + spawned work.
**How**: close listener registries first, then kill → await done; keep ordered steps in ONE disposer (async disposers run concurrently).
**Trade-offs**: returning early leaves orphans.

## Conjunction-of-Evidence Classification
**When to use**: attributing failed sandboxed runs.
**How**: check `runnerFailureRules` first (runner never ran), then per-backend `denialSignatures` — never exit status or cross-backend unions.
**Trade-offs**: requires exact signature tables; prevents SANDBOX_UNAVAILABLE mislabels (postmortem 0004).
