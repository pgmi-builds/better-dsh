/**
 * Failover unit tests: drive the two native waterfalls directly (the same
 * seam the agent loop uses) and assert the per-turn latch walk.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { installFailover } from '../src/failover/index.ts'
import type { FailoverConfig } from '../src/failover/config.ts'

function failoverContext(config: FailoverConfig): Context {
  const ctx = new Context()
  installFailover(ctx, config)
  return ctx
}

const appended: Array<{ type: string; data: unknown }> = []
const agent = {
  id: 'agent-1',
  session: {
    append(type: string, data: unknown): unknown {
      appended.push({ type, data })
      return { type, data }
    },
  },
} as unknown as Agent
const seed: LlmCallConfig = { provider: 'primary', model: 'primary-model' }

function requestError(ctx: Context, turn: number, code: string, provider = 'primary') {
  return ctx.waterfall('agent/request-error', {
    agent,
    turn,
    step: 1,
    provider,
    failure: { message: 'boom', code },
    retryPolicy: undefined,
    signal: new AbortController().signal,
  }, () => Promise.resolve(undefined))
}

function request(ctx: Context, turn: number) {
  return ctx.waterfall('agent/request', {
    agent,
    turn,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve(seed))
}

describe('failover', () => {
  it('walks the two-slot chain on trigger-code failures within one turn', async () => {
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    // primary fails AUTH → retry, latched to fb1
    await expect(requestError(ctx, 1, 'AUTH')).resolves.toEqual({ kind: 'retry' })
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'fb', model: 'one' })
    // fb1 fails QUOTA → retry, latched to fb2
    await expect(requestError(ctx, 1, 'QUOTA', 'fb')).resolves.toEqual({ kind: 'retry' })
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'fb', model: 'two' })
  })

  it('treats MISSING_CREDENTIAL as an auth-class trigger', async () => {
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    await expect(requestError(ctx, 1, 'MISSING_CREDENTIAL')).resolves.toEqual({ kind: 'retry' })
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'fb', model: 'one' })
  })

  it('records a durable llm/retry event naming the failure and fallback', async () => {
    appended.length = 0
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    await requestError(ctx, 1, 'RATE_LIMIT')
    expect(appended).toHaveLength(1)
    const record = appended[0]!
    expect(record.type).toBe('llm/retry')
    const data = record.data as { provider: string; mode: string; retry: number; policyKey: string; delayMs: number; failure: { code: string; message: string } }
    expect(data.provider).toBe('primary')
    expect(data.mode).toBe('normal')
    expect(data.retry).toBe(1)
    expect(data.policyKey).toBe('llm-failover')
    expect(data.delayMs).toBe(0)
    expect(data.failure.code).toBe('failover')
    expect(data.failure.message).toBe('[RATE_LIMIT] boom → switched to "fb/one"')
  })

  it('renders AUTH failures verbatim (client localizes AUTH)', async () => {
    appended.length = 0
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    await requestError(ctx, 1, 'AUTH')
    const data = appended[0]!.data as { failure: { code: string; message: string } }
    expect(data.failure.code).toBe('failover')
    expect(data.failure.message).toBe('[AUTH] boom → switched to "fb/one"')
  })

  it('stays latched for the rest of the turn (no primary retry)', async () => {
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    await requestError(ctx, 1, 'AUTH')
    // same turn, later step still routes to fb1 (primary is not retried)
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'fb', model: 'one' })
  })

  it('resets to primary on a new turn', async () => {
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    await requestError(ctx, 1, 'AUTH')
    await request(ctx, 1)
    await expect(request(ctx, 2)).resolves.toMatchObject({ provider: 'primary', model: 'primary-model' })
  })

  it('passes through non-trigger codes and exhausted chains', async () => {
    const ctx = failoverContext({ fallback1: 'fb/one', fallback2: 'fb/two' })
    // non-trigger code → no retry
    await expect(requestError(ctx, 1, 'TIMEOUT')).resolves.toBeUndefined()
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'primary', model: 'primary-model' })
    // exhaust the chain (primary + fb1 + fb2 all fail) → third failure passes through
    await requestError(ctx, 2, 'AUTH')
    await request(ctx, 2)
    await requestError(ctx, 2, 'QUOTA', 'fb')
    await request(ctx, 2)
    await expect(requestError(ctx, 2, 'RATE_LIMIT', 'fb')).resolves.toBeUndefined()
  })

  it('passes through when no fallback is set', async () => {
    const ctx = failoverContext({ fallback1: '', fallback2: '' })
    await expect(requestError(ctx, 1, 'AUTH')).resolves.toBeUndefined()
    await expect(request(ctx, 1)).resolves.toMatchObject({ provider: 'primary', model: 'primary-model' })
  })
})
