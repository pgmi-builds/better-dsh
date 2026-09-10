/**
 * Mobile swipe recognition (pure, unit-tested) — an EXACT port of the
 * operator's own ui-layout patch (retired `z_dsh-alpha` checkout, commit
 * `1706b81` "ui-layout: mobile swipe opens Better Sidebar right panel via
 * its DOM toggle", `packages/client/ui-layout/src/client/AppFrame.tsx`)
 * from patched-source form into plugin form, plus exactly ONE addition:
 * an average-velocity gate (`swipeVelocityPxPerMs`, the 2026-09-02
 * supplemental requirement — the only constant here without a source
 * precedent; `0` disarms it and restores the source's behavior verbatim).
 *
 * Source semantics, preserved number-for-number:
 * - **Start admission** (pointerdown): with BOTH panels closed, only the
 *   left band `x ≤ 120` (the source's X120) or the right three quarters
 *   `x ≥ viewport/4` may start a gesture — the center band stays inert so
 *   content swipes don't misfire. With a panel open, ANY position may
 *   start (the dismiss swipe naturally starts on the panel body).
 * - **Firing** (pointermove, mid-gesture): the gesture fires DURING the
 *   drag as soon as `|dx| ≥ 40` AND `|dx| > |dy| × 1.3` (horizontal
 *   dominance over scroll intent) — then the drag is spent (one shot).
 *   Firing mid-gesture rather than at pointerup is what keeps a lazy
 *   swipe triggerable: a pointerup-time decision loses the pointer to the
 *   browser's scroll/pan heuristics (pointercancel) whenever the drag is
 *   slow, which reads to the user as "I must flick fast to trigger".
 * - **State machine** (symmetric, from the source):
 *     left-swipe:  close the sidebar if open, else open the right panel
 *                  (Better Sidebar) when a session is current;
 *     right-swipe: close the right panel if open, else open the sidebar
 *                  when collapsed.
 * - **Band admission (2026-09-11 mobile wave)**: no own pixel cut-off. The
 *   feature is live on coarse pointers (phones/tablets) and wherever a
 *   panel is already in its narrow-viewport state — i.e. it follows the
 *   upstream layout STATE, never a threshold we invented. Upstream may
 *   move their auto-collapse boundary (1024 today) freely; we track the
 *   resulting state attributes.
 *
 * Both panel reads address OFFICIAL upstream surfaces ONLY (hard rule,
 * 2026-09-11): the left sidebar through the layout service
 * (`ctx.layout.toggleSidebar()`) and AppFrame's `[data-sidebar-collapsed]`;
 * the right panel through the official 0.1.5 controls — expand
 * `[data-sidebar-right-expand]` (conversation header corner) and toggle
 * `[data-sidebar-right-toggle]` (dock chrome) — with its open state read
 * off AppFrame's `[data-rightbar-collapsed]`. Third-party plugin DOM is
 * never a state input again (the retired Better Sidebar coupling poisoned
 * the whole state machine once that plugin was removed).
 *
 * No DOM here: these are pure predicates over gesture facts plus the
 * panel state the caller reads off live DOM.
 *
 * @module dashr/mobile/gesture
 */

/** Recognition thresholds, resolved from the host-injected page config. */
export interface SwipeThresholds {
  /** Minimum horizontal displacement (px). */
  swipeDistancePx: number
  /** Horizontal dominance factor: `|dx|` must EXCEED `|dy|` × this. */
  dominanceRatio: number
  /** Left-edge band within which a sidebar-opening swipe may start (px). */
  leftEdgeBandPx: number
  /** Right start zone boundary as a fraction of viewport width. */
  rightZoneRatio: number
  /** Minimum average velocity (px per ms); `0` disarms the gate. */
  swipeVelocityPxPerMs: number
}

/** Resolved defaults — the `1706b81` constants (120 / viewport÷4 / 40 / 1.3)
 * plus the one addition, the velocity gate. A slow text-selection drag runs
 * ~0.13 px/ms; 0.15 px/ms filters those while any comfortable sweep (0.4
 * px/ms and up) passes.
 */
export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  swipeDistancePx: 40,
  dominanceRatio: 1.3,
  leftEdgeBandPx: 120,
  rightZoneRatio: 0.25,
  swipeVelocityPxPerMs: 0.15,
}

/** Panel state at gesture time (read live off the DOM by the caller). */
export interface PanelState {
  /** Whether the left sidebar is collapsed (upstream auto-collapse state). */
  leftCollapsed: boolean
  /** Whether the official right sidebar panel is open (0.1.5 ui-sidebar-right). */
  rightOpen: boolean
}

/** The panel action a recognized swipe maps to. */
export type SwipeAction = 'open-left' | 'close-left' | 'open-right' | 'close-right'

/**
 * Whether a pointerdown may START a gesture — the source's pointerdown
 * gate, verbatim: with both panels closed, only the left band (X120) or
 * the right three quarters of the screen admit; with a panel open, any
 * position admits (that swipe is a dismiss).
 *
 * @param x - pointerdown client X.
 * @param viewportWidth - viewport width at gesture time (px).
 * @param panels - panel state at pointerdown.
 * @param thresholds - resolved recognition thresholds.
 * @returns `true` when the origin is admitted into tracking.
 */
export function admitsSwipeStart(x: number, viewportWidth: number, panels: PanelState, thresholds: SwipeThresholds): boolean {
  if (!(panels.leftCollapsed && !panels.rightOpen)) return true
  return x <= thresholds.leftEdgeBandPx || x >= viewportWidth * thresholds.rightZoneRatio
}

/** A drag's progress facts at one pointermove event. */
export interface SwipeProgress {
  /** Horizontal displacement since pointerdown (px, signed). */
  dx: number
  /** Vertical displacement since pointerdown (px, signed). */
  dy: number
  /** Elapsed down→now time (ms). */
  dtMs: number
}

/**
 * Classify one in-flight drag into a panel action — the source's
 * pointermove decision, verbatim, plus the velocity gate. Callers fire
 * ONCE (then drop the drag): a `null` here means "not yet / not this
 * gesture", and the same drag may classify on a LATER move event as its
 * displacement or velocity grows.
 *
 * @param progress - the drag's displacement and elapsed time so far.
 * @param panels - panel state read live at this event.
 * @param sessionLive - whether a session is current (gates opening the
 *   right panel, mirroring the source's `detailsSession !== undefined`).
 * @param thresholds - resolved recognition thresholds.
 * @returns the action the drag maps to, or `null` when no panel admits
 *   it yet.
 */
export function classifySwipeProgress(progress: SwipeProgress, panels: PanelState, sessionLive: boolean, thresholds: SwipeThresholds): SwipeAction | null {
  const adx = Math.abs(progress.dx)
  const ady = Math.abs(progress.dy)
  if (adx < thresholds.swipeDistancePx) return null
  if (adx <= ady * thresholds.dominanceRatio) return null
  if (thresholds.swipeVelocityPxPerMs > 0) {
    if (progress.dtMs <= 0) return null
    if (adx / progress.dtMs < thresholds.swipeVelocityPxPerMs) return null
  }
  if (progress.dx < 0) {
    // Left swipe: close the sidebar if open, otherwise open the right
    // panel when a session is current.
    if (!panels.leftCollapsed) return 'close-left'
    if (sessionLive && !panels.rightOpen) return 'open-right'
    return null
  }
  // Right swipe: close the right panel if open, otherwise open the
  // sidebar when collapsed.
  if (panels.rightOpen) return 'close-right'
  if (panels.leftCollapsed) return 'open-left'
  return null
}

/** Resolve the page config left by the host half's injected boot script. */
export interface MobilePageConfig {
  enabled: boolean
  swipeDistancePx?: number
  dominanceRatio?: number
  leftEdgeBandPx?: number
  rightZoneRatio?: number
  swipeVelocityPxPerMs?: number
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
  // The velocity gate alone accepts 0 (disarm) as a configured value.
  const v = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
  return {
    enabled: true,
    swipeDistancePx: n(pageConfig.swipeDistancePx, DEFAULT_SWIPE_THRESHOLDS.swipeDistancePx),
    dominanceRatio: n(pageConfig.dominanceRatio, DEFAULT_SWIPE_THRESHOLDS.dominanceRatio),
    leftEdgeBandPx: n(pageConfig.leftEdgeBandPx, DEFAULT_SWIPE_THRESHOLDS.leftEdgeBandPx),
    rightZoneRatio: n(pageConfig.rightZoneRatio, DEFAULT_SWIPE_THRESHOLDS.rightZoneRatio),
    swipeVelocityPxPerMs: v(pageConfig.swipeVelocityPxPerMs, DEFAULT_SWIPE_THRESHOLDS.swipeVelocityPxPerMs),
  }
}
