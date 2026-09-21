import { describe, expect, it } from 'vitest'
import { buildMobileScript, buildTrustScript, Config } from '../src/web-trust.ts'
import { Config as MobileRowConfig } from '../src/mobile/plugin.ts'

/** Evaluate the built script exactly as a page would (head inline script). */
function runScript(text: string, sandbox: Record<string, unknown>): Record<string, unknown> {
  const window = sandbox.window as Record<string, unknown>
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'location', text)
  fn(window, sandbox.location)
  return window
}

describe('authorities leg (buildTrustScript)', () => {
  it('injects nothing when no authorities are configured', () => {
    expect(buildTrustScript([])).toBeUndefined()
    expect(buildTrustScript(undefined)).toBeUndefined()
  })

  it('emits the ownsHost transport flag only for declared authorities', () => {
    const text = buildTrustScript(['dsh.pc.randomhash.app'])!
    const matching = runScript(text, {
      window: {},
      location: { hostname: 'dsh.pc.randomhash.app' },
    })
    expect(matching.__DSH_TRANSPORT__).toEqual({ ownsHost: true })

    const other = runScript(text, {
      window: {},
      location: { hostname: 'evil.example' },
    })
    expect(other.__DSH_TRANSPORT__).toBeUndefined()
  })

  it('never overwrites an existing transport (a worker shell owns one)', () => {
    const text = buildTrustScript(['a.example'])!
    const existing = { fetch: () => Promise.resolve() }
    const window = runScript(text, {
      window: { __DSH_TRANSPORT__: existing },
      location: { hostname: 'a.example' },
    })
    expect(window.__DSH_TRANSPORT__).toBe(existing)
  })

  it('sets only ownsHost — no fetch/openStream ride along', () => {
    const text = buildTrustScript(['a.example'])!
    const window = runScript(text, { window: {}, location: { hostname: 'a.example' } })
    expect(Object.keys(window.__DSH_TRANSPORT__ as object)).toEqual(['ownsHost'])
  })

  it('escapes hostile authority strings (JSON embed, no code splicing)', () => {
    // A hostname with a quote must survive as data, not terminate a string.
    const text = buildTrustScript(['a"b.example'])!
    expect(text).not.toContain('a"b.example"')
    const window = runScript(text, { window: {}, location: { hostname: 'a"b.example' } })
    expect(window.__DSH_TRANSPORT__).toEqual({ ownsHost: true })
  })

  it('refuses malformed authorities loudly (port/path/empty)', () => {
    for (const bad of ['', 'a.example:3080', 'a.example/path', '//a.example']) {
      expect(() => buildTrustScript([bad])).toThrow(/bare hostname/)
    }
  })
})

describe('mobile leg (buildMobileScript)', () => {
  it('ships the mobile page config by default (absent mobile = enabled)', () => {
    const enabled = buildMobileScript({})!
    const window = runScript(enabled, { window: {}, location: { hostname: 'x' } })
    expect(window.__DASHR_MOBILE__).toEqual({ enabled: true })

    const tuned = buildMobileScript({ swipeDistancePx: 64 })!
    const win2 = runScript(tuned, { window: {}, location: { hostname: 'x' } })
    expect(win2.__DASHR_MOBILE__).toEqual({ enabled: true, swipeDistancePx: 64 })
  })

  it('injects nothing when explicitly disabled', () => {
    expect(buildMobileScript({ enabled: false })).toBeUndefined()
  })
})

describe('row config schemas', () => {
  it('dashr-web-trust derives its authorities default from DSH_TRUSTED_HOSTS', () => {
    // Schema-level default (v0.2.2a single-source): per-key defaults survive
    // every overlay layer; the value tracks the same environment source the
    // fence leg reads, whatever the test machine declares.
    const resolve = Config as unknown as (v?: unknown) => Record<string, unknown>
    expect(resolve({}).trustedPageAuthorities).toEqual(
      (process.env.DSH_TRUSTED_HOSTS ?? '').split(/\s+/).filter(h => h.length > 0 && !/[:/@?#]/.test(h)),
    )
  })

  it('dashr-mobile resolves all knobs with the wave defaults', () => {
    const resolve = MobileRowConfig as unknown as (v?: unknown) => Record<string, unknown>
    expect(resolve({})).toEqual({
      enabled: true,
      swipeDistancePx: 40,
      dominanceRatio: 1.3,
      leftEdgeBandPx: 120,
      rightZoneRatio: 0.25,
      swipeVelocityPxPerMs: 0.15,
      zoomGuard: 'meta',
    })
  })

  it('dashr-mobile rejects the reserved zoomGuard value loudly', () => {
    const resolve = MobileRowConfig as unknown as (v?: unknown) => Record<string, unknown>
    expect(() => resolve({ zoomGuard: 'font' })).toThrow()
  })
})

describe('derived default authorities (v0.2.2a single-source)', () => {
  it('derives bare hostnames from the DSH_TRUSTED_HOSTS value', async () => {
    const { deriveDefaultPageAuthorities } = await import('../src/web-trust.ts')
    expect(deriveDefaultPageAuthorities('a.example b.example')).toEqual(['a.example', 'b.example'])
    // Portful/schematic entries are dropped (location.hostname carries no
    // port; assertBareHostname would throw at boot on a portful entry).
    expect(deriveDefaultPageAuthorities('a.example 127.0.0.1:3080 //b.example c.example/p')).toEqual(['a.example'])
    expect(deriveDefaultPageAuthorities(undefined)).toEqual([])
    expect(deriveDefaultPageAuthorities('')).toEqual([])
  })
})
