import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLDS,
  admitsSwipeStart,
  classifySwipeProgress,
  isNarrowViewport,
  resolveMobileConfig,
  type PanelState,
  type SwipeProgress,
} from '../src/mobile/gesture.ts'

// Source anchors (z_dsh-alpha commit 1706b81, AppFrame.tsx): X120 left
// band, right three quarters start zone, 40px distance, ×1.3 dominance,
// <768 band, fire-on-move. The velocity gate is the one addition.
const BOTH_CLOSED: PanelState = { leftCollapsed: true, rightOpen: false }
const LEFT_OPEN: PanelState = { leftCollapsed: false, rightOpen: false }
const RIGHT_OPEN: PanelState = { leftCollapsed: true, rightOpen: true }

/** A comfortable sweep: 180px in 450ms = 0.4 px/ms (gate default 0.15). */
function sweep(overrides: Partial<SwipeProgress> = {}): SwipeProgress {
  return { dx: 180, dy: 6, dtMs: 450, ...overrides }
}

describe('start admission (source pointerdown gate)', () => {
  // viewport 800 → right zone boundary 800 × 0.25 = 200.
  it('admits the left X120 band and the right three quarters, keeps the center inert', () => {
    expect(admitsSwipeStart(100, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(admitsSwipeStart(120, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(admitsSwipeStart(121, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
    expect(admitsSwipeStart(199, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
    expect(admitsSwipeStart(200, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(admitsSwipeStart(700, 800, BOTH_CLOSED, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
  })

  it('admits ANY position once a panel is open (dismiss swipes start on the body)', () => {
    expect(admitsSwipeStart(400, 800, LEFT_OPEN, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(admitsSwipeStart(400, 800, RIGHT_OPEN, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
  })
})

describe('firing conditions (distance ∧ dominance ∧ velocity)', () => {
  it('rejects displacement below the 40px distance threshold', () => {
    expect(classifySwipeProgress(sweep({ dx: 39 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
    expect(classifySwipeProgress(sweep({ dx: -39 }), LEFT_OPEN, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
  })

  it('rejects gestures the vertical component dominates (×1.3 rule)', () => {
    // 60px horizontal vs 50px vertical: 60 ≤ 50 × 1.3 = 65 → scroll intent.
    expect(classifySwipeProgress(sweep({ dx: 60, dy: 50 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
    // 70 > 65 → admitted.
    expect(classifySwipeProgress(sweep({ dx: 70, dy: 50 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).not.toBeNull()
  })

  it('the velocity gate (the one addition) filters slow press-drags, 0 disarms', () => {
    // 180px in 1800ms = 0.1 px/ms — a deliberate drag, below the 0.15 gate.
    expect(classifySwipeProgress(sweep({ dtMs: 1800 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
    // Same drag with the gate disarmed = the source's verbatim behavior.
    const disarmed = { ...DEFAULT_SWIPE_THRESHOLDS, swipeVelocityPxPerMs: 0 }
    expect(classifySwipeProgress(sweep({ dtMs: 1800 }), BOTH_CLOSED, true, disarmed)).toBe('open-left')
  })

  it('a zero elapsed span cannot pass an armed gate', () => {
    expect(classifySwipeProgress(sweep({ dtMs: 0 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
  })
})

describe('state machine (source, symmetric)', () => {
  it('right-swipe opens the collapsed sidebar', () => {
    expect(classifySwipeProgress(sweep(), BOTH_CLOSED, false, DEFAULT_SWIPE_THRESHOLDS)).toBe('open-left')
  })

  it('left-swipe closes the open sidebar from anywhere', () => {
    expect(classifySwipeProgress(sweep({ dx: -180 }), LEFT_OPEN, false, DEFAULT_SWIPE_THRESHOLDS)).toBe('close-left')
  })

  it('left-swipe opens the right panel only in a session and only when closed', () => {
    expect(classifySwipeProgress(sweep({ dx: -180 }), BOTH_CLOSED, true, DEFAULT_SWIPE_THRESHOLDS)).toBe('open-right')
    expect(classifySwipeProgress(sweep({ dx: -180 }), BOTH_CLOSED, false, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
    // Right panel already open: a left-swipe does nothing (source branch order).
    expect(classifySwipeProgress(sweep({ dx: -180 }), RIGHT_OPEN, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
  })

  it('right-swipe closes the open right panel, and never opens the sidebar over it', () => {
    expect(classifySwipeProgress(sweep(), RIGHT_OPEN, true, DEFAULT_SWIPE_THRESHOLDS)).toBe('close-right')
    // Sidebar expanded, right closed: a right-swipe has nothing to do.
    expect(classifySwipeProgress(sweep(), LEFT_OPEN, true, DEFAULT_SWIPE_THRESHOLDS)).toBeNull()
  })
})

describe('narrow-viewport gate (source: strictly below SIDEBAR_MOBILE=768)', () => {
  it('admits below 768 only — the tablet band keeps native behavior', () => {
    expect(isNarrowViewport(390, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(isNarrowViewport(767, DEFAULT_SWIPE_THRESHOLDS)).toBe(true)
    expect(isNarrowViewport(768, DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
    expect(isNarrowViewport(1024, DEFAULT_SWIPE_THRESHOLDS)).toBe(false)
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
    expect(resolved.leftEdgeBandPx).toBe(DEFAULT_SWIPE_THRESHOLDS.leftEdgeBandPx)
    expect(resolved.dominanceRatio).toBe(DEFAULT_SWIPE_THRESHOLDS.dominanceRatio)
    expect(resolved.rightZoneRatio).toBe(DEFAULT_SWIPE_THRESHOLDS.rightZoneRatio)
  })

  it('velocity 0 is a configured value (disarm), not a fallback case', () => {
    expect(resolveMobileConfig({ enabled: true, swipeVelocityPxPerMs: 0 }).swipeVelocityPxPerMs).toBe(0)
    expect(resolveMobileConfig({ enabled: true }).swipeVelocityPxPerMs).toBe(DEFAULT_SWIPE_THRESHOLDS.swipeVelocityPxPerMs)
  })
})
