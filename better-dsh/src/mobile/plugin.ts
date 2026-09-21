/**
 * `dashr-mobile`: the mobile page-config row (Plugins-page component, spec
 * docs/specs/plugins-page-components/spec.md).
 *
 * Delivers the resolved mobile thresholds to the page through
 * `window.__DASHR_MOBILE__` (plus the zoomGuard section) via ONE
 * `webserver/index-inject` listener — the MOBILE LEG only. The trusted-page
 * authorities leg lives on the sibling `dashr-web-trust` row; the event is a
 * list, so the two rows compose and toggle independently. The client half
 * reads the page global and is inert when this row is off (the global is
 * simply absent).
 *
 * @module dashr/mobile
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the `webserver/index-inject` Events merge into this program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { buildMobileScript, type MobileConfig } from '../web-trust.ts'

/** Cordis plugin name. */
export const name = 'dashr-mobile'

/**
 * No static injects: `webServer` is composed conditionally inside
 * {@link apply}, so the row loads (dormant) in compositions without one.
 */
export const inject: string[] = []

/**
 * Row config schema — the mobile knobs, moved verbatim from the pre-split
 * `dashr-repl` Config (2026-09-11 mobile wave + zoomGuard changes).
 */
const MOBILE_CONFIG: z<Required<MobileConfig>> = z.object({
  enabled: z.boolean().default(true),
  // `breakpoint` removed (2026-09-11 mobile wave): responsive behavior tracks
  // the upstream sidebar auto-collapse STATE ([data-sidebar-collapsed]), never
  // our own pixel cut-off; zoomGuard carries its own internal narrow band.
  swipeDistancePx: z.natural().min(8).default(40),
  dominanceRatio: z.number().min(1).default(1.3),
  leftEdgeBandPx: z.natural().min(8).default(120),
  rightZoneRatio: z.number().min(0.05).max(0.9).default(0.25),
  swipeVelocityPxPerMs: z.number().min(0).default(0.15),
  // iOS focus auto-zoom suppression (change 2026-09-03-ios-focus-zoom-
  // suppression): 'meta' rewrites the viewport meta early on iOS-class
  // narrow viewports; 'off' is the escape hatch. 'font' (solution A, the
  // 16px floor) is a RESERVED future value — deliberately NOT accepted yet:
  // an unimplemented enum member would fail silent (no-op) at runtime, while
  // an unknown value here fails LOUD at config load.
  zoomGuard: z.union(['meta', 'off']).default('meta'),
})

export const Config = MOBILE_CONFIG

/**
 * Mount the mobile-leg injection: one `webserver/index-inject` listener
 * pushing the rendered row.
 * @param ctx - host plugin context.
 * @param config - the row config.
 */
export function apply(ctx: Context, config: MobileConfig | undefined): void {
  const mobile = config
  ctx.inject(['webServer'], () => {
    ctx.on('webserver/index-inject', (table) => {
      const text = buildMobileScript(mobile)
      if (text !== undefined) table.push({ kind: 'script', placement: 'head', text })
    })
  })
}

export default { name, inject, Config, apply }
