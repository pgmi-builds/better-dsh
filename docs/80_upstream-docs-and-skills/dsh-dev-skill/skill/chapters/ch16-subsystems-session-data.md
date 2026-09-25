# Chapter 16: Subsystems — Session Data (Projection, Storage, Jobs)

## Core Idea
Every subsystem around the event log — projections, queries, references, titles, telemetry, persistence, domain storage, attachments, workspaces, jobs — layers over one source of truth: the in-memory append-only `Session` log, made durable by `SessionPersistence`. Derive rather than duplicate: fold the log into whole values, and keep non-log state in typed storage domains.

## Frameworks Introduced
- **ProjectionDefinition** (`ctx.sessionProjections.register`): "the framework drives, the domain computes" — the registry subscribes to `session/event` once and folds every committed event through every registered unit; domains hold no subscriptions, clients never fold.
  - When to use: any per-session derived state, host-only or client-visible.
  - How: `{key, stateSchema, init(header, inheritedEventCount), apply(state, event), wire?: {viewSchema, view}, stateVersion}` — all functions synchronous, state plain JSON; the disposer rides the calling fiber (unload ⇒ key reads as capability absence).
- **SessionQueryEngine** (`ctx.sessionQuery`): live-preferred reads over live + persisted sessions.
  - When to use: list/filter/search/trace anything beyond the current live session.
  - How: concrete `listSessions` (newest-first), `readSession`, `readSurface`, `filterSessions`/`filterEvents`, `readEvent`, `traceSession`, `traceEvent`, `readTitle(s)`; a backend implements only the abstract `searchSessions`/`searchEvents`.
- **SessionReferenceResolver** (`ctx.sessionReferenceResolver`): structured cross-session references (not fork semantics).
  - When to use: host mention/autocomplete (`@[label](dsh-session:…)`) and cross-session context injection.
  - How: `listCandidates(agent, query)` (keystroke-rate, self excluded, cwd-affinity ranked); `prepare(agent, content, references)` snapshots the referenced session's current surface into one aggregated untrusted `additionalContext`.
- **SessionTitleService** (`ctx.sessionTitle`): log-backed latest-wins title fold plus one optional async provider.
  - When to use: naming sessions or shipping a custom title generator.
  - How: `get`/`rename`/`refresh`/`register(provider)`; provider `{id, automatic: 'first-prompt'|'all-prompts', generate(request)}`; the service owns acceptance (seq ordering, normalization, byte limit).
- **SessionTelemetrySink** (`ctx.sessionTelemetry`): canonical-event capture under the boundary axiom — the harness aspect ends at `emit()`; batching, retry, queueing, and loss policy belong to the reporting SDK.
  - When to use: outbound session reporting (the OTel backend is the shipped provider).
  - How: implement `emit` (non-blocking enqueue), optional `flush`, `shutdown` (drain to quiescence); redact through the `session-telemetry/record` waterfall.
- **SessionPersistence** (`ctx.sessionPersistence`): the durability seam — `create`/`open`/`stat`/`list` returning per-session `SessionHandle` (`read`/`append`/`flush`/`close`).
  - When to use: resume, cold reads, out-of-tree storage backends.
  - How: `open(id, 'write')` claims single-writer ownership (`SessionAlreadyOwnedError` on contention); `append` is best-effort — only a resolved `flush` (handle or service-wide) promises crash survival and cross-process materialization.
- **DomainSpec / defineDomain** (`ctx.storageDomain` ≡ `ctx.storage.domain`): typed KV domains routed over registered backends (`json`, `sqlite`).
  - When to use: plugin-owned persistent data that is not a session event.
  - How: declare the spec once (zod record schemas, `layout: 'single'|'per-record'`, `compatibleVersions`, `invalidRecords: 'backup-and-skip'`); `open(spec)` validates the medium; reads are synchronous, writes chain durability → memory → `domain/changed`.
- **AttachmentStore** (`ctx.attachments`) + **FileUploads** (`ctx.fileUploads`): immutable content-addressed binaries under the persist-before-event rule.
  - When to use: images/files in prompts or model output; browser upload staging.
  - How: `saveImages`/`admitPromptContent` validate every member before committing any; session events carry refs (`ImageAttachmentRef`/`FileAttachmentRef`), never bytes, object URLs, or paths; `ctx.fileUploads` stages receipts bound to the receiving Agent (`bindPrompt`/`retirePrompt`).
- **WorkspaceRegistry** (`ctx.workspaceRegistry`): stable uuid identity over canonical (`fs.realpath`) directories plus header-validated session accounts.
  - When to use: host-side grouping of sessions by working directory (invisible to models).
  - How: `create(path, title?)` is idempotent per canonical path; membership = account entry ∧ canonical header cwd equals path; `attachSession` prepends, activity never reorders.
- **JobRegistry** (`ctx.jobs`): background job identity, authorization, and settlement.
  - When to use: long-running producers (shipped kinds `bash`, `subagent`; extend `JobKindMap` by declaration merging).
  - How: `start({kind, label, owner?, run(): JobHooks})` after preflight; hooks `{cancel, done, readOutput?}`; `kill` requests cancellation and marks `stopping`/`reported`.

## Key Concepts
- **Whole-value event rule**: state-carrying log events carry the complete post-change state, never a delta — transitions stay trivially cheap, served values self-describing.
- **`Object.is` discipline**: `apply` returns the same state reference when uninterested (zero downstream work); an object-valued `view` reuses its reference to suppress publication.
- **`asOfSeq`**: snapshot watermark — seq of the last event every value reflects (`-1` for an empty log); `snapshot()` is fully synchronous, so one cut covers values and cursor in one tick.
- **Live-preferred corpus**: query prefers live `ctx.sessions`, falls back to persisted logs; `SessionRecord {header, live, persisted}` separates source availability from the cloned header.
- **`inheritedEventCount`**: exact fork-inherited prefix length stored beside the header; seeds projection `init` and completes cache-row identity.
- **Projection cache rows**: `(sessionId, key, ver, seq, val)` in the `session_projcache` domain; a `stateVersion` mismatch discards old rows rather than forward-folding them into garbage.
- **Revision token**: opaque change token from `stat`/`list`; equal ⇒ may treat the log as unchanged, unequal promises nothing; keys cold-read caches and plays no part in open/read/resume.
- **`domain/changed`**: fires strictly after backend durability in write-chain order; `put` carries only the new value (never the old); a throwing listener is contained — the write is already durable.
- **`reported` flag**: suppresses redundant job-completion notices once any reporter commits; teardown claims it so owner disposal spends no model request.
- **Telemetry dedupe**: ledger records mirror events one-to-one — receivers dedupe on `(session.id, session.format_version, event.seq)`; ops records (`agent-error`, `shutdown`) deliberately carry no identity.

## Mental Models
- Think of projections as a fold server: domains register pure units, carriers receive finished whole values — never fold `session/event` client-side.
- Think of a storage domain as a synchronous cache over a serial write chain: a rejected backend write leaves memory untouched, so reads never diverge from the medium.
- Think of jobs as split ownership: runtime owns identity/access/lifecycle, producer owns execution resources; `done` resolves after resources are released, not when work finishes.
- Treat `SessionHeader` as metadata-beside-the-log (`cwd`, `parentSession`, `isSeeded`, `origin`, `delegationDepth`, `agentPreset`) — it never enters `SessionEventMap` or `deriveMessages()`.

## Anti-patterns
- **Async projection unit / non-JSON state**: tears the carriers' consistency cut and breaks the persisted-cache precondition.
- **Mutating returned references**: `stateOf` values and domain table records are live or shared — replace via `put`/`update`, never mutate in place.
- **Parsing `AttachmentId` as a path**: it is opaque (`sha256:<digest>` today); ask `imageHostPath()`/`fileHostPath()` and let the execution world judge readability.
- **Blocking `emit()`**: it runs synchronously on the `session/event` hot path — anything slower than a queue push taxes the agent loop.
- **Expecting persistence to repair crashed turns**: it returns the valid contiguous log and truncates only the torn physical tail; appending `interruptedTurnClosers` is the resuming reader's job, under write ownership.
- **Relying on job-id secrecy**: ids are predictable (`<kind>-N`); the boundary is owner-session authorization.

## Code Examples
```ts
ctx.sessionProjections.register({
  key, stateSchema, stateVersion: 1,
  init: (header, inheritedEventCount) => empty,
  apply: (s, e) => e.type === 'my/state' ? e.data.state : s, // same ref ⇒ no work
  wire: { viewSchema, view: s => clientShape(s) },
}); // disposer rides the calling fiber

const spec = defineDomain({
  name: 'my-plugin', version: 2, layout: 'per-record',
  compatibleVersions: [1], invalidRecords: 'backup-and-skip',
  tables: { items: domainTable<ItemId, Item>(ItemSchema) },
});
const domain = await ctx.storageDomain.open(spec);

const id = ctx.jobs.start({
  kind: 'bash', label: command, owner: agent,
  run: () => ({ cancel: reason => proc.kill(), done, readOutput: () => drain() }),
});
```

## Reference Tables

| Projection read ladder | I/O | freshness |
|---|---|---|
| `sessionProjectionCache.cachedSnapshot(meta, inheritedEventCount)` / registry `viewCheckpoint(rows)` | zero | as stale as the last checkpoint, never wrong |
| `sessionProjectionCache.hydratePrepared(session, events)` | no extra read | observation cut |
| `sessionProjectionCache.coldSnapshot(meta, inheritedEventCount, events)` / registry `restore(rows, events, baseSeq)` | log suffix from `restoreFloor`, seeded by usable rows | log end |

| Storage `open(spec)` failure ladder | code |
|---|---|
| name already open/closing | `already-open` |
| route unresolved | `backend-not-found` |
| backend lacks `kv` facet | `facet-unsupported` |
| unit stamp/parse | `version-mismatch` / `malformed-medium` |
| record schema | `invalid-record` (or backup-and-skip) |

| Jobs semantics | rule |
|---|---|
| `start` | preflight (access, cleanup, admission) → sync `run()`; after it returns, registration cannot fail |
| `kill` | returns `'requested' \| 'already-finished'`; marks `stopping` + `reported` |
| `wait(id, timeoutMs)` | bounded, never cancels; post-settlement the terminal snapshot wins |
| settlement | first-wins; completion announced last (a reporter may open a model turn) |
| admission | `maxConcurrentJobsPerOwner` default 10, counting `running`+`stopping` per exact owner |

| Attachment admission (local backend) | limit |
|---|---|
| images / encoded bytes per message | 20 / 200 MiB |
| per source | 20 MiB, 64,000,000 px, ≤8192 px per side |
| normalization defaults | long edge 2048 px, 4 MiB encoded |

## Key Takeaways
1. Register a projection unit instead of subscribing to `session/event`: the framework drives every unit once per committed event, lazily backfolds late registrations over the in-memory log, and checkpoints through `session_projcache` (mandatory points: session creation, `turn/end`, disposal; otherwise throttled write-behind).
2. Gate crash survival on `flush`, not `append` — a session that never materialized before a crash never existed. Repair of an interrupted turn (missing tool errors, open `step/end`, synthetic `turn/end {reason: 'interrupted'}`) is written by resume under write ownership; `interrupted` is the one `TurnEndReason` no loop emits.
3. Fork/replay is `ctx.agents.create({sessionId, seed, meta})` with `inheritedEventCount` and `meta.isSeeded: true`; resuming a persisted session is `ctx.agents.resume({resumeSessionId})`.
4. Prefer `per-record` layout + `compatibleVersions` + `invalidRecords: 'backup-and-skip'` for disposable derived data (the projection-cache pattern); keep the rejecting `single` default for authoritative data.
5. Consume sessions through `ctx.sessionQuery` concrete reads; full-text queries are data, never executable FTS syntax, and within-session pages carry the target header even with zero hits.
6. Workspace membership needs both the account entry and canonical header-cwd equality — one session belongs to at most one workspace; registry `delete` retains sessions (they become Ungrouped). A `user`-source title rename pins the title; `refresh` is the deliberate unpin.
7. Redaction lives in the `session-telemetry/record` waterfall (fail-closed, exported copy only — the canonical log is never rewritten); the seam ships no rules, so exported data is exactly as clean as what the deployment mounts.

## Connects To
- **Ch 13**: the `Session`/`SessionEvent`/`SessionHeader` vocabulary every fold and read here consumes.
- **Ch 12**: persistence-catalog enumerates the exact log events mirrored by ledger telemetry and query folds.
- **Ch 14**: agent-loop owns resume repair and the `turn/end`/`session/flush` checkpoints that drain persistence write-behind.
- **Ch 15**: tool-execution backgrounds `bash`/`subagent` work through `ctx.jobs` kinds.
- **Ch 09**: gateway controllers (session, workspace, file-upload, directory-picker) are the Remote consumers of these registries.
- **Ch 07**: each subsystem here is an optional capability seam, deliberately off the agent-loop spine.
- **Ch 05**: registration-as-effect, merge-extensible maps (`JobKindMap`, `StorageForms`), and waterfall semantics are Cordis mechanics.
