import { describe, expect, it } from 'vitest'
import { UrlResolver } from '../../src/url-schemes/resolver.ts'
import type { ResolverEnv } from '../../src/url-schemes/resolver.ts'
import { UrlSchemesError } from '../../src/url-schemes/selector.ts'
import { createCtxHandler } from '../../src/url-schemes/handlers/ctx.ts'
import type { CtxAgent, CtxEnv, PersistenceEvent } from '../../src/url-schemes/handlers/ctx.ts'

/** A minimal fake agent shaped like the upstream `Agent` snapshot source. */
function fakeAgent(overrides: Partial<CtxAgent> = {}): CtxAgent {
  return {
    id: 'sess-1',
    status: 'running',
    options: { provider: 'deepseek', model: 'deepseek-v4-pro', maxTokens: 8192 },
    session: { header: { id: 'sess-1', cwd: '/w/dashr', agentPreset: 'standard', createdAt: 1_700_000_000_000 } },
    ...overrides,
  }
}

/** One compaction episode + the ordinary history it absorbed. */
const T = 1_700_000_000_000
const FIXTURE_EVENTS = [
  { seq: 5, type: 'user/message', time: T, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello world' }] } },
  { seq: 6, type: 'assistant/message', time: T, data: { message: { content: [{ type: 'text', text: 'hi there' }] } } },
  { seq: 7, type: 'tool/call', time: T, data: { callId: 'call_1', name: 'bash', arguments: '{"command":"ls"}' } },
  { seq: 8, type: 'tool/result', time: T, sourceEventSeqs: [7], data: { message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'file-a\nfile-b' }] }] } } },
  { seq: 20, type: 'compaction/summary', time: T + 1, data: {
      compactionId: 'aaaa1111-0000-0000-0000-000000000000',
      shadowedRange: { start: 5, end: 18 },
      shadowedSeqs: [5, 6, 7, 8],
      shadowedTokenCount: 500,
      summary: [{ text: '## Primary Request and Intent\n- do the thing\n## Critical Context\n- none' }],
  } },
  { seq: 21, type: 'user/message', time: T + 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi again (round two)' }] } },
  { seq: 40, type: 'compaction/summary', time: T + 2, data: {
      compactionId: 'bbbb2222-0000-0000-0000-000000000000',
      shadowedRange: { start: 21, end: 39 },
      shadowedSeqs: [21, 30, 31],
      shadowedTokenCount: 900,
      summary: [{ text: '## Primary Request and Intent\n- second round\n## Current Work\n- mobile' }],
  } },
  { seq: 9, type: 'system/message', time: T, data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'system notice one' }] } } },
  { seq: 10, type: 'system/message', time: T, data: { turn: 1, step: 1, source: { kind: 'system', plugin: 'tester' }, message: { role: 'system', content: [{ type: 'text', text: 'system notice two' }] } } },
  { seq: 30, type: 'assistant/message', time: T + 1, data: { turn: 1, step: 2, message: { content: [{ type: 'reasoning', text: 'think about the thing' }, { type: 'text', text: 'interim answer' }] } } },
  { seq: 50, type: 'assistant/message', time: T + 3, data: { turn: 2, step: 1, message: { content: [{ type: 'reasoning', text: 'second thought' }] } } },
]

/** A compaction episode whose shadowed span exceeds the 65536-char oversize guard. */
const BIG_TEXT = 'x'.repeat(70_000)
const BIG_EVENTS: PersistenceEvent[] = [
  { seq: 5, type: 'user/message', time: T, data: { source: { kind: 'user' }, content: [{ type: 'text', text: BIG_TEXT }] } },
  { seq: 20, type: 'compaction/summary', time: T + 1, data: {
      compactionId: 'cccc3333-0000-0000-0000-000000000000',
      shadowedRange: { start: 5, end: 5 },
      shadowedSeqs: [5],
      shadowedTokenCount: 20_000,
      summary: [{ text: '## Primary Request and Intent\n- big span' }],
  } },
]

/** Injected `user/message` events (non-`user` sources) alongside one real prompt. */
const INJECTED_EVENTS: PersistenceEvent[] = [
  { seq: 5, type: 'user/message', time: T, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'real prompt' }] } },
  { seq: 6, type: 'user/message', time: T, data: { source: { kind: 'agent-instructions', form: 'instructions' }, content: [{ type: 'text', text: '<system-reminder> AGENTS.md guidance' }] } },
  { seq: 7, type: 'user/message', time: T, data: { source: { kind: 'plugin', plugin: 'system-prompt', form: 'snapshot' }, content: [{ type: 'text', text: 'runtime context snapshot' }] } },
]

/** Fake persistence: records `close` so tests can assert handle disposal. */
function fakePersistence(closed: { value: boolean }, events: readonly PersistenceEvent[] = FIXTURE_EVENTS) {
  return {
    open: async (_id: string, _access: 'read') => ({
      read: async () => ({ events }),
      close: async () => { closed.value = true },
    }),
  }
}

/** Resolver with only the ctx scheme registered over the fixture persistence. */
function ctxResolver(closed: { value: boolean }, events: readonly PersistenceEvent[] = FIXTURE_EVENTS): UrlResolver {
  const resolver = new UrlResolver()
  resolver.register('ctx', createCtxHandler({ sessionPersistence: fakePersistence(closed, events) }))
  return resolver
}
/** Extract the structured error code a rejected resolve throws. */
async function errorCode(promise: Promise<string>): Promise<string> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(UrlSchemesError)
    return (err as UrlSchemesError).code
  }
  throw new Error('expected resolve to throw')
}

describe('ctx:// recallable context', () => {
  it('roster lists the session surface without an agent', async () => {
    const resolver = ctxResolver({ value: false })
    const env: ResolverEnv = {}
    const out = await resolver.resolve(env, 'ctx://')
    expect(out).toContain('ctx://session')
    expect(out).toContain('compactions')
    expect(out).toContain('ctx://session/thinking')
    expect(out).toContain('ctx://session/system')
    expect(out).toContain('ctx://session/injections')
  })

  it('statistics snapshot: prepared face carries totals + episodes + identity card', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent({ session: { header: { cwd: '/w/dashr', origin: 'subagent', delegationDepth: 2 } } }) }
    const snap = JSON.parse(await resolver.resolve(env, 'ctx://session'))
    expect(snap.syntax).toBe('/sub-path [<label|n>] [:N-M]; :raw = canonical full content; :raw:N-M ≡ :N-M')
    expect(snap.session.id).toBe('sess-1')
    expect(snap.session.origin).toBe('subagent')
    expect(snap.session.delegationDepth).toBe(2)
    expect(snap.totals.user_prompts).toBe(2)
    expect(snap.totals.injected_user_messages).toBe(0)
    expect(snap.totals.tool_calls).toBe(1)
    expect(snap.totals.compactions).toBe(2)
    expect(snap.compacted).toHaveLength(2)
    expect(snap.compacted[0].label).toBe(20)
    expect(snap.compacted[0].replaces_checkpoint).toBeNull()
    expect(snap.compacted[1].label).toBe(40)
    expect(snap.compacted[1].replaces_checkpoint).toBe(21)
    expect(snap.compacted[0].summary_preview['Primary Request and Intent']).toContain('do the thing')
  })

  it('session:raw returns the full transcript (canonical face)', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session:raw')
    expect(out).toContain('[0000005] USER\nhello world')
    expect(out).toContain('TOOL bash')
    expect(out).toContain('file-a')
  })

  it('line windows on session index the canonical transcript', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session:1-2')
    expect(out.split('\n')).toHaveLength(2)
    expect(out).toContain('USER')
  })

  it('compactions manifest lists episodes with the nested chain', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session/compactions')
    expect(out).toContain('label=20')
    expect(out).toContain('replaces_checkpoint=null')
    expect(out).toContain('label=40')
    expect(out).toContain('replaces_checkpoint=21')
  })

  it('compactions[<label>] bare = summary (prepared face)', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session/compactions[20]')
    expect(out).toContain('## Primary Request and Intent')
    expect(out).toContain('do the thing')
  })

  it('compactions[<label>]:raw = the shadowed original span', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session/compactions[20]:raw')
    expect(out).toContain('hello world')
    expect(out).toContain('file-a\nfile-b')
    expect(out).not.toContain('## Primary Request and Intent')
  })

  it('/original is removed: CTX_BAD_PATH echoing the URL (superseded by :raw/:N-M)', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const err = await resolver.resolve(env, 'ctx://session/compactions[20]/original').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(UrlSchemesError)
    expect((err as UrlSchemesError).code).toBe('CTX_BAD_PATH')
    expect((err as UrlSchemesError).message).toContain('ctx://session/compactions[20]/original')
  })

  it(':raw:N-M composite equals :N-M on an episode span and the transcript', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const epComposite = await resolver.resolve(env, 'ctx://session/compactions[20]:raw:1-2')
    const epPlain = await resolver.resolve(env, 'ctx://session/compactions[20]:1-2')
    expect(epComposite).toBe(epPlain)
    expect(epComposite).toContain('hello world')
    const trComposite = await resolver.resolve(env, 'ctx://session:raw:1-2')
    const trPlain = await resolver.resolve(env, 'ctx://session:1-2')
    expect(trComposite).toBe(trPlain)
  })
  it('ordinal fallback: compactions[0] is the first episode', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session/compactions[0]')
    expect(out).toContain('do the thing')
  })

  it('unknown label fails with the valid label list', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent() }
    expect(await errorCode(resolver.resolve(env, 'ctx://session/compactions[999999]'))).toBe('CTX_NO_SUCH_ELEMENT')
  })

  it('element collections: user_prompts by ordinal and by seq label', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const byOrdinal = await resolver.resolve(env, 'ctx://session/user_prompts[0]')
    expect(byOrdinal).toContain('hello world')
    const bySeq = await resolver.resolve(env, 'ctx://session/user_prompts[5]')
    expect(bySeq).toContain('hello world')
  })

  it('element collections: tool_calls carry name, arguments, and result', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const out = await resolver.resolve(env, 'ctx://session/tool_calls[0]')
    expect(out).toContain('bash')
    expect(out).toContain('"command":"ls"')
    expect(out).toContain('file-a')
  })

  it('legacy first-level keys fold into the session card (CTX_UNKNOWN_KEY)', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const err = await (async () => { try { await resolver.resolve(env, 'ctx://model'); return undefined } catch (e) { return e as UrlSchemesError } })()
    expect(err).toBeInstanceOf(UrlSchemesError)
    expect((err as UrlSchemesError).code).toBe('CTX_UNKNOWN_KEY')
    expect((err as UrlSchemesError).message).toContain('session')
  })

  it('persistence handle is closed after reads', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent() }
    await resolver.resolve(env, 'ctx://session')
    expect(closed.value).toBe(true)
  })

  it('CTX_NO_AGENT without a live agent on value reads', async () => {
    const resolver = ctxResolver({ value: false })
    const env: ResolverEnv = {}
    expect(await errorCode(resolver.resolve(env, 'ctx://session'))).toBe('CTX_NO_AGENT')
  })

  it('oversize guard: unwindowed :raw on a huge span carries the paging note', async () => {
    const resolver = ctxResolver({ value: false }, BIG_EVENTS)
    const env: CtxEnv = { agent: fakeAgent() }
    const rawOut = await resolver.resolve(env, 'ctx://session/compactions[20]:raw')
    expect(rawOut).toContain('[ctx:// note: original span is ')
    expect(rawOut).toContain('page with :N-M line windows or grep this URL]')
    const bare = await resolver.resolve(env, 'ctx://session/compactions[20]')
    expect(bare).not.toContain('ctx:// note')
    expect(bare).toContain('## Primary Request and Intent')
    expect(await resolver.resolve(env, 'ctx://session/compactions[20]:raw:1-1')).not.toContain('ctx:// note')
    expect(await resolver.resolve(env, 'ctx://session/compactions[20]:1-1')).not.toContain('ctx:// note')
  })

  it('thinking: bare index, [n] ordinal, [seq] label, :raw join, and line windows', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const index = await resolver.resolve(env, 'ctx://session/thinking')
    expect(index.split('\n')).toHaveLength(2)
    expect(index).toContain('[0] seq=30 turn=1 step=2 think about the thing')
    expect(index).toContain('[1] seq=50 turn=2 step=1 second thought')
    expect(await resolver.resolve(env, 'ctx://session/thinking[0]')).toBe('think about the thing')
    expect(await resolver.resolve(env, 'ctx://session/thinking[30]')).toBe('think about the thing')
    expect(await resolver.resolve(env, 'ctx://session/thinking[1]')).toBe('second thought')
    expect(await resolver.resolve(env, 'ctx://session/thinking[50]')).toBe('second thought')
    expect(await resolver.resolve(env, 'ctx://session/thinking:raw')).toBe('think about the thing\n\nsecond thought')
    expect(await resolver.resolve(env, 'ctx://session/thinking:raw:1-1')).toBe('think about the thing')
    expect(await resolver.resolve(env, 'ctx://session/thinking:1-1')).toBe('think about the thing')
    expect(await errorCode(resolver.resolve(env, 'ctx://session/thinking[999]'))).toBe('CTX_NO_SUCH_ELEMENT')
  })

  it('system: bare index (seq, source, preview), [n]/[seq], and :raw join', async () => {
    const resolver = ctxResolver({ value: false })
    const env: CtxEnv = { agent: fakeAgent() }
    const index = await resolver.resolve(env, 'ctx://session/system')
    expect(index.split('\n')).toHaveLength(2)
    expect(index).toContain('seq=9 source=- system notice one')
    expect(index).toContain('seq=10 source=system/tester system notice two')
    expect(await resolver.resolve(env, 'ctx://session/system[0]')).toBe('system notice one')
    expect(await resolver.resolve(env, 'ctx://session/system[10]')).toBe('system notice two')
    expect(await resolver.resolve(env, 'ctx://session/system[1]')).toBe('system notice two')
    expect(await resolver.resolve(env, 'ctx://session/system:raw')).toBe('system notice one\n\nsystem notice two')
    expect(await resolver.resolve(env, 'ctx://session/system:1-1')).toBe('system notice one')
  })

  it('injections: bare index lists only non-user user/messages; [n]/[seq]; :raw join; :N-M', async () => {
    const resolver = ctxResolver({ value: false }, INJECTED_EVENTS)
    const env: CtxEnv = { agent: fakeAgent() }
    const index = await resolver.resolve(env, 'ctx://session/injections')
    expect(index.split('\n')).toHaveLength(2)
    expect(index).toContain('seq=6 source=agent-instructions')
    expect(index).toContain('seq=7 source=plugin')
    const first = '[0000006] INJECTED agent-instructions\n<system-reminder> AGENTS.md guidance'
    const second = '[0000007] INJECTED plugin\nruntime context snapshot'
    expect(await resolver.resolve(env, 'ctx://session/injections[0]')).toBe(first)
    expect(await resolver.resolve(env, 'ctx://session/injections[6]')).toBe(first)
    expect(await resolver.resolve(env, 'ctx://session/injections:raw')).toBe(`${first}\n\n${second}`)
    expect(await resolver.resolve(env, 'ctx://session/injections:4-5')).toBe(second)
    expect(await resolver.resolve(env, 'ctx://session/user_prompts[0]')).toBe('[0000005] USER\nreal prompt')
    expect(await errorCode(resolver.resolve(env, 'ctx://session/injections[99]'))).toBe('CTX_NO_SUCH_ELEMENT')
  })

  it('snapshot segments: one per compaction plus a live tail', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent() }
    const snap = JSON.parse(await resolver.resolve(env, 'ctx://session'))
    expect(snap.segments).toHaveLength(3)
    expect(snap.segments[0].segment).toBe('compaction:20')
    expect(snap.segments[0].items).toBe(snap.compacted[0].shadowed_items)
    expect(snap.segments.at(-1)!.segment).toBe('live')
    expect(snap.segments.at(-1)!.start).toBe(snap.compacted[1].shadowed_range.end + 1)
  })

  it('line windows compose onto bracket element paths', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent() }
    expect(await resolver.resolve(env, 'ctx://session/user_prompts[0]:1-1')).toBe('[0000005] USER')
    expect(await resolver.resolve(env, 'ctx://session/user_prompts[0]')).toBe('[0000005] USER\nhello world')
    expect(await resolver.resolve(env, 'ctx://session/thinking[0]:1-1')).toBe('think about the thing')
    expect(await resolver.resolve(env, 'ctx://session/thinking[0]:raw')).toBe('think about the thing')
  })

  it('unknown key echoes the bare-roster pointer; system_prompt card always present', async () => {
    const closed = { value: false }
    const resolver = ctxResolver(closed)
    const env: CtxEnv = { agent: fakeAgent() }
    const message = await resolver.resolve(env, 'ctx://bogus').catch(e => String((e as UrlSchemesError).message))
    expect(message).toContain('bare ctx:// lists the full roster')
    const snap = JSON.parse(await resolver.resolve(env, 'ctx://session'))
    expect(snap.system_prompt).toEqual({ chars: 0, preview: '' })
  })
})
