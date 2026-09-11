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
import { UrlSchemesError } from '../selector.ts'

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
  return blocks
    .flatMap(b => (b as { content?: ContentBlock[] }).content ?? [])
    .map(c => c.text ?? '')
    .join('\n')
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
  return ranges.map(([a, b]) => lines.slice(Math.max(0, a - 1), b).join('\n')).join('\n')
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
  throw new UrlSchemesError('CTX_BAD_SELECTOR', `ctx://: unsupported selector kind "${selector.kind}"`)
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
          `ctx://${raw}: unknown key (known: session — model/cwd folded into the session info card)`,
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
      const transcript = (): string =>
        events.map(e => renderEntry(e, toolNameOf)).filter(t => t !== '').join('\n\n')

      // ── compaction episodes (nested chain included) ──
      const episodes: Array<{
        label: number; checkpointSeq: number; compactionId: string; at: number | undefined
        shadowedRange: { start: number; end: number }; shadowedSeqs: readonly number[]
        shadowedTokenCount: number; replacesCheckpoint: number | null; summaryText: string
        originalText: string
      }> = []
      {
        let prevCheckpoint: number | null = null
        const nameOf = toolNameOf
        for (const e of events) {
          if (e.type !== 'compaction/summary') continue
          const d = e.data as {
            compactionId: string
            shadowedRange: { start: number; end: number }
            shadowedSeqs: number[]
            shadowedTokenCount: number
            summary: Array<{ text: string }>
          }
          const originalText = d.shadowedSeqs
            .map(seq => events.find(ev => ev.seq === seq))
            .filter((ev): ev is PersistenceEvent => ev !== undefined)
            .map(ev => renderEntry(ev, nameOf))
            .filter(t => t !== '')
            .join('\n\n')
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
        const canonical = transcript()
        const prepared = buildSnapshot(agent, events, episodes)
        return applyFace(prepared, canonical, sel, seg0?.name === 'transcript' ? 'canonical' : 'prepared')
      }

      // ── compactions: manifest / episode summary / shadowed span via selectors ──
      if (seg0.name === 'compactions') {
        if (seg0.bracket === undefined) {
          if (sel !== null && sel.kind !== 'raw') {
            throw new UrlSchemesError('CTX_BAD_SELECTOR', 'ctx://session/compactions: only :raw (or no selector) is supported on the manifest')
          }
          const body = episodes
            .map(e => [
              `label=${e.label} (checkpoint_seq=${e.checkpointSeq})`,
              `compactionId=${e.compactionId}`,
              `at=${new Date(e.at ?? 0).toISOString()}`,
              `shadowed=${e.shadowedRange.start}..${e.shadowedRange.end} (${e.shadowedSeqs.length} items, ${e.shadowedTokenCount} tokens)`,
              `replaces_checkpoint=${e.replacesCheckpoint ?? 'null'}`,
              `preview=${e.summaryText.slice(0, 120)}…`,
            ].join(' | '))
            .join('\n')
          return body === '' ? '(no compactions recorded)' : body
        }
        const episode = pickEpisode(episodes, seg0.bracket)
        if (seg1 === undefined) {
          // prepared face = summary; canonical face = the original shadowed
          // span. The oversize note rides the UNWINDOWED canonical face only:
          // the bare URL returns the prepared summary, and `:N-M` / `:raw:N-M`
          // already page — a plain `:raw` is the one shape that can dump a
          // huge span in one read.
          if (sel !== null && sel.kind === 'raw' && episode.originalText.length > 65536) {
            return episode.originalText
              + `\n\n[ctx:// note: original span is ${episode.originalText.length} chars — page with :N-M line windows or grep this URL]`
          }
          return applyFace(episode.summaryText, episode.originalText, sel, 'prepared')
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
        if (bySeq !== undefined) return bySeq.text
        const ordinal = Number(seg0.bracket)
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= items.length) {
          throw new UrlSchemesError(
            'CTX_NO_SUCH_ELEMENT',
            `ctx://…[${seg0.bracket}]: no such element (collection "${seg0.name}" has ${items.length} items, 0-based; labels are event seqs)`,
          )
        }
        return items[ordinal]!.text
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

      if (seg0.bracket !== undefined || seg0.name === 'user_prompts' || seg0.name === 'tool_calls' || seg0.name === 'agent_responses') {
        const items = collection(seg0.name)
        const bracket = seg0.bracket ?? ''
        const bySeq = items.find(it => it.seq === Number(bracket))
        if (bySeq !== undefined) return bySeq.text
        const ordinal = Number(bracket)
        if (bracket === '' || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= items.length) {
          throw new UrlSchemesError(
            'CTX_NO_SUCH_ELEMENT',
            `ctx://…[${bracket}]: no such element (collection "${seg0.name}" has ${items.length} items, 0-based; labels are event seqs)`,
          )
        }
        return items[ordinal]!.text
      }

      throw new UrlSchemesError(
        'CTX_UNKNOWN_KEY',
        `ctx://${raw}: unknown path (known: session, session/transcript, session/compactions[...], session/user_prompts[...], session/tool_calls[...], session/agent_responses[...], session/thinking[...], session/system[...], session/injections[...])`,
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

      function buildSnapshot(agent: CtxAgent, all: readonly PersistenceEvent[], list: typeof episodes): string {
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
        return JSON.stringify({
          resource: 'ctx://session',
          syntax: '/sub-path [<label|n>] [:N-M]; :raw = canonical full content; :raw:N-M ≡ :N-M',
          session: {
            id: header.id ?? agent.id, createdAt: header.createdAt, cwd: header.cwd,
            agentPreset: header.agentPreset, status: agent.status, origin: header.origin,
            delegationDepth: header.delegationDepth,
          },
          storage: { format: 'session.jsonl.zstd (read via sessionPersistence)' },
          totals: counts,
          system_prompt: system === undefined ? undefined : { chars: system.length, preview: system.slice(0, 200) },
          compacted: list.map(e => ({
            label: e.label, checkpoint_seq: e.checkpointSeq, compactionId: e.compactionId, at: e.at,
            shadowed_range: e.shadowedRange, shadowed_items: e.shadowedSeqs.length,
            shadowed_token_count: e.shadowedTokenCount, replaces_checkpoint: e.replacesCheckpoint,
            summary_preview: sectionPreviews(e.summaryText),
          })),
          hints: [
            'ctx://session:raw → full transcript',
            'ctx://session/compactions[<label>]:raw → original span',
            'ctx://session/thinking / ctx://session/system / ctx://session/injections → index-faced collections',
          ],
        }, undefined, 2)
      }
    },
  }
}
