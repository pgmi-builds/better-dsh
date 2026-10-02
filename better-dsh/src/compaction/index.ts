/**
 * Host-plane compaction tuning: the automatic-condensation threshold as a user
 * preference, kept in sync with the mounted `compaction-basic` engine.
 *
 * Upstream `compaction-basic` resolves its whole policy from the cordis row
 * config at load and freezes it: `thresholdRatio` (default 0.8) decides when
 * automatic condensation starts, and `retainRatio`/`retainTokens` decide how
 * much recent conversation stays verbatim. Nothing exposes either through the
 * settings page, and the row config is read once, so there is no way to tune it
 * from the UI. This module adds that surface:
 *
 *   - the row's entry IS the `compaction-tuning` settings namespace (dsh 0.1.7
 *     model): the volatile `thresholdRatio` field is form-editable through
 *     `remote.settings`, the write lands as a profile-layer patch override on
 *     this row via the config editor, and the runtime rewrites the resolved
 *     ref in place — no reload, no restart;
 *   - it hands the LIVE engine a frozen policy view whose `thresholdRatio` /
 *     `retainTokens` are getters over the resolved refs, so every engine
 *     re-read (`compactIfNeeded()` / `summarize()` resolve per event) sees the
 *     current preference with no re-apply step.
 *
 * Scope limit, upstream and NOT fixable here: the manual `/compact` path calls
 * `selectCompactableRange(session, measurement, 0)` with a hard-coded zero
 * recency budget, so it ignores `retainRatio`/`retainTokens` entirely. This
 * preference therefore tunes AUTOMATIC condensation only.
 *
 * Plugins-page component row `dashr-compaction-tuning` →
 * `better-dsh/compaction-tuning` (spec docs/specs/plugins-page-components/spec.md):
 * the row config IS the composition base layer of the settings namespace.
 *
 * @module dashr/compaction
 */

import { Context } from '@deepseek-ai/cordis'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '#schemastery'
import {
  DEFAULT_RETAIN_TOKENS, DEFAULT_THRESHOLD_RATIO,
  THRESHOLD_MAX_RATIO, THRESHOLD_MIN_RATIO,
  defaultCompactionTuningConfig,
  type CompactionTuningConfig,
} from './config.ts'

/** Cordis plugin name. */
export const name = 'dashr-compaction-tuning'

/**
 * No static injects: both `settings` and `compaction` are composed
 * conditionally inside {@link installCompactionTuning}, so the row loads
 * (dormant) in compositions without them.
 */
export const inject: string[] = []

/**
 * The row settings schema.
 *
 * `thresholdRatio` is the field the General row drives and is volatile (dsh
 * 0.1.7 settings model): editing it from Settings lands as a profile-layer
 * patch override on this row and the resolved ref rewrites in place.
 * `retainTokens` is composition-only (see {@link DEFAULT_RETAIN_TOKENS}) and
 * stays non-volatile — form writes never touch it, a patch file still can.
 */
export const Config = z.object({
  thresholdRatio: z.number()
    .step(0.01).min(THRESHOLD_MIN_RATIO).max(THRESHOLD_MAX_RATIO)
    .default(DEFAULT_THRESHOLD_RATIO)
    .volatile(),
  retainTokens: z.number().step(1).min(0).default(DEFAULT_RETAIN_TOKENS),
}) as unknown as z<CompactionTuningConfig>

/**
 * The row config as cordis hands it over post-resolution: the volatile
 * threshold arrives as a live reference, not a plain number.
 */
export interface ResolvedCompactionTuningConfig {
  thresholdRatio: number | Volatile<number>
  retainTokens: number
}

/** The policy object `compaction-basic` keeps on its mounted service instance. */
interface LiveCompactionPolicy {
  thresholdRatio?: number
  retainRatio?: number
  retainTokens?: number
  [field: string]: unknown
}

/** Structural face of the engine — no host type import, so a backend swap degrades. */
interface LiveCompactionEngine {
  config: LiveCompactionPolicy
}

/** Structural face of the LLM catalog, used only by the advisory retention guard. */
interface CatalogFace {
  listProviders(): { id: string }[]
  listModels(provider: string): Promise<{ id: string }[]>
  resolveModelInfo(provider: string, model: string): Promise<{ context?: { contextWindow?: number } }>
}

/**
 * Keep the live compaction engine on the user's threshold preference.
 * @param ctx - host context of the row that owns this capability.
 * @param config - resolved row config; the volatile threshold is a live ref.
 */
export function installCompactionTuning(
  ctx: Context,
  config: ResolvedCompactionTuningConfig = defaultCompactionTuningConfig,
): void {
  const logger = ctx.logger('compaction-tuning')
  const live = (): CompactionTuningConfig => ({
    thresholdRatio: typeof config.thresholdRatio === 'number'
      ? config.thresholdRatio
      : config.thresholdRatio.get() ?? DEFAULT_THRESHOLD_RATIO,
    retainTokens: config.retainTokens,
  })

  /** Smallest routed context window seen so far (advisory guard, best effort). */
  let minWindow: number | undefined
  let probing = false

  /**
   * Learn the routed context windows and log when the current pairing would
   * leave `retainTokens >= floor(window x thresholdRatio)` — the condition
   * under which the engine raises `TargetPressureConfigError` per route and
   * automatic condensation quietly stops for that route. Advisory only: the
   * dsh 0.1.7 settings model has no custom write-validation seam, so a bad
   * pairing surfaces through the engine's own per-route error instead.
   */
  const probeWindows = (): void => {
    if (probing || minWindow !== undefined) return
    const llm = ctx.get('llm') as CatalogFace | undefined
    if (llm === undefined) return
    probing = true
    void (async () => {
      try {
        let smallest: number | undefined
        for (const provider of llm.listProviders()) {
          for (const model of await llm.listModels(provider.id)) {
            const info = await llm.resolveModelInfo(provider.id, model.id)
            const window = info.context?.contextWindow
            if (typeof window !== 'number' || window <= 0) continue
            smallest = smallest === undefined ? window : Math.min(smallest, window)
          }
        }
        if (smallest !== undefined) {
          minWindow = smallest
          const value = live()
          const thresholdTokens = Math.floor(smallest * value.thresholdRatio)
          if (value.retainTokens >= thresholdTokens) {
            logger.warn(
              `retainTokens (${value.retainTokens}) is at or above the threshold tokens for the `
              + `smallest routed window (${smallest} x ${value.thresholdRatio} = ${thresholdTokens}); `
              + `automatic condensation will error per route until the threshold rises`,
            )
          } else {
            logger.info(`smallest routed context window: ${smallest} tokens`)
          }
        }
      } catch (error: unknown) {
        logger.warn(
          'context-window probe failed (retention guard disabled): '
          + `${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        probing = false
      }
    })()
  }

  /**
   * Hand the engine a frozen policy view carrying THIS module's two fields as
   * getters over the live refs: every engine policy re-read (per event) sees
   * the current General-row value with no re-apply step. Every other policy
   * field is carried over verbatim; `retainRatio` is dropped whenever the
   * absolute `retainTokens` is in force, because the engine treats the two as
   * mutually exclusive. Idempotent — re-run when the engine mounts late.
   */
  const installLivePolicy = (reason: string): void => {
    const compaction = ctx.get('compaction') as LiveCompactionEngine | undefined
    if (compaction === undefined) return
    const base = compaction.config
    if (base === undefined) return
    const current = live()
    const view: LiveCompactionPolicy = {
      ...base,
      get thresholdRatio() { return live().thresholdRatio },
      get retainTokens() { return live().retainTokens },
    }
    delete view.retainRatio
    compaction.config = Object.freeze(view)
    logger.info(
      `live policy installed (${reason}): thresholdRatio=${current.thresholdRatio} retainTokens=${current.retainTokens}`,
    )
  }

  // The engine may mount after this row, so install once its service appears.
  ctx.inject(['compaction'], () => {
    installLivePolicy('compaction-ready')
    probeWindows()
  })

  // dsh 0.1.7 settings model: the row entry IS the settings namespace. The
  // volatile threshold above is form-editable through `remote.settings` (the
  // write lands as a profile-layer patch override via the config editor), and
  // the getters re-read it live. The native auto-generated form is suppressed
  // in favor of this plugin's own General row — the same shape upstream
  // `agent-default-model` uses for its selection surface.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}

/** Mount the tuning as the row's whole apply (the row config is the settings base). */
export function apply(ctx: Context, config: ResolvedCompactionTuningConfig | undefined): void {
  installCompactionTuning(ctx, config ?? defaultCompactionTuningConfig)
}

export default { name, inject, Config, apply }
