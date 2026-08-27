/**
 * `agent://` family-tree semantics (design.md D6): the roster is the caller's
 * descendant projection (continuable children only), addressing is scoped to
 * the caller's own family, settled children fall back to the persisted log,
 * and id segments resolve raw-id-first with label fallback.
 */

import { describe, expect, it } from 'vitest'
import { MessageId, type AssistantMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'

import { createAgentHandler } from '../../src/url-schema/handlers/agent.ts'
import type { AgentDescendantEntry, PersistedSessionEvent } from '../../src/url-schema/handlers/agent.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'

/** Deterministic epoch-relative times (ms) for every fixture log. */
const T = {
  caller: 1_700_000_000_000,
  callerLast: 1_700_000_001_000,
  a: 1_700_000_002_000,
  aLast: 1_700_000_009_000,
  b: 1_700_000_003_000,
  bLast: 1_700_000_009_500,
  g: 1_700_000_004_000,
  gLast: 1_700_000_008_000,
  old: 1_700_000_001_000,
  new: 1_700_000_005_000,
}

/** One model-sourced assistant message, as a valid seed event payload. */
function assistantMessage(id: string, text: string): AssistantMessage {
  return {
    id: MessageId(id),
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'deepseek', model: 'test' },
  }
}

/**
 * A real live `Session` whose seed ends in `session/end-seed` (no constructor
 * marker appends, so the last-activity time stays deterministic) and whose
 * surface carries the given assistant outputs in order.
 */
function liveSession(id: string, createdAt: number, lastTime: number, outputs: readonly string[]): Session {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, origin: 'subagent' }
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: 0, time: createdAt, data: { turn: 0 } },
    { type: 'step/start', seq: 1, time: createdAt, data: { turn: 0, step: 0 } },
    ...outputs.map((text, index): SessionEvent => ({
      type: 'assistant/message',
      seq: 2 + index,
      time: lastTime - (outputs.length - index),
      surfaceOp: 'append',
      data: { turn: 0, step: 0, message: assistantMessage(`${id}-msg-${index}`, text) },
    })),
    { type: 'session/end-seed', seq: 2 + outputs.length, time: lastTime, data: {} },
  ]
  return Session.create(SessionId(id), events, header)
}

/** A persisted session-log view shaped like `sessionPersistence.inspect`. */
function persistedLog(createdAt: number, lastTime: number, outputs: readonly string[]) {
  const events: PersistedSessionEvent[] = [
    { type: 'turn/start', time: createdAt, data: { turn: 0 } },
    { type: 'step/start', time: createdAt, data: { turn: 0, step: 0 } },
    ...outputs.map((text, index) => ({
      type: 'assistant/message',
      time: lastTime - (outputs.length - index),
      surfaceOp: 'append',
      data: { turn: 0, step: 0, message: assistantMessage(`p-msg-${index}`, text) },
    })),
    { type: 'turn/end', time: lastTime, data: {} },
  ]
  return { meta: { createdAt }, events }
}

/** One `child` row of the descendant listing. */
function childEntry(
  id: string,
  parentId: string,
  options: {
    mode?: 'one-shot' | 'continuable'
    label?: string
    activity?: 'running' | 'inactive'
    depth?: number
  } = {},
): AgentDescendantEntry {
  return {
    kind: 'child',
    id: SessionId(id),
    activity: options.activity ?? 'running',
    mode: options.mode ?? 'continuable',
    label: options.label,
    hasChildren: false,
    parentId: SessionId(parentId),
    depth: options.depth ?? 1,
  }
}

/** What a fake persistence surface stores, keyed by raw session id. */
type Persisted = Record<string, { meta: { createdAt: number }; events: PersistedSessionEvent[] }>

/** Build the handler plus its caller env over one fake family. */
function makeHandler(options: {
  sessions?: Session[]
  descendants?: AgentDescendantEntry[]
  persisted?: Persisted
  registry?: Record<string, 'idle' | 'running'>
  callerId?: string
}) {
  const callerId = options.callerId ?? 'caller-1'
  const handler = createAgentHandler({
    sessions: { get: (id: SessionId) => options.sessions?.find((session) => session.id === id) },
    subagents: { listDescendants: async () => options.descendants ?? [] },
    sessionPersistence: { inspect: async (id: SessionId) => options.persisted?.[String(id)] },
    ...options.registry === undefined ? {} : {
      agents: {
        get: (id: SessionId) => {
          const status = options.registry?.[String(id)]
          return status === undefined ? undefined : { status }
        },
      },
    },
  })
  return { handler, env: { agent: { id: callerId } } }
}

/** Await a rejection and return its structured `UrlSchemaError`. */
async function rejection(promise: Promise<string>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return error as UrlSchemaError
  }
  throw new Error('expected the call to reject')
}

/**
 * The standard fake family: live `doer-1` (sess-a), settled `doer-2` (sess-b,
 * persisted), `inner-1` (sess-g, grandchild under sess-a), one-shot sess-c
 * (persisted), and live outsider sess-x (in the store, outside the family).
 */
function standardFamily() {
  return {
    sessions: [
      liveSession('caller-1', T.caller, T.callerLast, ['caller early', 'caller final']),
      liveSession('sess-a', T.a, T.aLast, ['A draft', 'A final']),
      liveSession('sess-g', T.g, T.gLast, ['G final']),
      liveSession('sess-x', T.a, T.aLast, ['outsider output']),
    ],
    descendants: [
      childEntry('sess-a', 'caller-1', { label: 'doer-1' }),
      childEntry('sess-b', 'caller-1', { label: 'doer-2', activity: 'inactive' }),
      childEntry('sess-g', 'sess-a', { label: 'inner-1', depth: 2 }),
      childEntry('sess-c', 'caller-1', { mode: 'one-shot', activity: 'inactive' }),
    ],
    persisted: {
      'sess-b': persistedLog(T.b, T.bLast, ['B persisted final']),
      'sess-c': persistedLog(T.a, T.aLast, ['C one-shot final']),
    },
    registry: { 'sess-a': 'running', 'sess-g': 'idle' } as const,
  }
}

describe('agent:// family roster', () => {
  it('lists continuable descendants with label, native status, parent, and last activity', async () => {
    const family = standardFamily()
    const { handler, env } = makeHandler(family)
    const roster = await handler.resolve(env, '')
    expect(roster).toEqual([
      'id\tstatus\tparent\tlast activity',
      `doer-1\trunning\tcaller-1\t${new Date(T.aLast).toISOString()}`,
      `doer-2\tready\tcaller-1\t${new Date(T.bLast).toISOString()}`,
      `inner-1\tidle\tsess-a\t${new Date(T.gLast).toISOString()}`,
    ].join('\n'))
  })

  it('renders an empty roster when the caller has no descendants', async () => {
    const { handler, env } = makeHandler({})
    await expect(handler.resolve(env, '')).resolves.toBe('no agents')
  })

  it('omits one-shot children from the roster even when they are the only children', async () => {
    const { handler, env } = makeHandler({
      descendants: [childEntry('sess-c', 'caller-1', { mode: 'one-shot', activity: 'inactive' })],
      persisted: { 'sess-c': persistedLog(T.a, T.aLast, ['C one-shot final']) },
    })
    await expect(handler.resolve(env, '')).resolves.toBe('no agents')
  })
})

describe('agent:// family addressing', () => {
  it('returns the caller its own output artifact', async () => {
    const { handler, env } = makeHandler(standardFamily())
    await expect(handler.resolve(env, 'caller-1')).resolves.toBe('caller final')
  })

  it('returns a live descendant output by raw id and by label', async () => {
    const { handler, env } = makeHandler(standardFamily())
    await expect(handler.resolve(env, 'sess-a')).resolves.toBe('A final')
    await expect(handler.resolve(env, 'doer-1')).resolves.toBe('A final')
  })

  it('returns a settled one-shot child output from the persisted log', async () => {
    const { handler, env } = makeHandler(standardFamily())
    // Nested (the job_output shape): the parent names the child.
    await expect(handler.resolve(env, 'caller-1/sess-c')).resolves.toBe('C one-shot final')
    // Top-level: a family descendant is addressable even when settled.
    await expect(handler.resolve(env, 'sess-c')).resolves.toBe('C one-shot final')
  })

  it('resolves a nested child through a descendant parent (raw and label forms)', async () => {
    const { handler, env } = makeHandler(standardFamily())
    await expect(handler.resolve(env, 'sess-a/inner-1')).resolves.toBe('G final')
    await expect(handler.resolve(env, 'doer-1/inner-1')).resolves.toBe('G final')
  })

  it('rejects ids outside the caller family with AGENT_UNKNOWN_ID', async () => {
    const { handler, env } = makeHandler(standardFamily())
    for (const path of ['sess-x', 'sess-x/transcript', 'caller-1/sess-x']) {
      const error = await rejection(handler.resolve(env, path))
      expect(error.code).toBe('AGENT_UNKNOWN_ID')
      expect(error.message).toContain('sess-x')
    }
  })

  it('rejects a nested read of a grandchild directly under the caller (not a direct child)', async () => {
    const { handler, env } = makeHandler(standardFamily())
    const error = await rejection(handler.resolve(env, 'caller-1/inner-1'))
    expect(error.code).toBe('AGENT_UNKNOWN_ID')
    expect(error.message).toContain('inner-1')
  })

  it('rejects a family child with no live session and no persisted log', async () => {
    const { handler, env } = makeHandler({
      descendants: [childEntry('sess-n', 'caller-1', { activity: 'inactive' })],
    })
    const error = await rejection(handler.resolve(env, 'sess-n'))
    expect(error.code).toBe('AGENT_UNKNOWN_ID')
    expect(error.message).toContain('no live session and no persisted log')
  })

  it('rejects paths with more than two segments', async () => {
    const { handler, env } = makeHandler(standardFamily())
    const error = await rejection(handler.resolve(env, 'sess-a/transcript/extra'))
    expect(error.code).toBe('AGENT_BAD_PATH')
  })
})

describe('agent:// label double-matching', () => {
  it('prefers the exact raw id over a colliding label', async () => {
    const { handler, env } = makeHandler({
      sessions: [
        liveSession('sess-a', T.a, T.aLast, ['A final']),
        liveSession('sess-d', T.g, T.gLast, ['D final']),
      ],
      descendants: [
        childEntry('sess-a', 'caller-1', { label: 'doer-1' }),
        // A label that collides with sess-a's RAW id must not shadow it.
        childEntry('sess-d', 'caller-1', { label: 'sess-a' }),
      ],
    })
    await expect(handler.resolve(env, 'sess-a')).resolves.toBe('A final')
  })

  it('resolves an ambiguous label to the newest child', async () => {
    const { handler, env } = makeHandler({
      sessions: [liveSession('sess-e1', T.old, T.aLast, ['older wins never'])],
      descendants: [
        childEntry('sess-e1', 'caller-1', { label: 'dupe' }),
        // Newest by persisted createdAt — and settled, so the output itself
        // must come from the persistence fallback.
        childEntry('sess-e2', 'caller-1', { label: 'dupe', activity: 'inactive' }),
      ],
      persisted: { 'sess-e2': persistedLog(T.new, T.bLast, ['newest wins']) },
    })
    await expect(handler.resolve(env, 'dupe')).resolves.toBe('newest wins')
  })

  it('notes the ambiguity and the raw-id disambiguation in the error when the newest match fails', async () => {
    const { handler, env } = makeHandler({
      sessions: [liveSession('sess-e1', T.old, T.aLast, ['older wins never'])],
      descendants: [
        childEntry('sess-e1', 'caller-1', { label: 'dupe' }),
        // Newest, but settled — a transcript needs a live session, so the
        // ambiguous resolution surfaces its note in the structured error.
        childEntry('sess-e2', 'caller-1', { label: 'dupe', activity: 'inactive' }),
      ],
      persisted: { 'sess-e2': persistedLog(T.new, T.bLast, ['newest wins']) },
    })
    const error = await rejection(handler.resolve(env, 'dupe/transcript'))
    expect(error.code).toBe('AGENT_UNKNOWN_ID')
    expect(error.message).toContain('dupe')
    expect(error.message).toContain('ambiguous')
    expect(error.message).toContain('raw session id')
  })
})

describe('agent:// transcript scoping', () => {
  it('returns the caller and family transcripts, role-headed', async () => {
    const { handler, env } = makeHandler(standardFamily())
    await expect(handler.resolve(env, 'caller-1/transcript')).resolves.toBe('## assistant\ncaller early\n\n## assistant\ncaller final')
    const transcript = await handler.resolve(env, 'sess-a/transcript')
    expect(transcript).toBe('## assistant\nA draft\n\n## assistant\nA final')
  })
})
