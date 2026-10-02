/**
 * `ctx://` scheme handler — the recallable-context surface over the live
 * session's event log (change 2026-09-11-url-schemes-recallable-context).
 *
 * This handler is SELECTOR-AWARE (`selectorAware: true`): it serves both
 * content faces itself and the resolver skips the uniform selector pass.
 *
 * Content faces (canonical / prepared model — mapping doc §15.10):
 *   - canonical  = the full underlying content; `:raw` returns it and line
 *     windows (`:N-M`) always index it.
 *   - prepared   = an alternative face prepared at the resource entry; the
 *     bare URL returns it when one exists.
 *
 * URL shapes:
 *   - `ctx://`                                 → roster (no agent needed).
 *   - `ctx://session`                          → statistics snapshot (prepared);
 *                                                `:raw` / `:N-M` → full transcript.
 *   - `ctx://session/transcript`               → full transcript (canonical).
 *   - `ctx://session/compactions`              → compaction manifest.
 *   - `ctx://session/compactions[<label|n>]`   → that episode's 8-section
 *                                                summary (prepared); `:raw` /
 *                                                `:raw:N-M` → its shadowed span.
 *   - `ctx://session/user_prompts[<n|seq>]`    → the n-th real user prompt
 *                                                (0-based; `[seq]` also works).
 *   - `ctx://session/tool_calls[<n|seq>]`      → name + arguments + result.
 *   - `ctx://session/agent_responses[<n|seq>]` → the n-th assistant message.
 *   - `ctx://session/thinking[<n|seq>]`        → the n-th reasoning block
 *                                                (bare = index; `:raw`/`:N-M` =
 *                                                all blocks joined).
 *   - `ctx://session/system[<n|seq>]`          → the n-th system message
 *                                                (bare = index; `:raw`/`:N-M` =
 *                                                all messages joined).
 *
 * Composite selector: `:raw:<lines>` is valid everywhere and identical to
 * `:<lines>` (the `:raw` prefix is redundant in a line-window context but
 * must parse). The former `/original` sub-path is REMOVED — it was identical
 * to `:raw`; a path using it returns the standard `CTX_BAD_PATH` error.
 *
 * Label semantics: the element's immutable seq coordinate (compaction
 * episodes → `compaction/summary` event seq; messages → their own event
 * seq). Exact label match first, 0-based ordinal fallback. Failed
 * compactions never emit a summary event and are therefore never
 * addressable. Nested chains surface via `replaces_checkpoint`.
 *
 * Events come from the injected `sessionPersistence` service
 * (`open(id,'read')` → `handle.read()` — the official public path into the
 * zstd-framed session log; no private session access, no local decompression).
 */

import type { SchemeHandler, HandlerSelector, ResolverEnv } from '../resolver.ts'
import { UrlSchemesError, applySelector } from '../selector.ts'

// ── duck-typed persistence (version-drift-proof, mirrors the CtxAgent style) ──

export interface PersistenceEvent {
  readonly seq?: number
  readonly type?: string
  readonly time?: number
  readonly data?: Record<string, unknown>
  /** Surface-bearing events carry the seqs they derive from (tool/result → tool/call). */
  readonly sourceEventSeqs?: readonly number[]
}

interface PersistenceDuck {
  open(id: string, access: 'read'): Promise<{
    read(o?: { signal?: AbortSignal }): Promise<{ events: readonly PersistenceEvent[] }>
    close(): Promise<void>
  }>
}

/** The `env` subset this handler reads: the live agent, when there is one. */
export interface CtxEnv extends ResolverEnv {
  readonly agent?: CtxAgent
}

export interface CtxAgent {
  readonly id: string
  readonly status: string
  readonly options: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }
  readonly session: {
    readonly header: {
      readonly id?: string
      readonly createdAt?: number
      readonly cwd?: string
      readonly origin?: string
      readonly delegationDepth?: number
      readonly agentPreset?: string
    }
  }
}

export interface CtxHandlerDeps {
  /** Host session-persistence service (zstd-transparent log access). */
  readonly sessionPersistence: unknown
}

// ── event-level extraction ──

interface ContentBlock {
  readonly type?: string
  readonly text?: string
  readonly name?: string
  readonly arguments?: string
}

function blocksOf(event: PersistenceEvent): ContentBlock[] {
  const message = (event.data as { message?: { content?: ContentBlock[] } } | undefined)?.message
  const content = (event.data as { content?: ContentBlock[] } | undefined)?.content
  return message?.content ?? content ?? []
}

function textOf(blocks: ContentBlock[]): string {
  return blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

function sourceKind(event: PersistenceEvent): string {
  return (event.data as { source?: { kind?: string } } | undefined)?.source?.kind ?? ''
}

function sourcePlugin(event: PersistenceEvent): string {
  return (event.data as { source?: { plugin?: string } } | undefined)?.source?.plugin ?? ''
}

function resultTextOf(event: PersistenceEvent): string {
  const blocks = blocksOf(event)
  // The current session format stores flat text blocks on the tool-result
  // message; older persisted forms nest them under a 'tool-result' block.
  const nested = blocks
    .flatMap(b => (b as { content?: ContentBlock[] }).content ?? [])
    .map(c => c.text ?? '')
    .join('\n')
  return nested !== '' ? nested : textOf(blocks)
}
/** One reasoning block extracted from an `assistant/message` event. */
export interface ThinkingItem {
  seq: number
  turn: number | undefined
  step: number | undefined
  text: string
}

/** All reasoning blocks in event order (one message may carry several). */
function thinkingItems(events: readonly PersistenceEvent[]): ThinkingItem[] {
  const out: ThinkingItem[] = []
  for (const e of events) {
    if (e.type !== 'assistant/message') continue
    const turnStep = e.data as { turn?: number; step?: number } | undefined
    for (const b of blocksOf(e)) {
      if (b.type !== 'reasoning') continue
      out.push({ seq: e.seq as number, turn: turnStep?.turn, step: turnStep?.step, text: b.text ?? '' })
    }
  }
  return out
}

/** A system message: `data.text` when present, else the message content blocks. */
function systemTextOf(event: PersistenceEvent): string {
  const d = event.data as { text?: string; message?: { content?: ContentBlock[] }; content?: ContentBlock[] } | undefined
  if (typeof d?.text === 'string') return d.text
  return textOf(d?.message?.content ?? d?.content ?? [])
}

/** One `system/message` event flattened for addressing. */
export interface SystemItem {
  seq: number
  /** `kind/plugin` when the event carries `data.source`, else `-`. */
  source: string
  text: string
}

/** All `system/message` events in log order. */
function systemItems(events: readonly PersistenceEvent[]): SystemItem[] {
  return events
    .filter(e => e.type === 'system/message')
    .map(e => {
      const source = [sourceKind(e), sourcePlugin(e)].filter(p => p !== '').join('/')
      return { seq: e.seq as number, source: source === '' ? '-' : source, text: systemTextOf(e) }
    })
}

/** One injected `user/message` — any non-`user` source (agent instructions, runtime snapshots, …). */
export interface InjectionItem {
  seq: number
  source: string
  text: string
}

/** All injected `user/message` events in log order (the complement of `user_prompts`). */
function injectionItems(events: readonly PersistenceEvent[]): InjectionItem[] {
  return events
    .filter(e => e.type === 'user/message' && sourceKind(e) !== 'user')
    .map(e => {
      const kind = sourceKind(e) || 'unknown'
      return {
        seq: e.seq as number,
        source: kind,
        text: `[${String(e.seq).padStart(7, '0')}] INJECTED ${kind}\n${textOf(blocksOf(e))}`,
      }
    })
}

/** ~100-char single-line preview with an ellipsis when truncated. */
function previewOf(text: string, n = 100): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

// ── transcript rendering (format v1 — frozen; line-number stability contract) ──

function renderEntry(event: PersistenceEvent, toolNameOf: (seq: number | undefined) => string | undefined): string {
  const seq = String(event.seq ?? 0).padStart(7, '0')
  if (event.type === 'user/message') {
    if (sourcePlugin(event) === 'compact') return `[${seq}] CHECKPOINT\n${textOf(blocksOf(event))}`
    if (sourceKind(event) === 'user') return `[${seq}] USER\n${textOf(blocksOf(event))}`
    return `[${seq}] USER-INJECTED (${sourcePlugin(event) || sourceKind(event)})\n${textOf(blocksOf(event))}`
  }
  if (event.type === 'assistant/message') {
    const blocks = blocksOf(event)
    const text = textOf(blocks)
    const calls = blocks.filter(b => b.type === 'tool-call')
    const parts: string[] = []
    if (text !== '') parts.push(`[${seq}] ASSISTANT\n${text}`)
    for (const call of calls) parts.push(`[${seq}] TOOL-CALL ${call.name ?? '?'}\n${call.arguments ?? ''}`)
    return parts.length > 0 ? parts.join('\n\n') : `[${seq}] ASSISTANT (no content)`
  }
  if (event.type === 'tool/result') {
    const callSeq = (event.sourceEventSeqs as number[] | undefined)?.[0]
    const name = toolNameOf(callSeq) ?? 'unknown-tool'
    return `[${seq}] TOOL ${name}\n${resultTextOf(event)}`
  }
  return ''
}

function sectionPreviews(text: string, n = 100): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(/^## /m).slice(1)) {
    const head = part.slice(0, part.indexOf('\n')).trim()
    const body = part.slice(part.indexOf('\n') + 1)
    out[head] = body.replace(/\s+/g, ' ').trim().slice(0, n)
  }
  return out
}

// ── selector application (canonical vs prepared) ──

function applyLines(canonical: string, ranges: Array<[number, number]>): string {
  const lines = canonical.split('\n')
  const total = lines.length
  const out: string[] = []
  let noted = false
  for (const [aRaw, bRaw] of ranges) {
    const a = Math.max(1, aRaw)
    const b = bRaw === Infinity ? total : bRaw
    if (b < 1 || a > total) { noted = true; continue }
    out.push(...lines.slice(a - 1, Math.min(b, total)))
    if (bRaw !== Infinity && b > total) noted = true
  }
  const body = out.join('\n')
  if (!noted) return body
  const note = `[ctx:// note: canonical content ends at line ${total}]`
  return body === '' ? note : `${body}\n\n${note}`
}

function applyFace(
  prepared: string,
  canonical: string,
  selector: HandlerSelector | undefined,
  face: 'prepared' | 'canonical' = 'prepared',
): string {
  if (selector === undefined || selector === null) return face === 'canonical' ? canonical : prepared
  if (selector.kind === 'raw') return canonical
  if (selector.kind === 'lines') return applyLines(canonical, selector.ranges)
  if (selector.kind === 'path' || selector.kind === 'query') {
    return applySelector(face === 'canonical' ? canonical : prepared, selector)
  }
  throw new UrlSchemesError('CTX_BAD_SELECTOR', `ctx://: unsupported selector kind "${(selector as { kind: string }).kind}" (supported: :raw, :N-M, :path/, ?q=)`)
}

/** Transcript line index — the single source of truth for line coordinates. */
interface TranscriptIndex {
  text: string
  totalLines: number
  lineOfSeq: Map<number, { start: number; end: number }>
}

function buildTranscript(events: readonly PersistenceEvent[], toolNameOf: (seq: number | undefined) => string | undefined): TranscriptIndex {
  const entries = events
    .map(e => ({ seq: e.seq as number, text: renderEntry(e, toolNameOf) }))
    .filter(t => t.text !== '')
  const lineOfSeq = new Map<number, { start: number; end: number }>()
  let line = 1
  entries.forEach((entry, i) => {
    const n = entry.text.split('\n').length
    lineOfSeq.set(entry.seq, { start: line, end: line + n - 1 })
    line += n + (i < entries.length - 1 ? 1 : 0)
  })
  return { text: entries.map(e => e.text).join('\n\n'), totalLines: line - 1, lineOfSeq }
}

/** Apply transcript-relative line ranges to one episode span slice, with a boundary note. */
function applyEpisodeLines(slice: string, lineStart: number, lineEnd: number, ranges: Array<[number, number]>): string {
  const lines = slice.split('\n')
  const out: string[] = []
  let noted = false
  for (const [aRaw, bRaw] of ranges) {
    const a = Math.max(1, aRaw)
    const b = bRaw === Infinity ? lineEnd : bRaw
    if (b < lineStart || a > lineEnd) { noted = true; continue }
    const la = Math.max(a, lineStart) - lineStart + 1
    const lb = Math.min(b, lineEnd) - lineStart + 1
    out.push(...lines.slice(la - 1, lb))
    if (b > lineEnd || a < lineStart) noted = true
  }
  const body = out.join('\n')
  const note = noted ? `\n\n[ctx:// note: episode span is transcript lines ${lineStart}-${lineEnd}]` : ''
  return body + note
}

/** One compaction episode plus the derived navigation metadata. */
interface Episode {
  label: number
  checkpointSeq: number
  compactionId: string
  at: number | undefined
  shadowedRange: { start: number; end: number }
  shadowedSeqs: readonly number[]
  shadowedTokenCount: number
  replacesCheckpoint: number | null
  summaryText: string
  originalText: string
  lines: { start: number; end: number } | null
  fidelity: { userTurns: number; toolCalls: number }
  shadowEvents: readonly PersistenceEvent[]
}

function isErrorOf(event: PersistenceEvent): boolean {
  return (event.data as { message?: { isError?: boolean } } | undefined)?.message?.isError === true
    || (event.data as { error?: unknown } | undefined)?.error !== undefined
}

const PATH_KEYS = new Set(['path', 'file_path', 'filePath', 'file'])

function collectPaths(node: unknown, out: Set<string>, depth: number): void {
  if (depth > 4 || node === null || node === undefined) return
  if (typeof node === 'string') return
  if (Array.isArray(node)) { for (const x of node) collectPaths(x, out, depth + 1); return }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (PATH_KEYS.has(k) && typeof v === 'string' && v !== '') out.add(v)
      else collectPaths(v, out, depth + 1)
    }
  }
}

function touchedPathsOf(events: readonly PersistenceEvent[]): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    const args = (e.data as { arguments?: string } | undefined)?.arguments
    if (args === undefined || args.length > 64_000) continue
    let parsed: unknown
    try { parsed = JSON.parse(args) } catch { continue }
    const found = new Set<string>()
    collectPaths(parsed, found, 0)
    for (const p of found) counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function landmarkBlock(ep: Episode, tIdx: TranscriptIndex, toolNameOf: (seq: number | undefined) => string | undefined): string {
  const lineOf = (e: PersistenceEvent) => tIdx.lineOfSeq.get(e.seq as number)?.start
  const userTurns = ep.shadowEvents
    .filter(e => e.type === 'user/message' && sourceKind(e) === 'user')
    .map(lineOf).filter((x): x is number => x !== undefined)
  const failures = ep.shadowEvents
    .filter(e => e.type === 'tool/result' && isErrorOf(e))
    .map(e => `${lineOf(e) ?? '?'} ${toolNameOf((e.sourceEventSeqs as number[] | undefined)?.[0]) ?? 'tool'}`)
  const paths = touchedPathsOf(ep.shadowEvents).slice(0, 12).map(([p, n]) => `${p}×${n}`)
  const priorCheckpoints = ep.shadowEvents.filter(e => e.type === 'user/message' && sourcePlugin(e) === 'compact').length
  const cap = (xs: Array<number | string>, n: number) => xs.length > n ? `${xs.slice(0, n).join(', ')} … +${xs.length - n} more` : xs.join(', ')
  return [
    `user turns (${userTurns.length}): ${cap(userTurns, 30)}`,
    `failures (${failures.length}): ${cap(failures, 20)}`,
    `touched paths: ${paths.length > 0 ? paths.join(', ') : '(none)'}`,
    `prior checkpoints in span: ${priorCheckpoints}`,
  ].join('\n')
}

function episodePrepared(ep: Episode, list: readonly Episode[], tIdx: TranscriptIndex, toolNameOf: (seq: number | undefined) => string | undefined): string {
  const isLatest = list.length > 0 && list[list.length - 1] === ep
  const ls = ep.lines === null ? '<none>' : `${ep.lines.start}..${ep.lines.end}`
  const pointer = [
    `[ctx://session/compactions[${ep.label}]${isLatest ? ' — digest is already in your live context' : ''}]`,
    `lines=${ls}  seq=${ep.shadowedRange.start}..${ep.shadowedRange.end}  items=${ep.shadowedSeqs.length}  tokens=${ep.shadowedTokenCount}`,
    `fidelity=${ep.fidelity.userTurns}:${ep.fidelity.toolCalls}`,
  ]
  if (isLatest) {
    const ck = tIdx.lineOfSeq.get(ep.checkpointSeq)
    pointer.push(`digest resident at seq=${ep.checkpointSeq}${ck !== undefined ? ` (transcript:${ck.start}-${ck.end})` : ''} — read it there, or use :raw here for the shadowed span`)
  } else if (ep.replacesCheckpoint !== null) {
    pointer.push(`replaces_checkpoint=${ep.replacesCheckpoint}`)
  }
  pointer.push(landmarkBlock(ep, tIdx, toolNameOf))
  const block = pointer.join('\n')
  return isLatest ? block : `${ep.summaryText}\n\n${block}`
}

// ── the handler ──

export function createCtxHandler(deps: CtxHandlerDeps): SchemeHandler {
  const persistence = deps.sessionPersistence as PersistenceDuck | undefined

  async function loadEvents(agent: CtxAgent): Promise<readonly PersistenceEvent[]> {
    if (persistence === undefined) {
      throw new UrlSchemesError(
        'CTX_NO_PERSISTENCE',
        'ctx:// recall requires the host session-persistence service (not mounted in this composition)',
      )
    }
    const handle = await persistence.open(agent.id, 'read')
    try {
      const result = await handle.read()
      return result.events ?? []
    } finally {
      await handle.close().catch(() => {})
    }
  }

  return {
    selectorAware: true,
    async resolve(env: ResolverEnv, path: string, selector?: HandlerSelector): Promise<string> {
      const sel = selector ?? null
      const raw = path.replace(/^\/+/, '').trim()
      if (raw === '') {
        return [
          'ctx://session                          statistics snapshot of this session (:raw = full transcript)',
          'ctx://session/transcript               full session transcript (line windows via :N-M)',
          'ctx://session/compactions              compaction manifest (labels, nested chain, previews)',
          'ctx://session/compactions[<label|n>]   one episode\'s summary (:raw[:N-M] = its original span)',
          'ctx://session/user_prompts[<n|seq>]    the n-th real user prompt (0-based)',
          'ctx://session/tool_calls[<n|seq>]      the n-th tool call (name + arguments + result)',
          'ctx://session/agent_responses[<n|seq>] the n-th assistant response',
          'ctx://session/thinking[<n|seq>]        the n-th reasoning block (:raw = all blocks joined)',
          'ctx://session/system[<n|seq>]          the n-th system message (:raw = all messages)',
          'ctx://session/injections[<n|seq>]      the n-th injected user message (:raw = all joined)',
        ].join('\n')
      }

      const { agent } = env as CtxEnv
      if (agent === undefined) {
        throw new UrlSchemesError(
          'CTX_NO_AGENT',
          'ctx:// requires a live agent in the resolver env (this context has none)',
        )
      }

      const key = raw.split('/')[0]!
      if (key !== 'session') {
        throw new UrlSchemesError(
          'CTX_UNKNOWN_KEY',
          `ctx://${raw}: unknown key (known: session — model/cwd folded into the session info card; bare ctx:// lists the full roster)`,
        )
      }

      const events = await loadEvents(agent)
      const toolCallEvents = events.filter(e => e.type === 'tool/call')
      const toolNameByCallSeq = new Map<number, string>(
        toolCallEvents.map(e => [e.seq as number, (e.data as { name?: string }).name ?? '?']),
      )
      const toolNameOf = (seq: number | undefined) => (seq === undefined ? undefined : toolNameByCallSeq.get(seq))
      const userPromptEvents = events.filter(e => e.type === 'user/message' && sourceKind(e) === 'user')
      const agentResponseEvents = events.filter(e => e.type === 'assistant/message')
      const tIdx = buildTranscript(events, toolNameOf)

      // ── compaction episodes (nested chain included) ──
      const episodes: Episode[] = []
      {
        let prevCheckpoint: number | null = null
        for (const e of events) {
          if (e.type !== 'compaction/summary') continue
          const d = e.data as {
            compactionId: string
            shadowedRange: { start: number; end: number }
            shadowedSeqs: number[]
            shadowedTokenCount: number
            summary: Array<{ text: string }>
          }
          const shadowSet = new Set(d.shadowedSeqs)
          const shadowEvents = events.filter(ev => shadowSet.has(ev.seq as number))
          const shadowLines = d.shadowedSeqs
            .map(seq => tIdx.lineOfSeq.get(seq))
            .filter((x): x is { start: number; end: number } => x !== undefined)
          const lines = shadowLines.length === 0 ? null
            : { start: Math.min(...shadowLines.map(x => x.start)), end: Math.max(...shadowLines.map(x => x.end)) }
          const originalText = lines === null
            ? ''
            : tIdx.text.split('\n').slice(lines.start - 1, lines.end).join('\n')
          const fidelity = {
            userTurns: shadowEvents.filter(ev => ev.type === 'user/message' && sourceKind(ev) === 'user').length,
            toolCalls: shadowEvents.filter(ev => ev.type === 'tool/call').length,
          }
          episodes.push({
            label: e.seq as number,
            checkpointSeq: (e.seq as number) + 1,
            compactionId: d.compactionId,
            at: e.time,
            shadowedRange: d.shadowedRange,
            shadowedSeqs: d.shadowedSeqs,
            shadowedTokenCount: d.shadowedTokenCount,
            replacesCheckpoint: prevCheckpoint !== null && d.shadowedSeqs.includes(prevCheckpoint) ? prevCheckpoint : null,
            summaryText: d.summary.map(s => s.text).join(''),
            originalText,
            lines,
            fidelity,
            shadowEvents,
          })
          prevCheckpoint = (e.seq as number) + 1
        }
      }

      // ── path parsing: session[/seg[[bracket]]…] ──
      const sub = raw.slice('session'.length).replace(/^\/+/, '')
      const segments = sub === '' ? [] : sub.split('/').filter(x => x !== '')
      const parseSeg = (seg: string): { name: string; bracket?: string } => {
        const m = /^([a-z_]+)(?:\[(.+)\])?$/.exec(seg)
        if (m === null) throw new UrlSchemesError('CTX_BAD_PATH', `ctx://${raw}: unparseable segment "${seg}"`)
        return { name: m[1]!, bracket: m[2] }
      }
      const seg0 = segments[0] === undefined ? undefined : parseSeg(segments[0]!)
      const seg1 = segments[1] === undefined ? undefined : parseSeg(segments[1]!)

      // ── session root: prepared snapshot / canonical transcript ──
      if (seg0 === undefined || seg0.name === 'transcript') {
        const forceCanonical = seg0?.name === 'transcript'
        const canonical = tIdx.text
        const prepared = buildSnapshot(agent, events, episodes, tIdx)
        return applyFace(prepared, canonical, sel, seg0?.name === 'transcript' ? 'canonical' : 'prepared')
      }

      // ── compactions: manifest / episode summary / shadowed span via selectors ──
      if (seg0.name === 'compactions') {
        if (seg0.bracket === undefined) {
            const body = episodes
              .map(e => [
                `label=${e.label} (checkpoint_seq=${e.checkpointSeq})`,
                `compactionId=${e.compactionId}`,
                `at=${new Date(e.at ?? 0).toISOString()}`,
                `seq=${e.shadowedRange.start}..${e.shadowedRange.end} (${e.shadowedSeqs.length} items, ${e.shadowedTokenCount} tokens)`,
                `lines=${e.lines === null ? '<none>' : `${e.lines.start}..${e.lines.end}`}`,
                `fidelity=${e.fidelity.userTurns}:${e.fidelity.toolCalls}`,
                `replaces_checkpoint=${e.replacesCheckpoint ?? 'null'}`,
                `preview=${e.summaryText.slice(0, 120)}…`,
              ].join(' | '))
              .join('\n')
            const text = body === '' ? '(no compactions recorded)' : body
            if (sel === null || sel.kind === 'raw') return text
            if (sel.kind === 'lines') return applyLines(text, sel.ranges)
            return applySelector(text, sel)
        }
        const episode = pickEpisode(episodes, seg0.bracket)
        if (seg1 === undefined) {
          // prepared face = digest / navigation block; canonical = shadowed span.
          // A plain `:raw` is the one shape that can dump a huge span in one read.
          if (sel !== null && sel.kind === 'raw' && episode.originalText.length > 65536) {
            return episode.originalText
              + `\n\n[ctx:// note: original span is ${episode.originalText.length} chars — page with :N-M line windows or grep this URL]`
          }
          if (sel !== null && sel.kind === 'lines' && episode.lines !== null) {
            return applyEpisodeLines(episode.originalText, episode.lines.start, episode.lines.end, sel.ranges)
          }
          const prepared = episodePrepared(episode, episodes, tIdx, toolNameOf)
          return applyFace(prepared, episode.originalText, sel, 'prepared')
        }
        throw new UrlSchemesError(
          'CTX_BAD_PATH',
          `ctx://${raw}: unknown sub-path "/${seg1.name}" ("/original" was superseded by the :raw / :raw:N-M selectors)`,
        )
      }

      // ── index-faced collections: thinking blocks & system messages ──
      // bare = prepared index list; `[n|seq]` = one item's full text;
      // `:raw` / `:N-M` = canonical face (all items' full text joined with a
      // blank line between items, windows indexing that canonical text).
      if (seg0.name === 'thinking' || seg0.name === 'system' || seg0.name === 'injections') {
        const items: Array<{ seq: number; turn?: number; step?: number; source?: string; text: string }>
          = seg0.name === 'thinking' ? thinkingItems(events)
          : seg0.name === 'system' ? systemItems(events)
          : injectionItems(events)
        if (seg0.bracket === undefined) {
          const index = items
            .map((it, i) => (seg0.name === 'thinking'
              ? `[${i}] seq=${it.seq} turn=${it.turn ?? '-'} step=${it.step ?? '-'} ${previewOf(it.text)}`
              : `seq=${it.seq} source=${it.source ?? '-'} ${previewOf(it.text)}`))
            .join('\n')
          return applyFace(
            index === '' ? `(no ${seg0.name} items recorded)` : index,
            items.map(it => it.text).join('\n\n'),
            sel,
            'prepared',
          )
        }
        const bySeq = items.find(it => it.seq === Number(seg0.bracket))
        if (bySeq !== undefined) return applyFace(bySeq.text, bySeq.text, sel, 'prepared')
        const ordinal = Number(seg0.bracket)
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= items.length) {
          throw new UrlSchemesError(
            'CTX_NO_SUCH_ELEMENT',
            `ctx://…[${seg0.bracket}]: no such element (collection "${seg0.name}" has ${items.length} items, 0-based; labels are event seqs)`,
          )
        }
        return applyFace(items[ordinal]!.text, items[ordinal]!.text, sel, 'prepared')
      }

      // ── element collections ──
      const collection = (name: string): Array<{ seq: number; text: string }> => {
        if (name === 'user_prompts') {
          return userPromptEvents.map(e => ({ seq: e.seq as number, text: `[${String(e.seq).padStart(7, '0')}] USER\n${textOf(blocksOf(e))}` }))
        }
        if (name === 'tool_calls') {
          const resultByCallSeq = new Map<number, string>()
          for (const e of events) {
            if (e.type !== 'tool/result') continue
            const callSeq = (e.sourceEventSeqs as number[] | undefined)?.[0]
            if (callSeq !== undefined) resultByCallSeq.set(callSeq, resultTextOf(e))
          }
          return toolCallEvents.map(e => ({
            seq: e.seq as number,
            text: `[${String(e.seq).padStart(7, '0')}] TOOL ${(e.data as { name?: string }).name ?? '?'}\narguments: ${(e.data as { arguments?: string }).arguments ?? ''}\nresult: ${resultByCallSeq.get(e.seq as number) ?? '(no result captured)'}`,
          }))
        }
        if (name === 'agent_responses') {
          return agentResponseEvents.map(e => ({ seq: e.seq as number, text: `[${String(e.seq).padStart(7, '0')}] ASSISTANT\n${textOf(blocksOf(e)) || '(tool-call only)'}` }))
        }
        throw new UrlSchemesError('CTX_BAD_PATH', `ctx://${raw}: unknown collection "${name}"`)
      }

      if (seg0.name === 'user_prompts' || seg0.name === 'tool_calls' || seg0.name === 'agent_responses') {
        const items = collection(seg0.name)
        const canonical = items.map(it => it.text).join('\n\n')
        if (seg0.bracket === undefined) {
          const bounded = seg0.name !== 'user_prompts'
          const shown = bounded ? items.slice(0, 20) : items
          const index = shown.map(it => `seq=${it.seq} ${previewOf(it.text)}`).join('\n')
          const tail = bounded && items.length > 20
            ? `\n… +${items.length - 20} more — use :raw for all, ?q= to filter, [n|seq] for one`
            : ''
          const prepared = index === '' ? `(no ${seg0.name} items recorded)` : index + tail
          return applyFace(prepared, canonical, sel, 'prepared')
        }
        const bySeq = items.find(it => it.seq === Number(seg0.bracket))
        if (bySeq !== undefined) return applyFace(bySeq.text, bySeq.text, sel, 'prepared')
        const ordinal = Number(seg0.bracket)
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= items.length) {
          throw new UrlSchemesError(
            'CTX_NO_SUCH_ELEMENT',
            `ctx://session/${seg0.name}[${seg0.bracket}]: no such element (collection "${seg0.name}" has ${items.length} items, 0-based; labels are event seqs)`,
          )
        }
        return applyFace(items[ordinal]!.text, items[ordinal]!.text, sel, 'prepared')
      }

      throw new UrlSchemesError(
        'CTX_UNKNOWN_KEY',
        `ctx://${raw}: unknown path (known: session, session/transcript, session/compactions[...], session/user_prompts[...], session/tool_calls[...], session/agent_responses[...], session/thinking[...], session/system[...], session/injections[...]; bare ctx:// lists the full roster)`,
      )

      // ── local helpers ──
      function pickEpisode(list: typeof episodes, bracket: string): (typeof episodes)[number] {
        const byLabel = list.find(e => String(e.label) === bracket)
        if (byLabel !== undefined) return byLabel
        const ordinal = Number(bracket)
        if (Number.isInteger(ordinal) && ordinal >= 0 && ordinal < list.length) return list[ordinal]!
        throw new UrlSchemesError(
          'CTX_NO_SUCH_ELEMENT',
          `ctx://…[${bracket}]: no such compaction episode (labels: ${list.map(e => e.label).join(', ') || 'none'})`,
        )
      }

      function buildSnapshot(agent: CtxAgent, all: readonly PersistenceEvent[], list: Episode[], tIdx: TranscriptIndex): string {
        const headers = all.filter(e => e.type === 'request/header')
        const system = (headers[headers.length - 1]?.data as { header?: { system?: string } } | undefined)?.header?.system
        const counts: Record<string, number> = {}
        for (const e of all) {
          if (e.type === 'user/message') {
            const k = sourceKind(e) === 'user' ? 'user_prompts' : 'injected_user_messages'
            counts[k] = (counts[k] ?? 0) + 1
          } else if (e.type === 'assistant/message') {
            counts.agent_messages = (counts.agent_messages ?? 0) + 1
            for (const b of blocksOf(e)) counts[`block_${b.type}`] = (counts[`block_${b.type}`] ?? 0) + 1
          } else if (e.type === 'tool/call') counts.tool_calls = (counts.tool_calls ?? 0) + 1
          else if (e.type === 'tool/result') counts.tool_results = (counts.tool_results ?? 0) + 1
        }
        counts.compactions = list.length
        // Normalize: stats consumers see every key, absent categories as 0.
        for (const key of ['user_prompts', 'injected_user_messages', 'agent_messages',
          'block_reasoning', 'block_text', 'block_tool-call', 'tool_calls', 'tool_results']) {
          counts[key] = counts[key] ?? 0
        }
        const header = agent.session.header
        const lastSeq = all.reduce((m, e) => Math.max(m, e.seq as number), 0)
        return JSON.stringify({
          resource: 'ctx://session',
          syntax: '/sub-path [<label|n>] [:N-M|:path/|?q=]; :raw = canonical full content; :raw:N-M ≡ :N-M',
          session: {
            id: header.id ?? agent.id, createdAt: header.createdAt, cwd: header.cwd,
            agentPreset: header.agentPreset, status: agent.status, origin: header.origin,
            delegationDepth: header.delegationDepth,
          },
          storage: { format: 'session.jsonl.zstd (read via sessionPersistence)' },
          totals: counts,
          segments: [
            ...list.map(e => ({ segment: `compaction:${e.label}`, seq_start: e.shadowedRange?.start ?? null, seq_end: e.shadowedRange?.end ?? null, lines: e.lines, items: e.shadowedSeqs.length })),
            {
              segment: 'live',
              seq_start: (list.at(-1)?.shadowedRange?.end ?? -1) + 1,
              seq_end: lastSeq,
              lines: null,
              items: all.filter(e => (e.seq as number) >= (list.at(-1)?.shadowedRange?.end ?? -1) + 1).length,
            },
          ],
          system_prompt: { chars: system?.length ?? 0, preview: system === undefined ? '' : system.slice(0, 200) },
          compacted: list.map(e => ({
            label: e.label, checkpoint_seq: e.checkpointSeq, compactionId: e.compactionId, at: e.at,
            seq_start: e.shadowedRange.start, seq_end: e.shadowedRange.end,
            lines: e.lines, shadowed_items: e.shadowedSeqs.length,
            shadowed_token_count: e.shadowedTokenCount, fidelity: e.fidelity, replaces_checkpoint: e.replacesCheckpoint,
            summary_preview: sectionPreviews(e.summaryText),
          })),
          asOf: { seq: lastSeq, line: tIdx.totalLines },
          hints: [
            'ctx://session:raw → full transcript',
            'ctx://session/compactions[<label>]:raw → original span',
            'ctx://session/thinking / system / injections / user_prompts / tool_calls / agent_responses → index faces',
            ':path/<dot-path> narrow-reads the snapshot · ?q=<text> filters an index',
          ],
        }, undefined, 2)
      }
    },
  }
}
