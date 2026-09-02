import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLDS,
  classifySwipe,
  isInteractiveOrigin,
  isNarrowViewport,
  resolveMobileConfig,
  type PanelState,
  type SwipeSample,
} from '../src/mobile/gesture.ts'

const BOTH_CLOSED: PanelState = { leftExpanded: false, detailsOpen: false }
const LEFT_OPEN: PanelState = { leftExpanded: true, detailsOpen: false }
const DETAILS_OPEN: PanelState = { leftExpanded: false, detailsOpen: true }

/** A canonical comfortable sweep: left-edge origin, 180px in 450ms (0.4 px/ms). */
function swipe(overrides: Partial<SwipeSample> = {}): SwipeSample {
  return {
    x0: 12,
    y0: 300,
    x1: 192,
    y1: 306,
    dtMs: 450,
    viewportWidth: 390,
    pointerType: 'touch',
    ...overrides,
  }
}

/** Mirror of the sample, swept LEFTWARD from the given origin. */
function swipeLeftFrom(x0: number): SwipeSample {
  return swipe({ x0, x1: x0 - 180 })
}

describe('three-condition contract (distance ∧ velocity ∧ origin)', () => {
  it('opens the sidebar on a comfortable rightward sweep from the left edge band', () => {
    // 0.4 px/ms — comfortably lazy; with the sidecarx-aligned default the
    // velocity gate is disabled entirely.
    expect(classifySwipe(swipe(), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBe('open-left')
  })

  it('a slow press-drag registers by default — sidecarx parity: no velocity gate', () => {
    // 200px in 1200ms: the sidecarx reference (app.js SWIPE_THRESHOLD=50, no
    // velocity condition) accepts this, and so does the aligned default.
    expect(classifySwipe(swipe({ dtMs: 1200, x1: 212 }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBe('open-left')
  })

  it('the ARMED velocity gate rejects the same slow drag (three-condition mode)', () => {
    const armed = { ...DEFAULT_SWIPE_THRESHOLDS, swipeVelocityPxPerMs: 0.35 }
    expect(classifySwipe(swipe({ dtMs: 1200, x1: 212 }), armed, BOTH_CLOSED)).toBeNull()
  })

  it('rejects a short flick below the distance threshold', () => {
    expect(classifySwipe(swipe({ x1: 40 }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBeNull()
  })

  it('rejects origins outside the edge band while the sidebar is collapsed', () => {
    expect(classifySwipe(swipe({ x0: 100, x1: 320 }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBeNull()
  })

  it('rejects mostly-vertical gestures (scrolling stays scrolling)', () => {
    expect(classifySwipe(swipe({ y1: 520 }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBeNull()
  })

  it('rejects mouse pointers (desktop selection is not a swipe)', () => {
    expect(classifySwipe(swipe({ pointerType: 'mouse' }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBeNull()
  })

  it('a zero-duration span is rejected only when the velocity gate is armed', () => {
    const armed = { ...DEFAULT_SWIPE_THRESHOLDS, swipeVelocityPxPerMs: 0.2 }
    expect(classifySwipe(swipe({ dtMs: 0 }), armed, BOTH_CLOSED)).toBeNull()
    // Disarmed (default): distance + dominance decide, as in sidecarx.
    expect(classifySwipe(swipe({ dtMs: 0 }), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBe('open-left')
  })

  it('honors configured thresholds, not just the defaults', () => {
    const stricter = { ...DEFAULT_SWIPE_THRESHOLDS, swipeVelocityPxPerMs: 2 }
    expect(classifySwipe(swipe(), stricter, BOTH_CLOSED)).toBeNull()
    const looser = { ...DEFAULT_SWIPE_THRESHOLDS, swipeDistancePx: 300 }
    expect(classifySwipe(swipe({ x1: 340 }), looser, BOTH_CLOSED)).toBe('open-left')  // dx=328 ≥ 300
  })
})

describe('directional semantics (panel-aware)', () => {
  it('closes the expanded sidebar from ANY origin — the dismiss swipe starts on the overlay body', () => {
    // Origin mid-screen (x=180) and on the sidebar body (x=150): both close.
    expect(classifySwipe(swipeLeftFrom(180), DEFAULT_SWIPE_THRESHOLDS, LEFT_OPEN)).toBe('close-left')
    expect(classifySwipe(swipeLeftFrom(150), DEFAULT_SWIPE_THRESHOLDS, LEFT_OPEN)).toBe('close-left')
  })

  it('leftward swipes do nothing while the sidebar is collapsed and the origin is not in the right band', () => {
    expect(classifySwipe(swipeLeftFrom(180), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBeNull()
  })

  it('opens the details panel on a leftward sweep from the RIGHT edge band', () => {
    expect(classifySwipe(swipeLeftFrom(380), DEFAULT_SWIPE_THRESHOLDS, BOTH_CLOSED)).toBe('open-details')
  })

  it('closes the open details panel on a rightward sweep from outside the left band', () => {
    expect(classifySwipe(swipe({ x0: 200, x1: 390 }), DEFAULT_SWIPE_THRESHOLDS, DETAILS_OPEN)).toBe('close-details')
  })

  it('keeps the left band reserved for opening the sidebar even when details is open', () => {
    expect(classifySwipe(swipe(), DEFAULT_SWIPE_THRESHOLDS, DETAILS_OPEN)).toBe('open-left')
  })
})

describe('interactive origins', () => {
  const interactive = { closest: (sel: string) => (sel.includes('button') ? {} : null) }
  const plain = { closest: () => null }

  it('interactive elements never enter recognition', () => {
    expect(isInteractiveOrigin(interactive)).toBe(true)
    expect(isInteractiveOrigin(plain)).toBe(false)
    expect(isInteractiveOrigin(null)).toBe(false)
    expect(isInteractiveOrigin(undefined)).toBe(false)
  })
})

describe('narrow-viewport gate', () => {
  it('allows gestures at or below the breakpoint only', () => {
    expect(isNarrowViewport(390, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(isNarrowViewport(1024, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(isNarrowViewport(1025, DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })
})

describe('page-config resolution (host → client channel)', () => {
  it('absent or disabled config resolves inert', () => {
    expect(resolveMobileConfig(undefined).enabled).toBe(false)
    expect(resolveMobileConfig({ enabled: false }).enabled).toBe(false)
  })

  it('merges partial config over defaults and drops non-finite values', () => {
    const resolved = resolveMobileConfig({ enabled: true, swipeDistancePx: 64, breakpoint: Number.NaN })
    expect(resolved.enabled).toBe(true)
    expect(resolved.swipeDistancePx).toBe(64)
    expect(resolved.breakpoint).toBe(DEFAULT_SWIPE_THRESHOLDS.breakpoint)
    expect(resolved.edgeBandPx).toBe(DEFAULT_SWIPE_THRESHOLDS.edgeBandPx)
  })
})
