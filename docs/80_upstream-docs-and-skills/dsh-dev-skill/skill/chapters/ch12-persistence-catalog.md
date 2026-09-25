# Chapter 12: Persistence Catalog

## Core Idea
Session persistence is one **durable, replayable, append-only event log**: every record is a `SessionEvent` envelope (`type`, monotonic `seq`, epoch-ms `time`, `data`, optional `ignorable`, conditional `surfaceOp`/`sourceEventSeqs`). This catalog documents the *event vocabulary* (`SessionEventMap`) and the surface/log-only split — it does NOT document on-disk store layout, DSH_HOME anatomy, or durability mechanics (those live in `subsystems/persistence.md`, the doc's own cross-ref target). A log event is **not a Cordis event**: it reaches listeners through the single `session/event` emit.

## Frameworks Introduced
- **`SessionEventMap` (merge-extensible vocabulary)**: the owning vocabulary in `@deepseek-ai/dsh-session` plus every plugin declaration merge into `@deepseek-ai/dsh-session/types`; a downstream plugin can merge further current-version event types (outside this catalog by construction, requiring explicit disposition at a later format edge).
  - When to use: declaring a new durable event type. How: merge the key into `SessionEventMap`; surface types also join `SurfaceEventType`.
- **Surface vs log-only split**: `SurfaceEventType` = `'user/message' | 'assistant/message' | 'tool/result'` — the only types that produce LLM messages and may carry `SurfaceOp`. Everything else is **log-only**: durable + replayable, zero derived-history contribution.
  - When to use: a type enters the model transcript only if it is a surface type; audit/boundary/state records stay log-only.
- **`SurfaceOp` join rule**: `'append'` (tail) or `{ op:'replace', start, end }` (replaces surface nodes start..end; node's `sourceEventSeqs` must include every shadowed node). Used by compaction; any surface-replacing producer may use it.
- **`ignorable` marker protocol**: absent = **required** — a reader meeting an unrecognized type without `true` MUST refuse reconstruction (not silently drop), because a required event may change how the rest of the log interprets. A writer sets `true` only on purely informational records whose loss cannot affect reconstruction.
- **Shadow-price protocol (compaction)**: a surface `replace` event is priced by the metering event *immediately before* it (`compaction/summary` for a summarizing compaction, `compaction/prune` for a model-free prune), stating `shadowedRange`/`shadowedSeqs`/`shadowedTokenCount` — so a pure consumer can subtract the exact replaced range without retaining per-node prices.
- **Version lifecycle**: current writers stamp `SESSION_FORMAT_VERSION`; supported historical artifacts reach the current vocabulary through the build-static adjacent migration catalog (see `subsystems/persistence.md`).
- **JSON-serializability gate**: every payload is JSON-serializable, enforced at `Session.append` via `isJsonValue` — a non-serializable `meta` is rejected at the source, so replay reproduces the identical record.

## Key Concepts
- **SessionEvent**: discriminated union over `type` (so `switch (event.type)` narrows `event.data` without casts); envelope = `{ type, seq, time, data, ignorable?, sourceEventSeqs?, surfaceOp? }`.
- **SurfaceEventType**: the 3 message-producing types; only these may carry `SurfaceOp`; user/tool may cite `sourceEventSeqs`.
- **log-only**: durable, replayable, no `surfaceOp`, never in derived history (`deriveMessages()` ignores it).
- **session/end-seed**: durable projection of `Session.firstLiveSeq`; events before it (smaller seq) came from seed (resume/fork/replay). A fresh fork child owns one `{ inherited: true }` marker at its exact inherited-prefix cut; the last tagged marker is the current Session's cut.
- **session/event emit**: the single bus wiring — the log is not Cordis events; listeners hear via this one emit.
- **deriveMessages() projection**: the surface ordering → LLM messages (see `subsystems/session.md`).
- **Latest-wins fold events**: whole-value, non-surface state knobs whose LAST event is the session override — `plan/mode`, `sandbox/mode`, `approval/policy`, `session/title`, `todo/write`, `permission/preset`, `model/selection`.

## Mental Models
- Think of the **log as ground truth, the surface as derived history**: only `user/message`/`assistant/message`/`tool/result` join the model transcript; everything else is replayable audit.
- Think of **compaction as a surface `replace` + an adjacent metering event**: the replacement is priced by the event directly before it, never by per-node bookkeeping.
- Use **`ignorable: true` sparingly**: defaulting to *required* means a forgotten marker over-refuses (inconvenience) rather than silently resuming a gutted session.
- Treat **state knobs as latest-wins**: the projection unit folds the log to the last event; the model learns policy from runtime-context snapshot + live notices, not from these events.

## Anti-patterns
- **Silently dropping an unrecognized required event**: readers must refuse reconstruction unless `ignorable: true` is set — loss can change how the remaining log is interpreted.
- **A plugin appending `session/end-seed`**: only the `Session` constructor is a legitimate writer; a plugin doing so silently classifies every live bracket before it as seed history.
- **Appending a non-JSON-serializable `tool/result` `meta`**: rejected at `Session.append` (isJsonValue); the producing tool owns `meta` shape but it MUST be JSON.
- **Treating a log event as a Cordis event**: the durable log reaches listeners only through `session/event`; do not wire Cordis event listeners to it.

## Code Examples
```ts
export type SurfaceEventType = 'user/message' | 'assistant/message' | 'tool/result'
export type SurfaceOp = 'append' | { op: 'replace'; start: SessionSeq; end: SessionSeq }
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K; seq: SessionSeq; time: number; data: SessionEventMap[K]; ignorable?: true
  } & (K extends SurfaceEventType
      ? { sourceEventSeqs?: SessionSeq[]; surfaceOp?: SurfaceOp }
      : object)
}[T]
```
```ts
// Shadow price (compaction): metering event immediately precedes the replace.
'compaction/prune': {
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  shadowedSeqs: SessionSeq[]          // all shadowed surface nodes, surface order
  shadowedTokenCount: number          // heuristic price, fixed estimator
}
// tool/call pairs with tool/result by callId; arguments kept as the model's raw JSON string.
'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string }
```

## Reference Tables
Full payload declarations + JSDoc live in `src/docs/persistence-catalog.md` (~38KB, generated by `gen-persistence-catalog`, verified by `verify-persistence-catalog`). ★ = surface type (the only ones joining the model transcript).

| Family | Members | Badge |
|---|---|---|
| `user/*` | `user/message` | ★ surface |
| `assistant/*` | `assistant/message` ★, `assistant/attempt` | surface + log-only |
| `tool/*` | `tool/result` ★, `tool/call`, `tool/code-dispatch`, `tool/code-dispatch-start` | surface + log-only |
| `turn/*` | `turn/start`, `turn/end` | log-only |
| `step/*` | `step/start`, `step/end` | log-only |
| `request/*` | `request/header`, `request/context` | log-only |
| `session/*` | `session/end-seed`, `session/title`, `session/title-llm-request` | log-only |
| `agent/*` | `agent/inbox/spliced` | log-only |
| `agent-preset/*` | `agent-preset/selected` | log-only |
| `approval/*` | `approval/asked`, `approval/decided`, `approval/policy` | log-only |
| `sandbox/*` | `sandbox/mode` | log-only |
| `permission/*` | `permission/preset` | log-only |
| `plan/*` | `plan/mode` | log-only |
| `model/*` | `model/selection` | log-only |
| `command/*` | `command/run`, `command/done` | log-only |
| `compaction/*` | `compaction/start`, `compaction/end`, `compaction/summary`, `compaction/prune` | log-only |
| `feedback/*` | `feedback/record` | log-only |
| `goal/*` | `goal/change` | log-only |
| `hook/*` | `hook/invoked`, `hook/result` | log-only |
| `llm/*` | `llm/retry`, `llm/retry-started` | log-only |
| `schedule/*` | `schedule/change` | log-only |
| `session-log-deepseek/*` | `session-log-deepseek/delivery-accepted` | log-only |
| `subagent/*` | `subagent/descriptor`, `subagent/model-selection-policy` | log-only |
| `team/*` | `team/member`, `team/task`, `team/message/queued`, `team/message/delivered` | log-only |
| `todo/*` | `todo/write` | log-only |
| `tool-workflow/*` | `tool-workflow/run-start`, `run-end`, `agent-start`, `agent-end` | log-only |
| `web/*` | `web/deepseek-search-llm-request` | log-only |

Envelope facts: `seq` = monotonic per-session; `time` = Unix epoch ms; `data` = `SessionEventMap[K]`; `ignorable?` skip marker; `sourceEventSeqs?`/`surfaceOp?` surface-only. A log-only event never carries surface metadata (compiler-enforced at `Session.append`).

## Key Takeaways
1. Only three event types touch the model transcript: `user/message`, `assistant/message`, `tool/result` — all others are log-only durable audit.
2. A log event is **not** a Cordis event; wire to `session/event`, and project the surface with `deriveMessages()`.
3. Default unrecognized events to *required* (refuse reconstruction); opt into `ignorable: true` only for loss-safe informational records.
4. Compaction replaces surface nodes with `surfaceOp: { replace }`, priced by the metering event immediately before it (`compaction/summary` or `compaction/prune`).
5. Versioning: writers stamp `SESSION_FORMAT_VERSION`; historical artifacts migrate via the build-static migration catalog — not by hand.
6. Store layout / DSH_HOME anatomy / durability are **not** here — they are `subsystems/persistence.md`'s job; this catalog is the event-format vocabulary only.

## Connects To
- **Ch 13**: `Session.append`, `firstLiveSeq`, `deriveMessages()` projection — the core-session surface this log backs.
- **Ch 16**: `fs/observed`, preset/audit state — the durable facts consumed as session data.
- **Ch 17**: `TokenUsage` referenced by `assistant/message` and `compaction/summary` payloads.
- **Ch 14**: the agent loop commits `turn/start`..`turn/end`, `step/start`..`step/end`, `tool/call`/`tool/result`.
- **Ch 11**: tools emit `tool/call`, `tool/result`, `tool/code-dispatch*` as their durable effects.
