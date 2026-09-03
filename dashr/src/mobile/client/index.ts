/**
 * Mobile responsiveness (client half) — an EXACT port of the operator's
 * ui-layout swipe patch (`z_dsh-alpha` commit `1706b81`) into plugin form
 * (see `../gesture.ts` for the semantics and their source anchors), plus
 * the one addition: the average-velocity gate.
 *
 * Two coordinated pieces, both config-gated by the host half's injected
 * boot script (`window.__DASHR_MOBILE__` — the client half of a dual-half
 * plugin carries no loader config, so the page global IS the config
 * channel):
 *
 * - **CSS** (the upstream-paradigm route — static rules, zero JS
 *   geometry): below the 768 breakpoint the AppFrame's inline
 *   `grid-template-columns: <rail>px minmax(0,1fr) <details>px` is
 *   overridden with `!important` on the semantic `[data-sidebar-collapsed]`
 *   attribute, collapsing the 56px rail to a zero-width track — the
 *   source's `SIDEBAR_MOBILE`/`computeColumns(mobile)` behavior. The
 *   768–1023 tablet band keeps the native rail (and no gestures).
 *   Degradation is benign: if upstream renames the attribute, the rule
 *   stops matching and the native rail simply renders.
 *
 * - **Gesture** (additive — upstream ships no swipe code): document-level
 *   CAPTURE listeners (Better Sidebar's open panel is a full-width fixed
 *   layer covering the frame — a frame-level listener would never see the
 *   closing swipe, exactly as the source's comment records). The drag is
 *   decided on `pointermove` the moment the thresholds are met (one
 *   shot), never at pointerup. Left panel actions go through the layout
 *   service (`ctx.layout.toggleSidebar()`); the right panel is Better
 *   Sidebar's floating layer, toggled through its persistent DOM cluster
 *   (`[data-dsh-toggle-cluster]`, last button) with its open state read
 *   synchronously off `body[data-dsh-sidebar-collapsed]`.
 *
 * @module dashr/mobile/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { admitsSwipeStart, classifySwipeProgress, isNarrowViewport, resolveMobileConfig, type PanelState } from '../gesture.ts'

/** Structural layout face (`ctx.layout`): exactly what this feature calls. */
interface LayoutPanelFace {
  toggleSidebar(): void
}

/** Left sidebar state, live off AppFrame's semantic attribute. */
function readLeftCollapsed(): boolean {
  return document.querySelector('[data-sidebar-collapsed]') !== null
}

/**
 * Better Sidebar's right-panel state, live off the body attribute the
 * plugin itself publishes (collapsed = closed). Read SYNCHRONOUSLY in the
 * handlers — a cached mirror lags the panel's own DOM write by a render,
 * and a close-swipe issued right after an open-swipe would misroute.
 */
function readRightOpen(): boolean {
  return !document.body.hasAttribute('data-dsh-sidebar-collapsed')
}

/**
 * Whether a session is current — the plugin-side stand-in for the source's
 * `detailsSession !== undefined` guard (the right panel opens in a session
 * only). Better Sidebar's own shipped CSS keys off the same slot selector,
 * so it is load-bearing beyond this feature.
 */
function readSessionLive(): boolean {
  return document.querySelector('[data-slot="conversation.session.header"]') !== null
}

/** Panel state snapshot, both sources live. */
function readPanelState(): PanelState {
  return { leftCollapsed: readLeftCollapsed(), rightOpen: readRightOpen() }
}

/**
 * Toggle Better Sidebar's right panel through its persistent DOM: the
 * plugin exposes no JS toggle on its client service (its open/close
 * reducer is store-internal), so the swipe reaches it the same way the
 * source did — clicking the LAST button of its always-rendered
 * `[data-dsh-toggle-cluster]` (the bottom-panel button precedes it and is
 * absent below the plugin's 768px narrow breakpoint). Absent cluster or
 * buttons: a no-op, never a crash.
 */
function toggleBetterSidebar(): void {
  const cluster = document.querySelector('[data-dsh-toggle-cluster]')
  const buttons = cluster?.querySelectorAll('button')
  const toggle = buttons?.[buttons.length - 1]
  toggle?.click()
}

/** Page global left by the host half's boot script (see `src/web-trust.ts`). */
interface DashrMobileGlobal {
  __DASHR_MOBILE__?: {
    enabled?: boolean
    breakpoint?: number
    swipeDistancePx?: number
    dominanceRatio?: number
    leftEdgeBandPx?: number
    rightZoneRatio?: number
    swipeVelocityPxPerMs?: number
  }
}

/**
 * The narrow-viewport CSS: zero-width sidebar track under the breakpoint,
 * keyed to AppFrame's semantic attribute (survives class-hash churn).
 * Rendered with the breakpoint baked in (media queries cannot read JS
 * config); the tag carries the plugin-owned dataset so the loader's
 * style-claim machinery removes it on unload, like module CSS.
 */
function mobileCss(breakpointPx: number): string {
  const wide = Math.max(1, Math.floor(breakpointPx) - 0.02)
  return [
    `@media (max-width: ${String(wide)}px) {`,
    `  [data-sidebar-collapsed] {`,
    `    grid-template-columns: 0px minmax(0, 1fr) 0px !important;`,
    `  }`,
    `}`,
  ].join('\n')
}

/**
 * Mount the mobile feature: style injection plus the swipe listeners.
 * Inert unless the host's boot script opted the page in.
 *
 * @param ctx - client root context.
 * @returns the effect disposer (style tag + listeners removed on unload).
 */
export function setupMobileLayout(ctx: ClientContext): void {
  const pageConfig = (globalThis as DashrMobileGlobal).__DASHR_MOBILE__
  const config = resolveMobileConfig(pageConfig)
  if (!config.enabled) return

  const styleTagId = 'better-dsh/mobile'
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'better-dsh'
    tag.dataset.pluginCss = styleTagId
    tag.textContent = mobileCss(config.breakpoint)
    document.head.append(tag)

    // The layout service is a conditional peer: a composition without
    // ui-layout keeps the CSS (pure cosmetics) and skips the left-panel
    // half of the gesture.
    const offLayout = ctx.inject(['layout'], (layoutCtx: ClientContext) => {
      const layout = layoutCtx.get('layout') as LayoutPanelFace | undefined
      if (layout === undefined) return
      let start: { x: number; y: number; t: number } | undefined
      const onPointerDown = (event: PointerEvent): void => {
        start = undefined
        const viewport = window.innerWidth
        // Gesture band at gesture time (source: `viewport < SIDEBAR_MOBILE`).
        if (!isNarrowViewport(viewport, config)) return
        // Start admission (source pointerdown gate: X120 left band / right
        // three quarters while both panels are closed, anywhere once one
        // is open).
        if (!admitsSwipeStart(event.clientX, viewport, readPanelState(), config)) return
        start = { x: event.clientX, y: event.clientY, t: event.timeStamp }
      }
      const onPointerMove = (event: PointerEvent): void => {
        const origin = start
        if (origin === undefined) return
        const action = classifySwipeProgress(
          {
            dx: event.clientX - origin.x,
            dy: event.clientY - origin.y,
            dtMs: event.timeStamp - origin.t,
          },
          readPanelState(),
          readSessionLive(),
          config,
        )
        if (action === null) return
        // One shot: the drag is spent the moment it fires (source
        // semantics — the ref is nulled inside the move handler).
        start = undefined
        if (action === 'open-left' || action === 'close-left') layout.toggleSidebar()
        else toggleBetterSidebar()
      }
      const onPointerEnd = (): void => {
        start = undefined
      }
      // CAPTURE on `document`: the open Better Sidebar panel is a
      // full-width fixed layer over the frame; bubbling listeners on the
      // frame would never see its closing swipe (source comment, verbatim
      // rationale).
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('pointerup', onPointerEnd, true)
      document.addEventListener('pointercancel', onPointerEnd, true)
      return () => {
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('pointermove', onPointerMove, true)
        document.removeEventListener('pointerup', onPointerEnd, true)
        document.removeEventListener('pointercancel', onPointerEnd, true)
      }
    })

    return () => {
      tag.remove()
      void Promise.resolve(offLayout.dispose())
    }
  }, 'dashr: mobile layout')
}
