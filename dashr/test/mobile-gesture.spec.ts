import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLDS,
  isInteractiveOrigin,
  isNarrowViewport,
  isRecognizedSwipe,
  resolveMobileConfig,
  type SwipeSample,
} from '../src/mobile/gesture.ts'

/** A canonical recognized swipe: left-edge origin, 180px in 150ms (1.2 px/ms). */
function swipe(overrides: Partial<SwipeSample> = {}): SwipeSample {
  return {
    x0: 12,
    y0: 300,
    x1: 192,
    y1: 306,
    dtMs: 150,
    viewportWidth: 390,
    pointerType: 'touch',
    ...overrides,
  }
}

describe('swipe recognition (three-condition contract)', () => {
  it('recognizes a fast horizontal sweep from the edge band', () => {
    expect(isRecognizedSwipe(swipe(), DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    // Right edge origin (swipe-to-close) is equally valid.
    expect(isRecognizedSwipe(swipe({ x0: 380, x1: 200 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
  })

  it('rejects a slow press-drag that covers the distance (text selection)', () => {
    // 200px in 1200ms = 0.17 px/ms < 0.35: distance passes, velocity fails.
    expect(isRecognizedSwipe(swipe({ dtMs: 1200, x1: 212 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('rejects a short fast flick below the distance threshold', () => {
    expect(isRecognizedSwipe(swipe({ x1: 40 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('rejects origins outside the edge band', () => {
    expect(isRecognizedSwipe(swipe({ x0: 100, x1: 320 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('rejects mostly-vertical gestures (scrolling stays scrolling)', () => {
    expect(isRecognizedSwipe(swipe({ y1: 520 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('rejects mouse pointers (desktop selection is not a swipe)', () => {
    expect(isRecognizedSwipe(swipe({ pointerType: 'mouse' }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('rejects a zero-duration span (cannot compute velocity)', () => {
    expect(isRecognizedSwipe(swipe({ dtMs: 0 }), DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
  })

  it('honors configured thresholds, not just the defaults', () => {
    const stricter = { ...DEFAULT_SWIPE_THRESHOLDS, swipeVelocityPxPerMs: 2 }
    expect(isRecognizedSwipe(swipe(), stricter)).toBe(false)
    const looser = { ...DEFAULT_SWIPE_THRESHOLDS, swipeDistancePx: 300 }
    expect(isRecognizedSwipe(swipe({ x1: 340 }), looser)).toBe(true)  // dx=328 ≥ 300
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
  it('allows toggles at or below the breakpoint only', () => {
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
