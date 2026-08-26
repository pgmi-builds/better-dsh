/**
 * `dsh-url-schema` plugin wiring spec: proves the `apply()` contract that the
 * integration step owns — handler mounting shape, per-agent tool
 * installation, and (the load-bearing invariant) capture-BEFORE-register
 * ordering, which is what prevents the native-delegation wrappers from
 * recursing into themselves.
 */

import { describe, expect, it } from 'vitest'

import plugin from '../../src/url-schema/index.ts'
import { createCtxHandler } from '../../src/url-schema/handlers/ctx.ts'
import { createDvcHandler } from '../../src/url-schema/handlers/dvc.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'

describe('dsh-url-schema wiring smoke', () => {
  it('exports the cordis plugin shape with the agents service injected', () => {
    expect(plugin.name).toBe('dsh-url-schema')
    expect(plugin.inject).toContain('agents')
    expect(plugin.inject).not.toContain('replRuntime')
    expect(typeof plugin.apply).toBe('function')
  })

  it('apply() mounts handlers and installs tools with capture-before-register ordering', async () => {
    const fakeNative = {
      write: { name: 'write', execute: async () => ({}) },
      grep: { name: 'grep', execute: async () => ({}) },
      glob: { name: 'glob', execute: async () => ({}) },
    }
    const order: string[] = []
    let sessionStart: ((payload: { agent: unknown }) => void) | undefined

    const rootCtx = {
      on: (evt: string, cb: (payload: { agent: unknown }) => void) => {
        if (evt === 'agent/session-start') sessionStart = cb
      },
      logger: () => ({ warn: (m: string) => order.push(`warn:${m}`) }),
      skills: { get: async () => undefined },
      fs: {
        resolve: async (p: string) => ({ displayPath: p }),
        readText: async () => '',
        writeText: async () => ({ operation: 'create' }),
      },
      sessions: { list: () => [], get: () => undefined },
      subagents: { listChildren: async () => [] },
      settings: {},
      agents: { get: () => undefined },
      tools: {
        get: (name: string) => {
          order.push(`capture:${name}`)
          return fakeNative[name as keyof typeof fakeNative]
        },
        register: () => () => {},
      },
    } as unknown as Parameters<typeof plugin.apply>[0]

    plugin.apply(rootCtx, undefined)
    expect(sessionStart).toBeDefined()

    const agent = {
      id: 'a1',
      ctx: {
        effect: (fn: () => unknown) => fn(),
        tools: {
          register: (def: { name: string }) => {
            order.push(`agent-register:${def.name}`)
            return () => {}
          },
        },
      },
    }
    sessionStart!({ agent })

    const firstAgentRegIdx = order.findIndex((s) => s === 'agent-register:read')
    const lastCaptureIdx = order.map((s) => s.startsWith('capture:')).lastIndexOf(true)
    expect(order.filter((s) => s.startsWith('capture:'))).toEqual([
      'capture:write',
      'capture:grep',
      'capture:glob',
    ])
    expect(lastCaptureIdx).toBeLessThan(firstAgentRegIdx)
    expect(order.filter((s) => s.startsWith('agent-register:'))).toEqual([
      'agent-register:read',
      'agent-register:write',
      'agent-register:grep',
      'agent-register:glob',
    ])
    expect(order.filter((s) => s.startsWith('warn:'))).toEqual([])
  })

  it('dvc + ctx handlers resolve through a fresh resolver', async () => {
    const resolver = new UrlResolver()
    resolver.register('dvc', createDvcHandler())
    resolver.register('ctx', createCtxHandler())
    await expect(resolver.resolve({}, 'dvc://')).resolves.toBe('no devices mounted')
    await expect(
      resolver.resolve(
        { agent: { id: 'a1', status: 'idle', options: {}, session: { header: { cwd: '/tmp' } } } },
        'ctx://session:raw',
      ),
    ).resolves.toContain('"id": "a1"')
  })
})
