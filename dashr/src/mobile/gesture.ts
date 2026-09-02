/**
 * Mobile swipe-recognition predicates (pure, unit-tested).
 *
 * The three-condition contract (design D3 / spec `mobile-layout`): a swipe is
 * recognized only when ALL of
 *   1. origin — the gesture starts where the target panel admits origins
 *      (collapsed panels: the edge band; an EXPANDED overlay sidebar: anywhere
 *      on it — a dismiss swipe naturally starts on the panel body, not in an
 *      edge band, which is why the first cut never fired on close),
 *   2. distance — horizontal displacement reaches the threshold,
 *   3. velocity — average displacement/time reaches the threshold,
 * hold. A slow press-drag (text selection for copy) covers distance at
 * sub-threshold velocity and must NOT trigger; a comfortable sweep must.
 *
 * Hygiene predicates (fixed by the spec scenarios): the gesture must be
 * mostly horizontal (`|dx| > |dy|`) and come from a touch/pen pointer — a
 * mouse drag on a narrow desktop window is text selection, not a swipe.
 *
 * Directional semantics (panel-aware, 2026-09-03 user round 2):
 * - left sidebar collapsed  → swipe RIGHT from the LEFT edge band opens it;
 * - left sidebar expanded   → swipe LEFT from anywhere closes it (overlay);
 * - details panel closed    → swipe LEFT from the RIGHT edge band opens it;
 * - details panel open      → swipe RIGHT (not from the left edge band —
 *   that stays the sidebar-open gesture) closes it.
 *
 * No DOM here: `classifySwipe` is a pure function over gesture facts plus the
 * panel state the caller reads off the frame's semantic attributes.
 *
 * @module dashr/mobile/gesture
 */

/** Recognition thresholds, resolved from the host-injected page config. */
export interface SwipeThresholds {
  /** Viewport width at/below which gestures are admitted (px). */
  breakpoint: number
  /** Minimum horizontal displacement (px). */
  swipeDistancePx: number
  /** Minimum average velocity (px per ms). */
  swipeVelocityPxPerMs: number
  /** Origin band from either horizontal viewport edge (px). */
  edgeBandPx: number
}

/**
 * Resolved defaults, mirroring the host config schema. The 0.2 px/ms velocity
 * floor sits between a slow text-selection drag (~0.13 px/ms) and a lazy but
 * deliberate swipe (~0.4+); the first cut's 0.35 demanded an uncomfortably
 * fast flick (user 2026-09-03 round 2).
 */
export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  breakpoint: 1024,
  swipeDistancePx: 48,
  swipeVelocityPxPerMs: 0.2,
  edgeBandPx: 28,
}

/** One gesture's observed facts (pointerdown → pointerup span). */
export interface SwipeSample {
  /** pointerdown client X. */
  x0: number
  /** pointerdown client Y. */
  y0: number
  /** pointerup client X. */
  x1: number
  /** pointerup client Y. */
  y1: number
  /** Elapsed down→up time (ms). */
  dtMs: number
  /** Viewport width at gesture time (px). */
  viewportWidth: number
  /** Pointer type (`'touch' | 'mouse' | 'pen' | ...`). */
  pointerType: string
}

/** Panel state at gesture time (read from the frame's semantic attributes). */
export interface PanelState {
  /** Whether the left sidebar overlay is expanded (narrow viewport). */
  leftExpanded: boolean
  /** Whether the right details panel is open. */
  detailsOpen: boolean
}

/** The panel action a recognized swipe maps to. */
export type SwipeAction = 'open-left' | 'close-left' | 'open-details' | 'close-details'

/**
 * Classify one completed gesture into a panel action.
 *
 * @param sample - the gesture facts.
 * @param thresholds - resolved recognition thresholds.
 * @param panels - panel state at gesture time.
 * @returns the action whose directional + origin contract the gesture
 *   satisfies, or `null` when no panel admits it.
 */
export function classifySwipe(sample: SwipeSample, thresholds: SwipeThresholds, panels: PanelState): SwipeAction | null {
  if (sample.pointerType !== 'touch' && sample.pointerType !== 'pen') return null
  const dx = sample.x1 - sample.x0
  const dy = sample.y1 - sample.y0
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  // Mostly horizontal: the horizontal component dominates the vertical one.
  if (adx <= ady) return null
  // ② Distance.
  if (adx < thresholds.swipeDistancePx) return null
  // ③ Velocity (average over the down→up span); a zero span cannot be a swipe.
  if (sample.dtMs <= 0) return null
  if (adx / sample.dtMs < thresholds.swipeVelocityPxPerMs) return null
  // ① Origin + direction, panel by panel.
  const inLeftBand = sample.x0 <= thresholds.edgeBandPx
  const inRightBand = sample.x0 >= sample.viewportWidth - thresholds.edgeBandPx
  if (panels.leftExpanded && dx < 0) return 'close-left'
  if (!panels.leftExpanded && dx > 0 && inLeftBand) return 'open-left'
  if (!panels.detailsOpen && dx < 0 && inRightBand) return 'open-details'
  if (panels.detailsOpen && dx > 0 && !inLeftBand) return 'close-details'
  return null
}

/**
 * Whether a gesture's origin element is interactive (link, button, input,
 * …): interactive origins never enter recognition, so tapping and dragging
 * controls stays theirs.
 *
 * @param target - the pointerdown target (structural `closest`, so tests
 *   supply a fake without a DOM).
 * @returns `true` when the origin sits inside an interactive element.
 */
export function isInteractiveOrigin(target: { closest(sel: string): unknown } | null | undefined): boolean {
  if (target == null) return false
  return target.closest('a, button, input, textarea, select, label, [contenteditable], [role="button"]') != null
}

/**
 * Whether gestures are admitted at gesture time: only in the narrow viewport
 * the feature owns (the wide layout keeps its native interactions).
 *
 * @param viewportWidth - viewport width at gesture time (px).
 * @param thresholds - resolved thresholds (`.breakpoint`).
 * @returns `true` when `viewportWidth` is at or below the breakpoint.
 */
export function isNarrowViewport(viewportWidth: number, thresholds: SwipeThresholds): boolean {
  return viewportWidth <= thresholds.breakpoint
}

/** Resolve the page config left by the host half's injected boot script. */
export interface MobilePageConfig {
  enabled: boolean
  breakpoint?: number
  swipeDistancePx?: number
  swipeVelocityPxPerMs?: number
  edgeBandPx?: number
}

/**
 * Merge the host-injected page config over the defaults. An absent config
 * (host feature off, or an old cached page) resolves to enabled=false — the
 * client half is inert unless the host opted the page in.
 *
 * @param pageConfig - `window.__DASHR_MOBILE__` as left by the boot script.
 * @returns resolved thresholds plus the enable flag.
 */
export function resolveMobileConfig(pageConfig: MobilePageConfig | undefined): { enabled: boolean } & SwipeThresholds {
  if (pageConfig === undefined || pageConfig.enabled !== true) {
    return { enabled: false, ...DEFAULT_SWIPE_THRESHOLDS }
  }
  const n = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  return {
    enabled: true,
    breakpoint: n(pageConfig.breakpoint, DEFAULT_SWIPE_THRESHOLDS.breakpoint),
    swipeDistancePx: n(pageConfig.swipeDistancePx, DEFAULT_SWIPE_THRESHOLDS.swipeDistancePx),
    swipeVelocityPxPerMs: n(pageConfig.swipeVelocityPxPerMs, DEFAULT_SWIPE_THRESHOLDS.swipeVelocityPxPerMs),
    edgeBandPx: n(pageConfig.edgeBandPx, DEFAULT_SWIPE_THRESHOLDS.edgeBandPx),
  }
}
