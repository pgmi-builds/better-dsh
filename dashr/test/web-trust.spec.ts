import { describe, expect, it } from 'vitest'
import { buildBootScript } from '../src/web-trust.ts'

/** Evaluate the built script exactly as a page would (head inline script). */
function runScript(text: string, sandbox: Record<string, unknown>): Record<string, unknown> {
  const window = sandbox.window as Record<string, unknown>
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'location', text)
  fn(window, sandbox.location)
  return window
}

describe('web-trust boot script (buildBootScript)', () => {
  it('injects nothing only when both legs are off', () => {
    expect(buildBootScript({ trustedPageAuthorities: [], mobile: { enabled: false } })).toBeUndefined()
  })

  it('emits the ownsHost transport flag only for declared authorities', () => {
    const text = buildBootScript({ trustedPageAuthorities: ['dsh.pc.randomhash.app'] })!
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
    const text = buildBootScript({ trustedPageAuthorities: ['a.example'] })!
    const existing = { fetch: () => Promise.resolve() }
    const window = runScript(text, {
      window: { __DSH_TRANSPORT__: existing },
      location: { hostname: 'a.example' },
    })
    expect(window.__DSH_TRANSPORT__).toBe(existing)
  })

  it('sets only ownsHost — no fetch/openStream ride along', () => {
    const text = buildBootScript({ trustedPageAuthorities: ['a.example'] })!
    const window = runScript(text, { window: {}, location: { hostname: 'a.example' } })
    expect(Object.keys(window.__DSH_TRANSPORT__ as object)).toEqual(['ownsHost'])
  })

  it('escapes hostile authority strings (JSON embed, no code splicing)', () => {
    // A hostname with a quote must survive as data, not terminate a string.
    const text = buildBootScript({ trustedPageAuthorities: ['a"b.example'] })!
    expect(text).not.toContain('a"b.example"')
    const window = runScript(text, { window: {}, location: { hostname: 'a"b.example' } })
    expect(window.__DSH_TRANSPORT__).toEqual({ ownsHost: true })
  })

  it('refuses malformed authorities loudly (port/path/empty)', () => {
    for (const bad of ['', 'a.example:3080', 'a.example/path', '//a.example']) {
      expect(() => buildBootScript({ trustedPageAuthorities: [bad] })).toThrow(/bare hostname/)
    }
  })

  it('ships the mobile page config by default (absent mobile = enabled)', () => {
    // Absent mobile config = default ON (design D1): a bare authority-only
    // config still carries the mobile global.
    const both = buildBootScript({ trustedPageAuthorities: ['a.example'] })!
    expect(both).toContain('__DASHR_MOBILE__')
    const enabled = buildBootScript({ mobile: {} })!
    const window = runScript(enabled, { window: {}, location: { hostname: 'x' } })
    expect(window.__DASHR_MOBILE__).toEqual({ enabled: true })

    const tuned = buildBootScript({ mobile: { breakpoint: 900, swipeDistancePx: 64 } })!
    const win2 = runScript(tuned, { window: {}, location: { hostname: 'x' } })
    expect(win2.__DASHR_MOBILE__).toEqual({ enabled: true, breakpoint: 900, swipeDistancePx: 64 })
  })

  it('omits the mobile global when explicitly disabled', () => {
    const text = buildBootScript({ mobile: { enabled: false } })!
    expect(text).toBeUndefined()
    expect(buildBootScript({ trustedPageAuthorities: ['a.example'], mobile: { enabled: false } })!).not.toContain('__DASHR_MOBILE__')
  })
})

describe('derived default authorities (v0.2.3 single-source)', () => {
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
