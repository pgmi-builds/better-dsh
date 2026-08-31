/**
 * The `failover` general-fallback config (host-plane, per-turn latch).
 *
 * Pure module — no `@deepseek-ai/*` value imports, so both the host module and
 * the client half may import it (the client type-only) without dragging a host
 * runtime dependency into the browser bundle.
 *
 * A route is a `provider/model` string (e.g. `deepseek/deepseek-v4-flash`).
 * The empty string `''` means "not set" — the slot is skipped.
 *
 * @module dashr/failover/config
 */

/** The settings namespace the General row reads and writes. */
export const FAILOVER_SETTINGS_NS = 'failover'

/** Failure codes that activate a fallback switch. */
export const FAILOVER_TRIGGER_CODES: Record<string, true> = {
  AUTH: true,
  // Upstream splits MISSING_CREDENTIAL out of AUTH; both are auth-class.
  MISSING_CREDENTIAL: true,
  QUOTA: true,
  RATE_LIMIT: true,
}

/** The fallback chain: two ordered slots. `''` = not set (skip). */
export interface FailoverConfig {
  fallback1: string
  fallback2: string
}

/** Spec defaults — `Config({})` must equal this (both slots unset = native behavior). */
export const defaultFailoverConfig: FailoverConfig = { fallback1: '', fallback2: '' }

/** The non-empty fallback routes in order (at most 2). */
export function fallbackRoutes(config: FailoverConfig): string[] {
  return [config.fallback1, config.fallback2].filter((route) => route.length > 0)
}

/** Split a `provider/model` route; `undefined` when malformed. */
export function splitRoute(route: string): { provider: string; model: string } | undefined {
  const slash = route.indexOf('/')
  if (slash <= 0 || slash === route.length - 1) return undefined
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}
