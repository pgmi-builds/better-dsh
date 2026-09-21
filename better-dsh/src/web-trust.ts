/**
 * Web trust + mobile page-config boot scripts (host half of the P2/P3 web
 * features).
 *
 * Two INDEPENDENT Plugins-page component rows deliver page config through
 * the webserver's public `webserver/index-inject` event (every index render
 * re-emits; row data is read fresh at emit time, so a config reload needs no
 * listener re-wiring). The event is a LIST: each row pushes its own inline
 * `<head>` script, so toggling one row never touches the other (spec
 * docs/specs/plugins-page-components/spec.md).
 *
 * `dashr-web-trust` — trusted page authorities (the browser-side twin of the
 * connection row's server-side `trustedHosts`): when the page's hostname is
 * one the operator declared their own, the script sets
 * `window.__DSH_TRANSPORT__ = { ownsHost: true }` BEFORE any application
 * bundle materializes. The connection client half computes
 * `ctx.connection.isLoopback` from that flag (its only whole-repo
 * consumer), which restores the upstream-documented shape for trusted
 * authorities — the page works AND keeps Host settings persistence —
 * instead of the describe mirror's terminal `memory` unavailability.
 * The object deliberately carries NO fetch/openStream: the connection
 * client's optional chaining then builds the default HTTP/WS transport,
 * so the flag's only effect is the loopback verdict. An existing
 * `__DSH_TRANSPORT__` (a worker shell that owns a real transport) is
 * never overwritten.
 *
 * `dashr-mobile` — mobile page config (`window.__DASHR_MOBILE__`): the
 * dual-half plugin's client half carries no loader config, so the resolved
 * mobile thresholds travel to the page through this global; the client
 * feature is inert when the host did not opt the page in.
 *
 * Each leg injects nothing at all when its own config disables it; the
 * mobile leg ships default-ON (design D1), so a bare config still carries
 * the mobile global. The scripts are strict IIFEs over JSON-embedded
 * literals — no config string is ever spliced into code unescaped.
 *
 * @module dashr/web-trust
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls the `webserver/index-inject` Events merge and the
// IndexInjection shape from the host webserver's Context declaration.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { buildZoomGuardSection } from './mobile/zoom-guard.ts'
/**
 * The schema-level default for `trustedPageAuthorities` (v0.2.2a): derive
 * from the DSH_TRUSTED_HOSTS environment — the SAME single source the
 * fence leg's patch expression reads first — so ONE declaration (e.g. one
 * `Environment=` line in the service unit) drives both legs with zero
 * per-instance plugin config. Bare hostnames only: `location.hostname`
 * carries no port, and `assertBareHostname` would reject a portful entry at
 * boot, so portful/schematic entries are dropped here instead of thrown.
 * Declared in the Config SCHEMA rather than the bundle patch row because a
 * profile/home layer row with the same id whole-row-overrides the row's
 * config object, while schema defaults fill per-key at plugin load and
 * survive every overlay layer. An explicit configured value always wins.
 *
 * @param env - the raw DSH_TRUSTED_HOSTS value (whitespace-separated).
 * @returns the bare-hostname authorities to trust by default.
 */
export function deriveDefaultPageAuthorities(env: string | undefined): string[] {
  return (env ?? '').split(/\s+/).filter(h => h.length > 0 && !/[:/@?#]/.test(h))
}

/** Mobile page-config knobs (the `dashr-mobile` row's config shape). */
export interface MobileConfig {
  enabled?: boolean
  swipeDistancePx?: number
  dominanceRatio?: number
  leftEdgeBandPx?: number
  rightZoneRatio?: number
  swipeVelocityPxPerMs?: number
  /**
   * iOS focus auto-zoom suppression mode (change
   * `2026-09-03-ios-focus-zoom-suppression`): `'meta'` (default) rewrites
   * the viewport meta on iOS-class narrow viewports; `'off'` is the escape
   * hatch. `'font'` (16px floor, solution A) is a RESERVED value slot,
   * deliberately not in the schema enum — unimplemented values fail loud
   * at config load rather than no-op silently.
   */
  zoomGuard?: 'meta' | 'off'
}

/** The `webserver/index-inject` row shape these features push. */
export interface BootScriptRow {
  kind: 'script'
  placement: 'head'
  text: string
}

/** Assert one configured authority is a bare hostname (no port/path/scheme). */
function assertBareHostname(entry: string): void {
  if (entry.length === 0 || /[:/@?#]/.test(entry)) {
    throw new Error(
      `dashr-web-trust: trustedPageAuthorities entry ${JSON.stringify(entry)} is not a bare hostname `
      + '(location.hostname carries no port; an entry with port/path would never match)',
    )
  }
}

/** The IIFE framing shared by both legs (a throwing leg stays invisible). */
function frame(body: string[]): string {
  return ['(function(){try{', ...body, '}catch(e){}})();'].join('')
}

/**
 * Build the authorities-leg script. Pure: same config in, same script out —
 * the unit tests pin the shape (authority match, no-overwrite guard,
 * inert-when-empty).
 *
 * @param trustedPageAuthorities - the operator-declared hostnames.
 * @returns the script text, or `undefined` when the list is empty (inject
 *   nothing — the feature is fully inert).
 */
export function buildTrustScript(trustedPageAuthorities: readonly string[] | undefined): string | undefined {
  const authorities = [...(trustedPageAuthorities ?? [])]
  if (authorities.length === 0) return undefined
  for (const entry of authorities) assertBareHostname(entry)
  return frame([
    'if(!window.__DSH_TRANSPORT__){',
    `var h=location.hostname,a=${JSON.stringify(authorities)};`,
    'for(var i=0;i<a.length;i++)if(a[i]===h){window.__DSH_TRANSPORT__={ownsHost:true};break}',
    '}',
  ])
}

/**
 * Build the mobile-leg script. Pure: same config in, same script out — the
 * unit tests pin the shape (mobile global, tuned thresholds, zoomGuard
 * section, disabled-when-off).
 *
 * @param mobile - the resolved mobile config.
 * @returns the script text, or `undefined` when the feature is explicitly
 *   disabled (inject nothing).
 */
export function buildMobileScript(mobile: MobileConfig | undefined): string | undefined {
  // Ship default ON (design D1): absent config or absent flag both mean
  // enabled; only an explicit `enabled: false` opts the page out.
  const mobileEnabled = mobile?.enabled !== false
  if (!mobileEnabled) return undefined
  const payload = {
    enabled: true,
    ...(mobile?.swipeDistancePx !== undefined ? { swipeDistancePx: mobile.swipeDistancePx } : {}),
    ...(mobile?.dominanceRatio !== undefined ? { dominanceRatio: mobile.dominanceRatio } : {}),
    ...(mobile?.leftEdgeBandPx !== undefined ? { leftEdgeBandPx: mobile.leftEdgeBandPx } : {}),
    ...(mobile?.rightZoneRatio !== undefined ? { rightZoneRatio: mobile.rightZoneRatio } : {}),
    ...(mobile?.swipeVelocityPxPerMs !== undefined ? { swipeVelocityPxPerMs: mobile.swipeVelocityPxPerMs } : {}),
    ...(mobile?.zoomGuard !== undefined ? { zoomGuard: mobile.zoomGuard } : {}),
  }
  const body = [`window.__DASHR_MOBILE__=${JSON.stringify(payload)};`]
  // Zoom guard rides the mobile leg (design D5): emitted unless explicitly
  // 'off' — the same default-on posture as the leg itself. Absent config
  // still emits the section (the script's own default is 'meta').
  if (mobile?.zoomGuard !== 'off') body.push(buildZoomGuardSection())
  return frame(body)
}

/**
 * `dashr-web-trust` row config schema. Only the authorities leg lives here —
 * the mobile knobs are the `dashr-mobile` row's own config.
 */
export interface TrustConfig {
  /** Hostnames this operator declares their own devices' pages run on. */
  trustedPageAuthorities?: readonly string[]
}

/** Row config schema (schema-level default derives from `DSH_TRUSTED_HOSTS`). */
export const Config = z.object({
  trustedPageAuthorities: z.array(String).default(deriveDefaultPageAuthorities(process.env.DSH_TRUSTED_HOSTS)),
})

/** Cordis plugin name. */
export const name = 'dashr-web-trust'

/**
 * No static injects: `webServer` is composed conditionally inside
 * {@link apply}, so the row loads (dormant) in compositions without one.
 */
export const inject: string[] = []

/**
 * Mount the authorities-leg injection: one `webserver/index-inject` listener
 * pushing the rendered row.
 * @param ctx - host plugin context.
 * @param config - the row config.
 */
export function apply(ctx: Context, config: TrustConfig | undefined): void {
  const authorities = config?.trustedPageAuthorities
  ctx.inject(['webServer'], () => {
    ctx.on('webserver/index-inject', (table) => {
      const text = buildTrustScript(authorities)
      if (text !== undefined) table.push({ kind: 'script', placement: 'head', text })
    })
  })
}

export default { name, inject, Config, apply }
