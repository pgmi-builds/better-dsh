# ctx:// Long-Session Navigability — Design

> Status: approved (user, 2026-10-02). Implements backlog N1–N6 plus findings F1/F2 from
> `docs/50_test-reports/2026-09-28-ctx-scheme长会话utility实测报告.md` §八.
> Live spec delta: `docs/specs/ctx/spec.md`. Plan: `docs/superpowers/plans/2026-10-02-ctx-navigation.md`.

## 1. Scope ruling (carried from the report, §八)

This tool family is **text-keyword recallable navigation** — the phone book + index + pointer
for a long session. Semantics is out of scope: no embeddings, no semantic ranking, no
"fuzzy" retrieval. The model is a language model; synonym/substitution/keyword work is its
job. We guarantee only: **原文可取 + 可寻址** (原文 retrievable, and addressable).

Every number this scheme shows the model MUST either be directly usable as a selector in the
same URL family, or be explicitly labeled metadata with its unit. A bare, unlabeled number
that *looks* like a coordinate but is not addressable is the failure mode this change
eliminates.

## 2. Coordinate model (the spine)

Two coordinate systems, both labeled wherever shown:

| Unit | Meaning | Used by |
|---|---|---|
| `seq` | event sequence number in the session log | `[<n\|seq>]` element/label addressing |
| `line` | transcript line number (1-based) | `:N-M` windows and `grep … ctx://session/transcript` |

The transcript is the **canonical coordinate space**. `grep` on `ctx://session/transcript`
materializes the transcript and returns transcript line numbers; therefore every exposed
`lines=` figure is a transcript line and pastes directly into `:N-M`, and episode windows are
transcript-relative.

**Decision (user, 2026-10-02): transcript-relative everywhere.** `compactions[label]:5300-5310`
means transcript lines 5300–5310, identical to `transcript:5300-5310`. The first episode starts
at transcript line 1, so episode-relative and transcript-relative coincide for it.

## 3. Data model changes (in `better-dsh/src/url-schemes/handlers/ctx.ts`)

### 3.1 Transcript line index (structural, N1)

Build the transcript **once** and carry per-entry line ranges, instead of the current two
independent renders (`transcript()` and each episode's `originalText`):

```ts
interface TranscriptIndex {
  text: string                      // the joined transcript (canonical face)
  totalLines: number
  lineOfSeq: Map<number, { start: number; end: number }>   // per rendered entry, transcript lines
}

function buildTranscript(events, toolNameOf): TranscriptIndex {
  const entries = events
    .map(e => ({ seq: e.seq as number, text: renderEntry(e, toolNameOf) }))
    .filter(t => t.text !== '')
  const lineOfSeq = new Map()
  let line = 1
  for (let i = 0; i < entries.length; i++) {
    const n = entries[i].text.split('\n').length
    lineOfSeq.set(entries[i].seq, { start: line, end: line + n - 1 })
    line += n + (i < entries.length - 1 ? 1 : 0)   // one blank separator line between entries
  }
  return { text: entries.map(e => e.text).join('\n\n'), totalLines: line - 1, lineOfSeq }
}
```

The episode's canonical span is then **derived** from the index (guarantees the invariant by
construction):

```ts
// episode lines = min/max transcript line over the shadowed events that rendered
const lineStart = min(lineOfSeq.get(seq).start for shadowed seqs that rendered)
const lineEnd   = max(lineOfSeq.get(seq).end   for shadowed seqs that rendered)
const originalText = transcript.text.split('\n').slice(lineStart - 1, lineEnd).join('\n')
```

If no shadowed event rendered (degenerate), the episode has an empty span (`lines: null`).

### 3.2 Episode shape

Each episode gains `lines: { start, end } | null`, `fidelity: { userTurns, toolCalls }`, and a
computed `landmarks` block. The manifest line, the snapshot `compacted[]` entry, the snapshot
`segments[]` entry, and the episode prepared face all carry `lines=` and `seq=` labeled figures.

### 3.3 `resultTextOf` shape robustness (F2)

`tool/result` messages in the current session format store **flat** text blocks
(`data.message.content: [{type:"text", text:"…"}]`); the nested `tool-result` block form is
the older shape. Today `resultTextOf` only flattens the nested form, so every result renders
empty. Fix: prefer nested, fall back to flat:

```ts
function resultTextOf(event: PersistenceEvent): string {
  const blocks = blocksOf(event)
  const nested = blocks
    .flatMap(b => (b as { content?: ContentBlock[] }).content ?? [])
    .map(c => c.text ?? '').join('\n')
  if (nested !== '') return nested
  return textOf(blocks)   // flat text blocks (current session format)
}
```

## 4. Backlog implementation

### N1 — addressable line coordinates + explicit bounds (F7/F10)

- Manifest line per episode: `seq=<start>..<end> (N items, T tokens)` **and**
  `lines=<lineStart>..<lineEnd>` (or `lines=<none>`), plus `fidelity=ut:tc`.
- Snapshot: `segments[]` → `{ segment, seq_start, seq_end, lines: {start,end}|null, items }`;
  `compacted[]` gains `lines`, `fidelity`.
- Episode prepared face header prints `lines=` and `seq=` labeled.
- Episode line windows are transcript-relative and **clamped with an explicit boundary note**
  when a requested range reaches past the span (never silent-empty):

  ```ts
  // transcript coords -> episode-local coords
  function applyEpisodeLines(slice, lineStart, lineEnd, ranges): string
  // out-of-span tail appends: [ctx:// note: episode span is transcript lines <s>-<e>]
  ```

  A window entirely outside the span returns the note alone (not empty). `:raw` still returns
  the full span.

### N2 — digest residence rule (design position §八.4)

- `latest` = the last episode in the chain; its digest is the compact-checkpoint message
  already resident in live context.
- Compute the checkpoint's transcript lines (the `user/message` with `source.plugin === 'compact'`
  at `checkpointSeq`; fall back to the seq when no line is mapped).
- Latest episode prepared face = **navigation block** (no digest dump):

  ```text
  [ctx://session/compactions[<label>] — digest is already in your live context]
  lines=<ls>..<le>  seq=<ss>..<se>  items=<n>  tokens=<t>
  fidelity=<ut>:<tc>
  digest resident at seq=<checkpointSeq> (transcript:<start>-<end> when mapped) — read it there,
  or use :raw here for the shadowed span
  <landmarks>
  ```

- Older episode prepared face = **full digest** (`summaryText`) followed by the same pointer
  block. `:raw` on any episode always returns the span, so a digest is never lost.

### N3 — landmark roster (direction markers, all as line coordinates)

Computed over the episode's shadowed events; capped to stay one screen:

- `user turns (<n>): <line>, <line>, …` — transcript line of each rendered `user/message`
  with `source.kind === 'user'` (cap 30, then `… +N more`).
- `failures (<n>): <line> <tool>, …` — `tool/result` events with
  `data.message.isError === true` or a present `data.error` (cap 20).
- `touched paths: <path>×<count>, …` — path-valued strings extracted from `tool/call`
  `arguments` (keys `path`/`file_path`/`filePath`/`file`, plus `edits[].path` and
  `files[].path`; args larger than 64 000 chars skipped). Best-effort pointer, not an index.
  (cap 12, sorted by count desc).
- `prior checkpoints in span: <n>` — count of `user/message` with `source.plugin === 'compact'`.

### N4 — fidelity line

`fidelity=<userTurns>:<toolCalls>` per episode (tool-heavy ⇒ digest trustworthy and detail
regenerable; user-intent-heavy ⇒ must drill down). Inline in manifest, snapshot `compacted[]`,
and the episode pointer block.

### N5 — `:path/` and `?q=` in ctx (F5/F8) + error echo

The selector grammar already parses `path`/`query` and `applySelector()` (selector.ts) already
implements JSON dot-path + line filter. Wire them into `applyFace`:

```ts
if (selector.kind === 'path' || selector.kind === 'query') {
  return applySelector(face === 'canonical' ? canonical : prepared, selector)
}
```

So `ctx://session:path/totals.tool_calls` narrow-reads the snapshot JSON, and
`ctx://session/injections?q=subagent-settled` filters the index. The manifest route also runs
through `applySelector` (so `?q=` and `:N-M` windowing work on it too). Update
`CTX_BAD_SELECTOR` to echo the URL and the supported selector set.

### N6 — snapshot `asOf`

Snapshot gains `asOf: { seq: <max seq>, line: <totalLines> }` and a hint that totals are live
at read time (a cached snapshot is knowingly stale).

### F1 — element-collection index faces + error echo

- `user_prompts` bare → index list (one line per prompt: `seq=<s> <preview>`); canonical
  `:raw` = all joined.
- `tool_calls` / `agent_responses` bare → bounded index (first 20 lines + `… +N more — use
  :raw for all, ?q= to filter, [n|seq] for one`); canonical `:raw` = all joined.
- `[n|seq]` behavior unchanged.
- Error text for a bad element stops echoing an empty-bracket URL; it names the collection,
  its count, and the 0-based/seq addressing (already mostly present — align the message).

## 5. Out of scope

- F3 (`read` offset/limit silently ignored on URIs) — harness read-tool contract, not this handler.
- Semantic/vector retrieval; embeddings; "fuzzy" search (see §1).
- F4 (compaction label drift) — already mitigated by the error listing current labels; the
  `compactionId` (uuid) stable-key idea is recorded but not implemented this wave.

## 6. Verification

Unit: extend `better-dsh/test/url-schemes/ctx.spec.ts` (and add focused specs) with the
invariants above — notably **episode span ≡ transcript slice** and **episode `:N-M` ≡
`transcript:N-M`** for non-first episodes. Full `vitest run` + `tsc --noEmit` green.

First-person (4999 rig, dsh 0.2.0-rc.2): a real long-session instance reads the snapshot
(asOf + lines present), windows a deep episode by transcript line, filters an index with
`?q=`, narrow-reads with `:path/`, and confirms a large tool result is no longer empty.
