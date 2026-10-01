# ctx:// Long-Session Navigability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ctx://` a navigable long-session surface: every coordinate it shows is addressable, digests are pointers not re-dumps, and landmarks/fidelity direct the model to what matters.

**Architecture:** One handler file (`src/url-schemes/handlers/ctx.ts`) gains a transcript line index (single source of truth for line coordinates), transcript-relative episode windows, a digest-residence rule, a landmark/fidelity block, and `:path/`/`?q=` selector support via the existing `applySelector` in `selector.ts`.

**Tech Stack:** TypeScript (ESM), Vitest, the `@deepseek-ai/dsh-*` harness peer types.

**Spec:** `docs/superpowers/specs/2026-10-02-ctx-navigation-design.md` (algorithms) and `docs/specs/ctx/spec.md` (requirements). Executors read both.

## Global Constraints

- Coordinate invariant: every number shown is labeled (`seq=` or `lines=`) and directly addressable; transcript is the canonical line space.
- Episode line windows are transcript-relative (`compactions[label]:N-M` ≡ `transcript:N-M`).
- Out-of-span windows return an explicit boundary note, never a silent empty/truncated view.
- Digest residence: latest episode's prepared face never re-dumps the digest; older episodes return their full digest; `:raw` always returns the span.
- Landmarks and fidelity are capped to one screen and tail `… +N more`.
- No semantic/vector retrieval. Phone book + index + pointer only.
- `tsc --noEmit` 0 errors; `npx vitest run` green (baseline 641 passed / 1 skipped).

---

## Task 1: Transcript line index + episode `lines`

**Files:**
- Modify: `better-dsh/src/url-schemes/handlers/ctx.ts`
- Test: `better-dsh/test/url-schemes/ctx.spec.ts`

**Interfaces:**
- Produces: `TranscriptIndex { text; totalLines; lineOfSeq: Map<number, {start,end}> }` (see design §3.1); each episode gains `lines: { start: number; end: number } | null` and `originalText` is derived from the transcript slice.

- [ ] **Step 1: Add the failing test for episode line coordinates**

```ts
it('reports transcript line coordinates per episode and keeps the snapshot labeled', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const snap = JSON.parse(await r.resolve({} as ResolverEnv, 'ctx://session', null))
  const ep0 = snap.compacted[0]
  expect(ep0.lines).toBeTypeOf('object')
  expect(ep0.lines.start).toBeGreaterThanOrEqual(1)
  expect(ep0.lines.end).toBeGreaterThanOrEqual(ep0.lines.start)
  // the manifest prints labeled lines= too
  const manifest = await r.resolve({} as ResolverEnv, 'ctx://session/compactions', null)
  expect(manifest).toMatch(/lines=\d+\.\.\d+/)
  expect(manifest).toMatch(/seq=\d+\.\.\d+/)
})
```

- [ ] **Step 2: Run it, confirm it fails** (`npx vitest run test/url-schemes/ctx.spec.ts` — `lines` is `undefined`)

- [ ] **Step 3: Implement `buildTranscript` and derive episode `lines`/`originalText`**

```ts
interface TranscriptIndex {
  text: string
  totalLines: number
  lineOfSeq: Map<number, { start: number; end: number }>
}
function buildTranscript(events: readonly PersistenceEvent[], toolNameOf: (s?: number) => string | undefined): TranscriptIndex {
  const entries = events.map(e => ({ seq: e.seq as number, text: renderEntry(e, toolNameOf) })).filter(t => t.text !== '')
  const lineOfSeq = new Map<number, { start: number; end: number }>()
  let line = 1
  for (let i = 0; i < entries.length; i++) {
    const n = entries[i].text.split('\n').length
    lineOfSeq.set(entries[i].seq, { start: line, end: line + n - 1 })
    line += n + (i < entries.length - 1 ? 1 : 0)
  }
  return { text: entries.map(e => e.text).join('\n\n'), totalLines: line - 1, lineOfSeq }
}
```

In `resolve`, replace the standalone `transcript()` closure with a single `const tIdx = buildTranscript(events, toolNameOf)` computed once (after `toolNameOf` is defined) and reuse `tIdx.text` everywhere `transcript()` was called. In the episode build loop, after `originalText` is assembled, set:

```ts
const shadowLines = d.shadowedSeqs
  .map(s => tIdx.lineOfSeq.get(s)).filter((x): x is {start:number;end:number} => x !== undefined)
const lines = shadowLines.length === 0 ? null
  : { start: Math.min(...shadowLines.map(x => x.start)), end: Math.max(...shadowLines.map(x => x.end)) }
const originalText = lines === null ? ''
  : tIdx.text.split('\n').slice(lines.start - 1, lines.end).join('\n')
```

- [ ] **Step 4: Run the test, confirm it passes**

- [ ] **Step 5: Commit** `git add better-dsh/src/url-schemes/handlers/ctx.ts better-dsh/test/url-schemes/ctx.spec.ts && git commit -m "feat(ctx): transcript line index + per-episode line coordinates (N1)"`

---

## Task 2: Transcript-relative episode windows + boundary note

**Files:** `ctx.ts`, `ctx.spec.ts`

**Interfaces:** Produces `applyEpisodeLines(slice: string, lineStart: number, lineEnd: number, ranges: Array<[number,number]>): string`.

- [ ] **Step 1: Add failing tests**

```ts
it('episode line window is transcript-relative (≡ transcript window)', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const ep0 = JSON.parse(await r.resolve({} as ResolverEnv, 'ctx://session', null)).compacted[0]
  const viaEpisode = await r.resolve({} as ResolverEnv, `ctx://session/compactions[${ep0.label}]:${ep0.lines.start}-${ep0.lines.end}`, null)
  const viaTranscript = await r.resolve({} as ResolverEnv, `ctx://session/transcript:${ep0.lines.start}-${ep0.lines.end}`, null)
  expect(viaEpisode).toBe(viaTranscript)
})

it('out-of-span episode window returns an explicit boundary note', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const ep0 = JSON.parse(await r.resolve({} as ResolverEnv, 'ctx://session', null)).compacted[0]
  const out = await r.resolve({} as ResolverEnv, `ctx://session/compactions[${ep0.label}]:${ep0.lines.end + 1000}`, null)
  expect(out).toMatch(/end of episode span|span is transcript lines/)
})
```

- [ ] **Step 2: Run, confirm both fail**

- [ ] **Step 3: Implement transcript-relative episode line application**

```ts
function applyEpisodeLines(slice: string, lineStart: number, lineEnd: number, ranges: Array<[number, number]>): string {
  const lines = slice.split('\n')
  const out: string[] = []
  let noted = false
  for (const [aRaw, bRaw] of ranges) {
    const a = Math.max(1, aRaw); const b = bRaw === Infinity ? lineEnd : bRaw
    if (b < lineStart || a > lineEnd) { noted = true; continue }
    const la = Math.max(a, lineStart) - lineStart + 1
    const lb = Math.min(b, lineEnd) - lineStart + 1
    out.push(...lines.slice(la - 1, lb))
    if (bRaw === Infinity ? false : b > lineEnd || a < lineStart) noted = true
  }
  const body = out.join('\n')
  const note = noted ? `\n\n[ctx:// note: episode span is transcript lines ${lineStart}-${lineEnd}]` : ''
  return body + note
}
```

In the episode branch, when the episode has `lines !== null`, route `sel.kind === 'lines'` through `applyEpisodeLines(episode.originalText, episode.lines.start, episode.lines.end, sel.ranges)` instead of the shared `applyLines`.

- [ ] **Step 4: Run, confirm both pass (the first test also proves the episode-span ≡ transcript-slice invariant)**

- [ ] **Step 5: Commit** `git commit -am "feat(ctx): transcript-relative episode windows + explicit span bounds (N1/F10)"`

---

## Task 3: Digest residence rule

**Files:** `ctx.ts`, `ctx.spec.ts`

**Interfaces:** Produces `episodeNavigation(episode, isLatest, checkpointLines) => string` (latest → navigation block, older → digest + pointer block).

- [ ] **Step 1: Add failing tests**

```ts
it('latest episode prepared face is a navigation block without the digest text', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const latest = await r.resolve({} as ResolverEnv, 'ctx://session/compactions[40]', null)  // label 40 is last
  expect(latest).toMatch(/digest is already in your live context/)
  expect(latest).toMatch(/digest resident .*seq=41/)
  expect(latest).not.toMatch(/second round/)  // the digest body must NOT be dumped
})

it('older episode prepared face returns its full digest', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const older = await r.resolve({} as ResolverEnv, 'ctx://session/compactions[20]', null)
  expect(older).toMatch(/do the thing/)       // digest body present
  expect(older).toMatch(/lines=\d+\.\.\d+/)
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement** the checkpoint-line lookup (the `user/message` whose `source.plugin === 'compact'` at `checkpointSeq`, via `tIdx.lineOfSeq`, fallback `undefined`) and the two branches. Latest block shape (no digest): see design §4 (N2). Older: `episode.summaryText` + the pointer block. `:raw`/`:N-M` unchanged (span).

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit** `git commit -am "feat(ctx): digest residence rule — latest is a pointer, older dumps digest (N2)"`

---

## Task 4: Landmark roster + fidelity

**Files:** `ctx.ts`, `ctx.spec.ts`

**Interfaces:** Produces `landmarksOf(episodeEvents, tIdx): string` and `fidelityOf(episodeEvents): { userTurns; toolCalls }`.

- [ ] **Step 1: Add failing tests**

```ts
it('landmark block lists user-turn and failure lines and touched paths', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const out = await r.resolve({} as ResolverEnv, 'ctx://session/compactions[20]', null)
  expect(out).toMatch(/user turns \(\d+\): \d+/)
  expect(out).toMatch(/touched paths:/)
})

it('manifest and snapshot carry fidelity', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  expect(await r.resolve({} as ResolverEnv, 'ctx://session/compactions', null)).toMatch(/fidelity=\d+:\d+/)
  const snap = JSON.parse(await r.resolve({} as ResolverEnv, 'ctx://session', null))
  expect(snap.compacted[0].fidelity).toEqual(expect.objectContaining({ userTurns: expect.any(Number), toolCalls: expect.any(Number) }))
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement** `landmarksOf` (user turns = `user/message` with `source.kind==='user'` → `tIdx.lineOfSeq` line; failures = `tool/result` with `data.message.isError===true` or `data.error` present → line + tool name; touched paths = path-valued strings from `tool/call` args keys `path`/`file_path`/`filePath`/`file` + `edits[].path` + `files[].path`, args > 64 000 chars skipped; prior checkpoints = count of `user/message` with `source.plugin==='compact'`). Caps: 30 / 20 / 12. `fidelityOf` = counts of user turns and `tool/call` events. Wire into the episode block (Task 3), the manifest line, and the snapshot `compacted[]`.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit** `git commit -am "feat(ctx): landmark roster + fidelity signal (N3/N4)"`

---

## Task 5: `:path/` + `?q=` selectors + error echo

**Files:** `ctx.ts`, `ctx.spec.ts`

**Interfaces:** Consumes `applySelector(text, sel)` from `../../src/url-schemes/selector.ts` (already exported).

- [ ] **Step 1: Add failing tests**

```ts
it('supports :path/ on the snapshot JSON and ?q= on an index face', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const n = await r.resolve({} as ResolverEnv, 'ctx://session:path/totals.tool_calls', null)
  expect(n).toMatch(/^\d+$/)
  const q = await r.resolve({} as ResolverEnv, 'ctx://session/injections?q=agent-instructions', null)
  expect(q).toMatch(/AGENTS\.md/)
})

```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement** — in `applyFace`, before the `lines` branch:

```ts
if (selector.kind === 'path' || selector.kind === 'query') {
  return applySelector(face === 'canonical' ? canonical : prepared, selector)
}
```

Import `applySelector` from `../selector.ts` (add to the existing `import { UrlSchemesError }` line). Replace the manifest special-case rejection with `return applySelector(body, sel)` so `?q=`/`:N-M`/`:path/` all work there too. Keep the now-unreachable `CTX_BAD_SELECTOR` throw but give it a support-set message (`:raw`, `:N-M`, `:path/`, `?q=`) for future kinds.

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit** `git commit -am "feat(ctx): :path/ and ?q= selectors (N5/F5/F8)"`

---

## Task 6: `asOf`, F1 index faces, F2 result shape

**Files:** `ctx.ts`, `ctx.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
it('snapshot carries asOf', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const snap = JSON.parse(await r.resolve({} as ResolverEnv, 'ctx://session', null))
  expect(snap.asOf).toEqual(expect.objectContaining({ seq: expect.any(Number), line: expect.any(Number) }))
})

it('bare element collections return index faces, not an empty-bracket error', async () => {
  const closed = { value: false }
  const r = ctxResolver(closed)
  const idx = await r.resolve({} as ResolverEnv, 'ctx://session/user_prompts', null)
  expect(idx).toMatch(/seq=\d+/)
  expect(idx).toMatch(/hello world/)
})

it('flat tool-result content renders (F2)', async () => {
  const closed = { value: false }
  const flat: PersistenceEvent[] = [
    { seq: 5, type: 'tool/call', time: T, data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo hi"}' } },
    { seq: 6, type: 'tool/result', time: T, sourceEventSeqs: [5], data: { message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'hi' }] } } },
  ]
  const r = ctxResolver(closed, flat)
  expect(await r.resolve({} as ResolverEnv, 'ctx://session/tool_calls[5]', null)).toMatch(/result: hi/)
})
```

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement**
  - `asOf`: add `asOf: { seq: <max seq>, line: tIdx.totalLines }` to `buildSnapshot`.
  - F1: give `user_prompts`/`tool_calls`/`agent_responses` a bare index face (per-element `seq=<s> <preview>`), capping `tool_calls`/`agent_responses` at 20 lines with a `… +N more` tail; `[n|seq]` and `:raw` unchanged. Update the element error to name the collection + count (no `ctx://…[]`).
  - F2: `resultTextOf` returns `nested !== '' ? nested : textOf(blocks)` (flat fallback; see design §3.3).

- [ ] **Step 4: Run full suite** `npx vitest run` and `npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit** `git commit -am "feat(ctx): asOf, element index faces, flat tool-result rendering (N6/F1/F2)"`

---

## Task 7: Docs, rig verification, report

**Files:** `docs/specs/ctx/spec.md` (already updated), `better-dsh/dashr/url-schemes-instruction.md` (model-facing instruction, if it lists selectors — verify and add `:path/`/`?q=`/transcript-relative note), `docs/50_test-reports/2026-10-02-ctx-navigation实测报告.md`.

- [ ] **Step 1:** Grep `better-dsh/` for the model-facing `url-schemes` instruction doc and update the ctx selector list if present.

- [ ] **Step 2:** Rebuild + sync: `cd better-dsh && npm run build && cd .. && rsync -a --delete better-dsh/lib/ .test/home/compat/profiles/web/node_modules/better-dsh/lib/` and restart `bash .test/seed/test123/start.sh`.

- [ ] **Step 3:** First-person verify on 4999 via `dvc://browser` and a `headless` rigcheck session: snapshot has `asOf` + labeled `lines`; a deep episode windows by transcript line; `?q=` filters an index; `:path/` narrow-reads; a tool result is non-empty.

- [ ] **Step 4:** Write the test report to `docs/50_test-reports/2026-10-02-ctx-navigation实测报告.md` (findings, probes, verdict).

- [ ] **Step 5: Commit** `git commit -am "docs(ctx): navigation change — instruction + first-person test report"`
