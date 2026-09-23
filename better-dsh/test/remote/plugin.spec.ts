import { describe, expect, it } from 'vitest'
import { apply, Config, name } from '../../src/remote/plugin.ts'
import type { Context } from '@deepseek-ai/cordis'

describe('dashr-remote row', () => {
  it('Config defaults: no containers, 120s exec, 600s TTL, 30000 chars', () => {
    const c = Config(undefined) as { containers: unknown; execTimeoutSec: number; idleTtlSec: number; maxOutputChars: number }
    expect(c).toMatchObject({ containers: {}, execTimeoutSec: 120, idleTtlSec: 600, maxOutputChars: 30_000 })
  })
  it('mounts dormant without tools, registers the remote tool when tools compose, disposer is safe', () => {
    expect(name).toBe('dashr-remote')
    const registered: Array<{ name: string }> = []
    const fakeCtx = {
      inject: (_deps: string[], fn: (c: unknown) => void) => {
        fn({ tools: { register: (t: { name: string }) => registered.push(t) } })
      },
    } as unknown as Context
    const disposer = apply(fakeCtx, Config(undefined) as never) as () => void
    expect(registered).toHaveLength(1)
    expect(registered[0]!.name).toBe('remote')
    expect(() => disposer()).not.toThrow()
  })
  it('patch row and build wiring are in place', async () => {
    const patch = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'))
    expect(patch).toContain('- id: dashr-remote')
    expect(patch).toContain("name: 'better-dsh/remote'")
    const pkg = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')))
    expect(pkg.exports['./remote']).toEqual({ types: './lib/remote/plugin.d.ts', default: './lib/remote/plugin.js' })
    const tsd = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../tsdown.config.ts', import.meta.url), 'utf8'))
    expect(tsd).toContain("'src/remote/plugin.ts'")
  })
})
