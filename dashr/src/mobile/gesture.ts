/**
 * Mobile swipe-recognition predicates (pure, unit-tested).
 *
 * The three-condition contract (design D3 / spec `mobile-layout`): a swipe is
 * recognized only when ALL of
 *   1. origin — the gesture starts inside the horizontal edge band,
 *   2. distance — horizontal displacement reaches the threshold,
 *   3. velocity — average displacement/time reaches the threshold,
 * hold. A slow press-drag (text selection for copy) covers distance at
 * sub-threshold velocity and must NOT toggle; a fast light sweep must.
 *
 * Two hygiene predicates ride along, fixed by the spec scenarios:
 * - the gesture must be mostly horizontal (`|dx| > |dy|`), so vertical
 *   scrolls never toggle;
 * - only touch/pen pointers participate — a mouse drag on a narrow desktop
 *   window is text selection, not a swipe.
 *
 * No DOM here: `classifySwipe` is a pure function over gesture facts so the
 * thresholds and edge cases pin under vitest without a browser.
 *
 * @module dashr/mobile/gesture
 */

/** Recognition thresholds, resolved from the host-injected page config. */
export interface SwipeThresholds {
  /** Viewport width at/below which a toggle is allowed (px). */
  breakpoint: number
  /** Minimum horizontal displacement (px). */
  swipeDistancePx: number
  /** Minimum average velocity (px per ms). */
  swipeVelocityPxPerMs: number
  /** Origin band from either horizontal viewport edge (px). */
  edgeBandPx: number
}

/** Resolved defaults, mirroring the host config schema. */
export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  breakpoint: 1024,
  swipeDistancePx: 48,
  swipeVelocityPxPerMs: 0.35,
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

/**
 * Decide whether one completed gesture is a recognized horizontal swipe.
 *
 * @param sample - the gesture facts.
 * @param thresholds - resolved recognition thresholds.
 * @returns `true` when all three conditions (plus the horizontal and
 *   pointer-type hygiene predicates) hold; the caller toggles the sidebar.
 */
export function isRecognizedSwipe(sample: SwipeSample, thresholds: SwipeThresholds): boolean {
  if (sample.pointerType !== 'touch' && sample.pointerType !== 'pen') return false
  const dx = sample.x1 - sample.x0
  const dy = sample.y1 - sample.y0
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  // Mostly horizontal: the horizontal component dominates the vertical one.
  if (adx <= ady) return false
  // ① Origin: inside the edge band of either horizontal viewport edge.
  const inLeftBand = sample.x0 <= thresholds.edgeBandPx
  const inRightBand = sample.x0 >= sample.viewportWidth - thresholds.edgeBandPx
  if (!inLeftBand && !inRightBand) return false
  // ② Distance.
  if (adx < thresholds.swipeDistancePx) return false
  // ③ Velocity (average over the down→up span); a zero span cannot be a swipe.
  if (sample.dtMs <= 0) return false
  return adx / sample.dtMs >= thresholds.swipeVelocityPxPerMs
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
 * Whether a toggle is allowed at gesture time: only in the narrow viewport
 * the feature owns (the wide layout keeps its native toggle semantics).
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
