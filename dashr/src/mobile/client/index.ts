/**
 * Mobile responsiveness (client half): narrow-viewport sidebar hiding plus
 * three-condition swipe recognition (origin ∧ distance ∧ velocity).
 *
 * Two coordinated pieces, both config-gated by the host half's injected boot
 * script (`window.__DASHR_MOBILE__` — the client half of a dual-half plugin
 * carries no loader config, so the page global IS the config channel):
 *
 * - **CSS** (the upstream-paradigm route — static rules, zero JS geometry):
 *   below the breakpoint the AppFrame's inline
 *   `grid-template-columns: <rail>px minmax(0,1fr) <details>px` is overridden
 *   with `!important` on the semantic `[data-sidebar-collapsed]` attribute,
 *   collapsing the 56px rail to a zero-width track. Phones (<920px) are
 *   deterministic there (the concession chain auto-closes details), so the
 *   override never fights a live details column; the 920–1023 tablet band
 *   keeps native behavior when details is open (first-version scope).
 *   Degradation is benign: if upstream renames the attribute, the rule stops
 *   matching and the native rail simply renders.
 *
 * - **Gesture** (additive — upstream ships no swipe code): document-level
 *   pointer listeners feeding the pure predicates in `./gesture.ts`; a
 *   recognized swipe in a narrow viewport toggles the sidebar through the
 *   layout service (`ctx.layout.toggleSidebar()` — narrow-viewport semantics
 *   flip the `narrowExpanded` overlay), so no upstream state is touched.
 *
 * @module dashr/mobile/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { classifySwipe, isInteractiveOrigin, isNarrowViewport, resolveMobileConfig, type PanelState, type SwipeSample } from '../gesture.ts'

/** Structural layout face (`ctx.layout`): exactly what this feature calls. */
interface LayoutPanelFace {
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
}

/**
 * Panel state from the frame's semantic attributes (AppFrame): the collapsed
 * markers are PRESENT while collapsed and absent while expanded/open, so the
 * gesture classifier sees the same live state the layout renders from.
 */
function readPanelState(): PanelState {
  return {
    leftExpanded: document.querySelector('[data-sidebar-collapsed]') === null,
    detailsOpen: document.querySelector('[data-details-collapsed]') === null,
  }
}

/** Page global left by the host half's boot script (see `src/web-trust.ts`). */
interface DashrMobileGlobal {
  __DASHR_MOBILE__?: {
    enabled?: boolean
    breakpoint?: number
    swipeDistancePx?: number
    swipeVelocityPxPerMs?: number
    edgeBandPx?: number
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

  const styleTagId = '@pgmi-builds/better-dsh/mobile'
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = '@pgmi-builds/better-dsh'
    tag.dataset.pluginCss = styleTagId
    tag.textContent = mobileCss(config.breakpoint)
    document.head.append(tag)

    // The layout service is a conditional peer: a composition without
    // ui-layout keeps the CSS (pure cosmetics) and skips the gesture.
    const offLayout = ctx.inject(['layout'], (layoutCtx: ClientContext) => {
      const layout = layoutCtx.get('layout') as LayoutPanelFace | undefined
      if (layout === undefined) return
      let start: { x: number; y: number; t: number; width: number; type: string } | undefined
      const onPointerDown = (event: PointerEvent): void => {
        start = undefined
        if (event.button !== 0 && event.pointerType === 'mouse') return
        if (isInteractiveOrigin(event.target as EventTarget | null)) return
        start = {
          x: event.clientX,
          y: event.clientY,
          t: event.timeStamp,
          width: window.innerWidth,
          type: event.pointerType,
        }
      }
      const onPointerUp = (event: PointerEvent): void => {
        const origin = start
        start = undefined
        if (origin === undefined) return
        const sample: SwipeSample = {
          x0: origin.x,
          y0: origin.y,
          x1: event.clientX,
          y1: event.clientY,
          dtMs: Math.max(0, event.timeStamp - origin.t),
          viewportWidth: origin.width,
          pointerType: origin.type,
        }
        // Narrow-viewport gate at GESTURE time: the wide layout keeps its
        // native interactions.
        if (!isNarrowViewport(sample.viewportWidth, config)) return
        const action = classifySwipe(sample, config, readPanelState())
        if (action === null) return
        if (action === 'open-left' || action === 'close-left') layout.toggleSidebar()
        else if (action === 'open-details') layout.openDetails()
        else layout.closeDetails()
      }
      document.addEventListener('pointerdown', onPointerDown, { passive: true })
      document.addEventListener('pointerup', onPointerUp, { passive: true })
      return () => {
        document.removeEventListener('pointerdown', onPointerDown)
        document.removeEventListener('pointerup', onPointerUp)
      }
    })

    return () => {
      tag.remove()
      void Promise.resolve(offLayout.dispose())
    }
  }, 'dashr: mobile layout')
}
