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
    // The fake registry's pre-mask visible surface: the three shadowed
    // natives plus one extra host tool, in this emission order.
    const visibleNames = ['write', 'grep', 'glob', 'host_extra']
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
        readText: async () => 'fn landed() {}\n',
        processPath: (target: unknown) => target,
        writeText: async () => ({ operation: 'create' }),
      },
      sessions: { list: () => [], get: () => undefined },
      subagents: { listChildren: async () => [] },
      settings: {},
      agents: { get: () => undefined },
      tools: {
        schemas: () => visibleNames.map(name => ({ name })),
        get: (name: string) => {
          order.push(`capture:${name}`)
          return { name, execute: async () => ({}) }
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
        // The hashline write/edit hooks listen on the agent scope's event
        // bus (a real cordis Context face); the stub records nothing and
        // disposes cleanly.
        on: () => () => {},
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
    // The capture is now the FULL session-start snapshot: every visible
    // name resolves once, in schemas order — not just the wrapper triple.
    expect(order.filter((s) => s.startsWith('capture:'))).toEqual([
      'capture:write',
      'capture:grep',
      'capture:glob',
      'capture:host_extra',
    ])
    expect(lastCaptureIdx).toBeLessThan(firstAgentRegIdx)
    expect(order.filter((s) => s.startsWith('agent-register:'))).toEqual([
      'agent-register:read',
      'agent-register:write',
      'agent-register:edit',
      'agent-register:undo_last_edit',
      'agent-register:grep',
      'agent-register:glob',
    ])
    expect(order.filter((s) => s.startsWith('warn:'))).toEqual([])
  })

  it('dvc + ctx handlers resolve through a fresh resolver', async () => {
    const resolver = new UrlResolver()
    resolver.register('dvc', createDvcHandler())
    resolver.register('ctx', createCtxHandler())
    // apply() (previous test, same module) registered the vendored devices,
    // so a fresh resolver's bare dvc:// reads the device roster — not the
    // empty placeholder (that path is covered with a fresh module in
    // dvc-framework.spec.ts).
    await expect(resolver.resolve({}, 'dvc://')).resolves.toContain('ast_grep')
    await expect(resolver.resolve({}, 'dvc://')).resolves.toContain('browser')
    await expect(resolver.resolve({}, 'dvc://')).resolves.toContain('lsp')
    await expect(
      resolver.resolve(
        { agent: { id: 'a1', status: 'idle', options: {}, session: { header: { cwd: '/tmp' } } } },
        'ctx://session:raw',
      ),
    ).resolves.toContain('"id": "a1"')
  })
  it('the edit post-execute hook attaches the lsp diagnostics summary for a landed edit', async () => {
    const order: string[] = []
    let sessionStart2: ((payload: { agent: unknown }) => void) | undefined
    const listeners: Record<string, Array<(exec: unknown, result: unknown, next: () => Promise<unknown>) => Promise<unknown>>> = {}
    const rootCtx = {
      on: (evt: string, cb: (payload: { agent: unknown }) => void) => {
        if (evt === 'agent/session-start') sessionStart2 = cb
      },
      logger: () => ({ warn: (m: string) => order.push(`warn:${m}`) }),
      skills: { get: async () => undefined },
      fs: {
        resolve: async (p: string) => ({ displayPath: p }),
        readText: async () => 'fn landed() {}\n',
        processPath: (target: unknown) => target,
        writeText: async () => ({ operation: 'create' }),
      },
      sessions: { list: () => [], get: () => undefined },
      subagents: { listChildren: async () => [] },
      settings: {},
      agents: { get: () => undefined },
      tools: {
        schemas: () => ['write'].map(name => ({ name })),
        get: (name: string) => { order.push(`capture:${name}`); return { name, execute: async () => ({}) } },
        register: () => () => {},
      },
    } as unknown as Parameters<typeof plugin.apply>[0]
    const dvc = await import('../../src/url-schema/handlers/dvc.ts')
    const originalLsp = dvc.listDvcDevices().get('lsp')
    plugin.apply(rootCtx, undefined)
    // AFTER apply: installLspDevices() inside it would overwrite a pre-registered fake.
    dvc.registerDvcDevice('lsp', {
      summary: 'fake',
      async execute() {
        return { ok: true, diagnostics: [{ severityName: 'error', message: 'E0308: bad type', line: 1 }], summary: '1 error(s)', check: 'completed' }
      },
    })
    const agent = {
      id: 'a2',
      ctx: {
        effect: (fn: () => unknown) => fn(),
        on: (event: string, handler: (exec: unknown, result: unknown, next: () => Promise<unknown>) => Promise<unknown>) => {
          ;(listeners[event] ??= []).push(handler)
          return () => {}
        },
        tools: { register: () => () => {} },
      },
    }
    sessionStart2!({ agent })
    const hook = listeners['tools/post-execute']?.at(-1)
    expect(hook).toBeDefined()
    const decision = { kind: 'accept', content: [{ type: 'text', text: 'edit ok' }] }
    const outcome = await hook!({ name: 'edit', arguments: { path: '/tmp/probe.rs' }, signal: new AbortController().signal }, { isError: false }, async () => decision)
    expect(outcome).toEqual({
      kind: 'accept',
      content: [
        { type: 'text', text: 'edit ok' },
        { type: 'text', text: '\n1 error(s) — first: E0308: bad type' },
      ],
    })
    const passThrough = await hook!({ name: 'grep', arguments: {} }, { isError: false }, async () => decision)
    expect(passThrough).toBe(decision)
    dvc.registerDvcDevice('lsp', originalLsp ?? (undefined as never))
  })
})
