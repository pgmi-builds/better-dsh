import { describe, expect, it } from 'vitest'
import { UrlResolver } from '../../src/url-schema/resolver.ts'
import type { ResolverEnv } from '../../src/url-schema/resolver.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import { createCtxHandler } from '../../src/url-schema/handlers/ctx.ts'
import type { CtxAgent, CtxEnv } from '../../src/url-schema/handlers/ctx.ts'

/** A minimal fake agent shaped like the upstream `Agent` snapshot source. */
function fakeAgent(overrides: Partial<CtxAgent> = {}): CtxAgent {
  return {
    id: 'sess-1',
    status: 'running',
    options: { provider: 'deepseek', model: 'deepseek-v4-pro', maxTokens: 8192 },
    session: { header: { cwd: '/w/dashr' } },
    ...overrides,
  }
}

/** Resolve through a resolver with only the `ctx` scheme registered. */
function ctxResolver(): UrlResolver {
  const resolver = new UrlResolver()
  resolver.register('ctx', createCtxHandler())
  return resolver
}

/** Extract the structured error code a rejected resolve throws. */
async function errorCode(promise: Promise<string>): Promise<string> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(UrlSchemaError)
    return (err as UrlSchemaError).code
  }
  throw new Error('expected resolve to throw')
}

describe('ctx:// snapshot scheme', () => {
  describe('key listing', () => {
    it('lists the snapshot keys one per line on a bare ctx://', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent() }
      await expect(resolver.resolve(env, 'ctx://')).resolves.toBe('session\nmodel\ncwd')
    })

    it('lists the keys even without an agent in the env', async () => {
      const resolver = ctxResolver()
      const env: ResolverEnv = {}
      await expect(resolver.resolve(env, 'ctx://')).resolves.toBe('session\nmodel\ncwd')
    })
  })

  describe('ctx://session', () => {
    it('renders identity and session lineage as JSON', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = {
        agent: fakeAgent({
          session: { header: { cwd: '/w/dashr', origin: 'subagent', delegationDepth: 2 } },
        }),
      }
      const out = await resolver.resolve(env, 'ctx://session')
      expect(JSON.parse(out)).toEqual({
        id: 'sess-1',
        status: 'running',
        origin: 'subagent',
        delegationDepth: 2,
      })
    })

    it('omits origin and delegationDepth for a top-level agent', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent({ status: 'idle' }) }
      const out = await resolver.resolve(env, 'ctx://session')
      expect(JSON.parse(out)).toEqual({ id: 'sess-1', status: 'idle' })
    })
  })

  describe('ctx://model', () => {
    it('renders the agent request options as JSON', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent() }
      const out = await resolver.resolve(env, 'ctx://model')
      expect(JSON.parse(out)).toEqual({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        maxTokens: 8192,
      })
    })

    it('omits undefined option fields', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent({ options: {} }) }
      const out = await resolver.resolve(env, 'ctx://model')
      expect(JSON.parse(out)).toEqual({})
    })
  })

  describe('ctx://cwd', () => {
    it('returns the session working directory as a bare string', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent() }
      await expect(resolver.resolve(env, 'ctx://cwd')).resolves.toBe('/w/dashr')
    })

    it('returns an empty string when the header has no cwd', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent({ session: { header: {} } }) }
      await expect(resolver.resolve(env, 'ctx://cwd')).resolves.toBe('')
    })
  })

  describe('errors', () => {
    it('raises CTX_UNKNOWN_KEY listing the known keys', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent() }
      await expect(resolver.resolve(env, 'ctx://nope')).rejects.toThrowError(
        /unknown snapshot key \(known: session, model, cwd\)/,
      )
      expect(await errorCode(resolver.resolve(env, 'ctx://nope'))).toBe('CTX_UNKNOWN_KEY')
    })

    it('raises CTX_NO_AGENT when the env carries no agent', async () => {
      const resolver = ctxResolver()
      const env: ResolverEnv = {}
      await expect(resolver.resolve(env, 'ctx://session')).rejects.toThrowError(
        /requires a live agent/,
      )
      expect(await errorCode(resolver.resolve(env, 'ctx://model'))).toBe('CTX_NO_AGENT')
      expect(await errorCode(resolver.resolve(env, 'ctx://cwd'))).toBe('CTX_NO_AGENT')
    })
  })

  describe('path normalization', () => {
    it('strips leading slashes before matching a key', async () => {
      const resolver = ctxResolver()
      const env: CtxEnv = { agent: fakeAgent() }
      await expect(resolver.resolve(env, 'ctx:///cwd')).resolves.toBe('/w/dashr')
    })
  })
})
