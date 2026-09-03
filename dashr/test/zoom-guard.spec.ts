import { describe, expect, it } from 'vitest'
import {
  ZOOM_GUARD_TOKENS,
  buildZoomGuardSection,
  isIOSClassUA,
  mergeViewportTokens,
  shouldApplyZoomGuard,
} from '../src/mobile/zoom-guard.ts'
import { buildBootScript } from '../src/web-trust.ts'

// ---------------------------------------------------------------------------
// UA matrix fixtures (design D2): the iOS family, the iPadOS desktop
// masquerade, and the must-NOT-match crowd (Android never focus-zooms, which
// is the whole reason the gate is UA-based rather than pointer:coarse).
// ---------------------------------------------------------------------------

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPOD_UA = 'Mozilla/5.0 (iPod touch; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1'
const IPADOS_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const MAC_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

/** The upstream stock viewport content (`apps/web/index.html`). */
const STOCK = 'width=device-width, initial-scale=1'
/** What a guarded stock meta reads after the token merge. */
const STOCK_GUARDED = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'

describe('isIOSClassUA (design D2)', () => {
  it('matches the iOS family', () => {
    expect(isIOSClassUA(IPHONE_UA, 5)).toBe(true)
    expect(isIOSClassUA(IPOD_UA, 5)).toBe(true)
    expect(isIOSClassUA(IPAD_UA, 5)).toBe(true)
  })

  it('matches the iPadOS 13+ desktop-UA masquerade only with a multi-touch digitizer', () => {
    expect(isIOSClassUA(IPADOS_DESKTOP_UA, 5)).toBe(true)
    expect(isIOSClassUA(IPADOS_DESKTOP_UA, 0)).toBe(false)
    expect(isIOSClassUA(IPADOS_DESKTOP_UA, 1)).toBe(false)
    expect(isIOSClassUA(MAC_DESKTOP_UA, 0)).toBe(false)
  })

  it('rejects non-iOS browsers regardless of touch capability', () => {
    expect(isIOSClassUA(ANDROID_UA, 5)).toBe(false)
    expect(isIOSClassUA(DESKTOP_CHROME_UA, 0)).toBe(false)
    expect(isIOSClassUA(DESKTOP_CHROME_UA, 10)).toBe(false)
    // A desktop UA mentioning neither platform, even with touch.
    expect(isIOSClassUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Touch', 5)).toBe(false)
  })

  it('degrades benignly on UA-shape drift (unknown strings read as non-iOS)', () => {
    expect(isIOSClassUA('', 0)).toBe(false)
    expect(isIOSClassUA('some-future-client/2.0', 5)).toBe(false)
  })
})

describe('mergeViewportTokens (design D4: token merge, idempotent)', () => {
  it('appends the guard tokens after stock directives', () => {
    expect(mergeViewportTokens(STOCK, ZOOM_GUARD_TOKENS)).toBe(STOCK_GUARDED)
  })

  it('overrides an existing same-key token in place (no duplicate keys)', () => {
    expect(mergeViewportTokens('width=device-width, maximum-scale=5', ZOOM_GUARD_TOKENS))
      .toBe('width=device-width, maximum-scale=1, user-scalable=no')
    expect(mergeViewportTokens('user-scalable=yes, initial-scale=1', ZOOM_GUARD_TOKENS))
      .toBe('user-scalable=no, initial-scale=1, maximum-scale=1')
  })

  it('matches keys case-insensitively and re-emits them lowercase', () => {
    expect(mergeViewportTokens('Maximum-Scale=4', ZOOM_GUARD_TOKENS))
      .toBe('maximum-scale=1, user-scalable=no')
  })

  it('tolerates whitespace and stray separators', () => {
    expect(mergeViewportTokens(' width=device-width ,  initial-scale=1 ', ZOOM_GUARD_TOKENS))
      .toBe(STOCK_GUARDED)
    expect(mergeViewportTokens('width=device-width,,initial-scale=1', ZOOM_GUARD_TOKENS))
      .toBe(STOCK_GUARDED)
  })

  it('passes through bare tokens and values containing "="', () => {
    expect(mergeViewportTokens('viewport-fit=cover, odd=a=b', ZOOM_GUARD_TOKENS))
      .toBe('viewport-fit=cover, odd=a=b, maximum-scale=1, user-scalable=no')
    expect(mergeViewportTokens('shrink-to-fit', ZOOM_GUARD_TOKENS))
      .toBe('shrink-to-fit, maximum-scale=1, user-scalable=no')
  })

  it('merges into empty content (the created-meta path) and with no tokens', () => {
    expect(mergeViewportTokens('', ZOOM_GUARD_TOKENS)).toBe('maximum-scale=1, user-scalable=no')
    expect(mergeViewportTokens(STOCK, {})).toBe(STOCK)
  })

  it('is idempotent: re-merging the merged output changes nothing', () => {
    const once = mergeViewportTokens(STOCK, ZOOM_GUARD_TOKENS)
    expect(mergeViewportTokens(once, ZOOM_GUARD_TOKENS)).toBe(once)
    expect(mergeViewportTokens(mergeViewportTokens(once, ZOOM_GUARD_TOKENS), ZOOM_GUARD_TOKENS)).toBe(once)
  })
})

describe('shouldApplyZoomGuard (double gate + config)', () => {
  it('applies only on iOS ∧ narrow ∧ non-off', () => {
    expect(shouldApplyZoomGuard(undefined, true, true)).toBe(true)
    expect(shouldApplyZoomGuard({ zoomGuard: 'meta' }, true, true)).toBe(true)
    expect(shouldApplyZoomGuard({ zoomGuard: 'off' }, true, true)).toBe(false)
  })

  it('never applies off the iOS family or outside the narrow band', () => {
    expect(shouldApplyZoomGuard(undefined, false, true)).toBe(false)
    expect(shouldApplyZoomGuard(undefined, true, false)).toBe(false)
    expect(shouldApplyZoomGuard({ zoomGuard: 'off' }, false, false)).toBe(false)
  })

  it('unknown non-off values read as the meta default (schema makes them unreachable)', () => {
    expect(shouldApplyZoomGuard({ zoomGuard: 'font' }, true, true)).toBe(true)
  })
})

describe('config schema (mobile.zoomGuard)', () => {
  it('defaults an absent/null key to meta and passes explicit values through', async () => {
    const { Config } = await import('../src/index.ts')
    expect(Config({}).mobile!.zoomGuard).toBe('meta')
    expect(Config({ mobile: { zoomGuard: 'off' } }).mobile!.zoomGuard).toBe('off')
    expect(Config({ mobile: { zoomGuard: null } } as never).mobile!.zoomGuard).toBe('meta')
  })

  it('fails loud on values outside the enum (font is reserved-unimplemented)', async () => {
    const { Config } = await import('../src/index.ts')
    expect(() => Config({ mobile: { zoomGuard: 'font' } } as never)).toThrow(/meta.*off|expected/)
    expect(() => Config({ mobile: { zoomGuard: 'bogus' } } as never)).toThrow(/meta.*off|expected/)
  })
})

// ---------------------------------------------------------------------------
// Generated-script shape + evaluation. The strongest tier: run the REAL
// script text (the exact bytes a page receives) against a stub DOM and
// assert the meta rewriting behavior end to end — this covers the
// toString-embedded predicates, the state machine, and the stock-meta
// reconciliation in one shot.
// ---------------------------------------------------------------------------

/** Minimal element double: attributes, children, parser-notify on mutation. */
class StubEl {
  readonly children: StubEl[] = []
  parentNode: StubEl | null = null
  readonly attrs: Record<string, string> = {}
  constructor(readonly tag: string) {}
  setAttribute(key: string, value: string): void { this.attrs[key] = String(value) }
  getAttribute(key: string): string | null { return key in this.attrs ? this.attrs[key]! : null }
  appendChild(child: StubEl): StubEl {
    child.parentNode = this
    this.children.push(child)
    for (const observer of [...this.doc().observers]) observer.callback()
    return child
  }
  removeChild(child: StubEl): void {
    this.children.splice(this.children.indexOf(child), 1)
    child.parentNode = null
    for (const observer of [...this.doc().observers]) observer.callback()
  }
  private doc(): StubDocument { return page as unknown as StubDocument }
}

interface StubObserver { callback: () => void }

/** The page double: html/head tree, live matchMedia, resize handlers. */
class StubDocument {
  readonly documentElement: StubEl
  readonly head: StubEl
  readonly observers: StubObserver[] = []
  readonly mediaQueries: string[] = []
  narrow = true
  readonly resizeHandlers: (() => void)[] = []
  constructor() {
    this.documentElement = new StubEl('html')
    this.head = new StubEl('head')
    this.documentElement.children.push(this.head)
    this.head.parentNode = this.documentElement
  }
  /** Parser step: insert an element into the head, notifying observers. */
  parse(el: StubEl): void { this.head.appendChild(el) }
  createElement(tag: string): StubEl { return new StubEl(tag) }
  getElementsByTagName(tag: string): StubEl[] {
    const found: StubEl[] = []
    const walk = (el: StubEl): void => {
      if (el.tag === tag) found.push(el)
      for (const child of el.children) walk(child)
    }
    walk(this.documentElement)
    return found
  }
  /** Every meta in document order (assertion helper). */
  metas(): StubEl[] { return this.getElementsByTagName('meta') }
  /** A fresh stock meta, as the upstream index.html parser would insert it. */
  stockMeta(content = STOCK): StubEl {
    const el = new StubEl('meta')
    el.setAttribute('name', 'viewport')
    el.setAttribute('content', content)
    return el
  }
}

/** Module-level page under test (StubEl reaches the document through it). */
let page = new StubDocument()

/** MutationObserver double: synchronous dispatch (microtasks approximated). */
class StubMutationObserver implements StubObserver {
  constructor(readonly callback: () => void) {}
  observe(): void { page.observers.push(this) }
  disconnect(): void {
    const i = page.observers.indexOf(this)
    if (i >= 0) page.observers.splice(i, 1)
  }
}

interface RunResult {
  page: StubDocument
  window: Record<string, unknown> & { __DASHR_MOBILE__?: unknown }
  fireResize(): void
}

/** Evaluate a built script exactly as a page's inline head script would. */
function runBootScript(
  config: Parameters<typeof buildBootScript>[0],
  ua = IPHONE_UA,
  maxTouchPoints = 5,
): RunResult {
  const text = buildBootScript(config)
  if (text === undefined) throw new Error('boot script injected nothing — nothing to run')
  const doc = page = new StubDocument()
  const mql = { get matches() { return doc.narrow } }
  const window: Record<string, unknown> & { __DASHR_MOBILE__?: unknown } = {
    matchMedia: (query: string) => { doc.mediaQueries.push(query); return mql },
    addEventListener: (type: string, handler: () => void) => {
      if (type === 'resize') doc.resizeHandlers.push(handler)
    },
  }
  const navigator = { userAgent: ua, maxTouchPoints }
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'location', 'document', 'navigator', 'MutationObserver', text)
  fn(window, { hostname: 'test.example' }, doc, navigator, StubMutationObserver)
  return {
    page: doc,
    window,
    fireResize: () => { for (const handler of [...doc.resizeHandlers]) handler() },
  }
}

describe('generated zoomGuard section (shape)', () => {
  it('embeds the three predicates and stays ES5 (no arrows, no template literals)', () => {
    const text = buildZoomGuardSection()
    for (const fragment of [
      'var ZI=', 'var ZM=', 'var ZS=',
      "matchMedia('(max-width:'", '-0.02',
      'maximum-scale', 'user-scalable',
      'MutationObserver', 'resize',
      "createElement('meta')", "toLowerCase()==='viewport'", 'getElementsByTagName',
    ]) {
      expect(text).toContain(fragment)
    }
    // The embedded function sources must stay embeddable-in-ancient-parsers.
    expect(text).not.toContain('=>')
    expect(text).not.toContain('`')
    expect(text).not.toContain('</script')
  })

  it('derives the media query from the payload breakpoint (768 → 767.98px)', () => {
    const run = runBootScript({ mobile: {} })
    expect(run.page.mediaQueries).toEqual(['(max-width:767.98px)'])
    const tuned = runBootScript({ mobile: { breakpoint: 900 } })
    expect(tuned.page.mediaQueries).toEqual(['(max-width:899.98px)'])
    expect(JSON.stringify(tuned.window.__DASHR_MOBILE__)).toContain('"breakpoint":900')
  })

  it('serializes the configured zoomGuard into the payload verbatim', () => {
    expect(buildBootScript({ mobile: { zoomGuard: 'off' } })).toContain('"zoomGuard":"off"')
    expect(buildBootScript({ mobile: { zoomGuard: 'meta' } })).toContain('"zoomGuard":"meta"')
    // Absent config = default meta: payload omits the key, script still ships.
    const text = buildBootScript({ mobile: {} })!
    expect(text).not.toContain('"zoomGuard"')
    expect(text).toContain('var ZI=')
  })

  it('omits the whole section when zoomGuard is off or the mobile leg is disabled', () => {
    expect(buildBootScript({ mobile: { zoomGuard: 'off' } })).not.toContain('var ZI=')
    expect(buildBootScript({ mobile: { enabled: false } })).toBeUndefined()
    expect(buildBootScript({ trustedPageAuthorities: ['a.example'], mobile: { enabled: false } })!).not.toContain('var ZI=')
  })
})

describe('boot script evaluation (iOS × viewport × config matrix)', () => {
  it('iPhone ∧ narrow: guards immediately, then reconciles into the parsed stock meta', () => {
    const run = runBootScript({ mobile: {} })
    // Script time (stock meta not parsed yet — injections splice right after
    // <head>): a provisional meta already carries the guard tokens.
    expect(run.page.metas().map(m => m.getAttribute('content'))).toEqual(['maximum-scale=1, user-scalable=no'])
    // Parser inserts the stock meta: guard merges into IT, provisional drops.
    run.page.parse(run.page.stockMeta())
    const metas = run.page.metas()
    expect(metas).toHaveLength(1)
    expect(metas[0]!.getAttribute('name')).toBe('viewport')
    expect(metas[0]!.getAttribute('content')).toBe(STOCK_GUARDED)
  })

  it('reconciliation ignores non-viewport parser insertions and keeps watching', () => {
    const run = runBootScript({ mobile: {} })
    run.page.parse(new StubEl('style')) // observer fires, finds no stock meta
    expect(run.page.metas()).toHaveLength(1) // still the provisional one
    run.page.parse(run.page.stockMeta())
    expect(run.page.metas()).toHaveLength(1)
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK_GUARDED)
  })

  it('wide → narrow crossings rewrite and restore; resize storms stay idempotent', () => {
    const run = runBootScript({ mobile: {} })
    run.page.parse(run.page.stockMeta())
    const [meta] = run.page.metas()
    // Leave the band: byte-identical stock restore.
    run.page.narrow = false
    run.fireResize()
    expect(meta!.getAttribute('content')).toBe(STOCK)
    // Re-enter: merged again — from stock, never accumulating.
    run.page.narrow = true
    run.fireResize()
    expect(meta!.getAttribute('content')).toBe(STOCK_GUARDED)
    // Storm: repeated evaluations in ONE state change nothing.
    for (let i = 0; i < 5; i++) run.fireResize()
    expect(meta!.getAttribute('content')).toBe(STOCK_GUARDED)
    // Full cycle again for good measure.
    run.page.narrow = false
    run.fireResize()
    expect(meta!.getAttribute('content')).toBe(STOCK)
  })

  it('stock meta already present at script time (worker form): direct rewrite, no provisional', () => {
    const doc = page = new StubDocument()
    doc.parse(doc.stockMeta()) // stock parsed BEFORE the script runs
    doc.narrow = true
    const text = buildBootScript({ mobile: {} })!
    const window: Record<string, unknown> = {
      matchMedia: () => ({ get matches() { return doc.narrow } }),
      addEventListener: () => {},
    }
    // eslint-disable-next-line no-new-func
    new Function('window', 'location', 'document', 'navigator', 'MutationObserver', text)(
      window, { hostname: 'x' }, doc, { userAgent: IPHONE_UA, maxTouchPoints: 5 }, StubMutationObserver,
    )
    expect(doc.metas()).toHaveLength(1)
    expect(doc.metas()[0]!.getAttribute('content')).toBe(STOCK_GUARDED)
  })

  it('page without any stock meta: the provisional meta persists and still guards', () => {
    const run = runBootScript({ mobile: {} })
    expect(run.page.metas()).toHaveLength(1)
    expect(run.page.metas()[0]!.getAttribute('content')).toBe('maximum-scale=1, user-scalable=no')
    // Leaving the band removes the meta WE created (stock absence restored).
    run.page.narrow = false
    run.fireResize()
    expect(run.page.metas()).toHaveLength(0)
  })

  it('iPad and iPadOS-desktop masquerade are guarded; desktop Safari is not', () => {
    const ipad = runBootScript({ mobile: {} }, IPAD_UA, 5)
    expect(ipad.page.metas()[0]!.getAttribute('content')).toBe('maximum-scale=1, user-scalable=no')
    const ipadOs = runBootScript({ mobile: {} }, IPADOS_DESKTOP_UA, 5)
    expect(ipadOs.page.metas()[0]!.getAttribute('content')).toBe('maximum-scale=1, user-scalable=no')
    const mac = runBootScript({ mobile: {} }, MAC_DESKTOP_UA, 0)
    expect(mac.page.metas()).toHaveLength(0)
  })

  it('Android ∧ narrow: stock bytes untouched, no listeners wired', () => {
    const run = runBootScript({ mobile: {} }, ANDROID_UA, 5)
    expect(run.page.metas()).toHaveLength(0)
    expect(run.page.resizeHandlers).toHaveLength(0)
    // Even a late stock meta parses into a virgin document.
    run.page.parse(run.page.stockMeta())
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK)
  })

  it('desktop browsers at any width: no rewrite, no listeners', () => {
    for (const narrow of [true, false]) {
      const run = runBootScript({ mobile: {} }, DESKTOP_CHROME_UA, 0)
      run.page.narrow = narrow
      run.fireResize()
      expect(run.page.metas()).toHaveLength(0)
      expect(run.page.resizeHandlers).toHaveLength(0)
    }
  })

  it('iPhone at/above the breakpoint: stock untouched, but crossing in later guards', () => {
    const run = runBootScript({ mobile: {} }, IPHONE_UA, 5)
    run.page.narrow = false
    run.fireResize() // wide at load: nothing applied, nothing created
    expect(run.page.metas()).toHaveLength(0)
    run.page.parse(run.page.stockMeta())
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK)
    run.page.narrow = true // rotate/split into the narrow band
    run.fireResize()
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK_GUARDED)
  })

  it('zoomGuard off: no section, no rewriting anywhere (the escape hatch)', () => {
    const run = runBootScript({ mobile: { zoomGuard: 'off' } })
    expect(run.page.metas()).toHaveLength(0)
    expect(run.page.resizeHandlers).toHaveLength(0)
    run.page.parse(run.page.stockMeta())
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK)
  })

  it('coexists with the authorities leg in one script', () => {
    const run = runBootScript({ trustedPageAuthorities: ['test.example'] })
    expect(run.window.__DSH_TRANSPORT__).toEqual({ ownsHost: true })
    expect(run.window.__DASHR_MOBILE__).toEqual({ enabled: true })
    expect(run.page.metas()[0]!.getAttribute('content')).toBe('maximum-scale=1, user-scalable=no')
  })

  it('a custom breakpoint bounds the band (900 → 899.98px media query)', () => {
    const run = runBootScript({ mobile: { breakpoint: 900 } })
    run.page.parse(run.page.stockMeta())
    // Narrow per default 768 band semantics stays true here; flip to wide.
    run.page.narrow = false
    run.fireResize()
    expect(run.page.metas()[0]!.getAttribute('content')).toBe(STOCK)
  })
})
