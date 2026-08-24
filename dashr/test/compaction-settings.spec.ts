import { describe, expect, it, onTestFinished } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import Presentation from '../src/index.ts'
import { DASHR_COMPACTION_DEFAULTS, DASHR_COMPACTION_NS } from '../src/compaction-shared.ts'
import { fakeRuntime } from './helpers.ts'

/** A scriptable `ctx.settings` stand-in: records registrations, answers no user values. */
class FakeSettings extends Service {
  constructor(ctx: Context) { super(ctx, 'settings') }

  registrations: Array<{ ns: string, base: unknown, applies: unknown, validate?: (value: unknown) => void }> = []
  register(ns: string, _schema: unknown, options: { base?: unknown, applies?: unknown, validate?: (value: unknown) => void } = {}) {
    this.registrations.push({ ns, base: options.base, applies: options.applies, validate: options.validate })
    return {
      get: () => options.base,
      watch: () => () => {},
      update: async () => {},
      replace: async () => {},
    }
  }

  get(): undefined {
    return undefined
  }
}

/** Boot the composition with a fake settings provider at the root, before the presentation row. */
async function setupWithSettings() {
  const ctx = new Context()
  await ctx.plugin(FakeSettings)
  const settings = ctx.get('settings') as FakeSettings
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  const runtimeFiber: { dispose(): Promise<void> } = await fakeRuntime(ctx) as unknown as { dispose(): Promise<void> }
  onTestFinished(async () => { await runtimeFiber.dispose() })
  let host!: Context
  await ctx.plugin(Object.assign((inner: Context) => { host = inner }, { inject: ['tools', 'systemPrompt'] }))
  const preset = createScope(host, { preset: 'dashr-settings' })
  onTestFinished(() => preset.dispose())
  const fiber = await preset.ctx.plugin(Presentation, {})
  onTestFinished(() => fiber.dispose())
  return { settings: settings as FakeSettings }
}

describe('host-plane compaction settings registration (the dashr-compaction section)', () => {
  it('registers the namespace once with the tuned base and restart applies', async () => {
    const { settings } = await setupWithSettings()
    const reg = settings.registrations.find(entry => entry.ns === DASHR_COMPACTION_NS)
    expect(reg).toBeDefined()
    expect(reg?.base).toEqual(DASHR_COMPACTION_DEFAULTS)
    expect(reg?.applies).toBe('restart')
  })

  it('rejects an invalid value through the registration validate hook', async () => {
    const { settings } = await setupWithSettings()
    const reg = settings.registrations.find(entry => entry.ns === DASHR_COMPACTION_NS)
    expect(reg?.validate).toBeDefined()
    expect(() => reg?.validate?.({ ...DASHR_COMPACTION_DEFAULTS, retainRatio: 0.9 }))
      .toThrow(/retainRatio/)
    expect(() => reg?.validate?.({ ...DASHR_COMPACTION_DEFAULTS })).not.toThrow()
  })

  it('does not register when no settings service exists (graceful degradation)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    const runtimeFiber: { dispose(): Promise<void> } = await fakeRuntime(ctx) as unknown as { dispose(): Promise<void> }
    onTestFinished(async () => { await runtimeFiber.dispose() })
    let host!: Context
    await ctx.plugin(Object.assign((inner: Context) => { host = inner }, { inject: ['tools', 'systemPrompt'] }))
    const preset = createScope(host, { preset: 'dashr-no-settings' })
    onTestFinished(() => preset.dispose())
    const fiber = await preset.ctx.plugin(Presentation, {})
    onTestFinished(() => fiber.dispose())
    // The absence of a settings service must not break the presentation row.
    expect(ctx.get('settings')).toBeUndefined()
  })
})
