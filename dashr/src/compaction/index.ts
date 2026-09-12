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
 *   - it installs the `compaction-tuning` settings namespace, whose composition
 *     base layer is this module's spec defaults (a deployment may override them
 *     from a `cordis.patch.yml` row) — so a value written from the General row
 *     persists through the ordinary settings provider and survives a restart;
 *   - on install, and on every committed settings change, it re-applies the
 *     resolved value onto the LIVE engine by replacing `ctx.compaction.config`.
 *
 * Replacing that object reference is sufficient and safe: `compactIfNeeded()`
 * and `summarize()` both re-read `this.config` through `resolveTargetPolicy()`
 * on every event, so a new threshold takes effect at the next step boundary
 * with no restart and no engine reload. Every other policy field (modelPolicies,
 * summarization target, retry counts) is carried over verbatim; `retainRatio` is
 * dropped whenever an absolute `retainTokens` is in force, because the engine
 * treats the two as mutually exclusive.
 *
 * Scope limit, upstream and NOT fixable here: the manual `/compact` path calls
 * `selectCompactableRange(session, measurement, 0)` with a hard-coded zero
 * recency budget, so it ignores `retainRatio`/`retainTokens` entirely. This
 * preference therefore tunes AUTOMATIC condensation only.
 *
 * @module dashr/compaction
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  COMPACTION_SETTINGS_NS, DEFAULT_RETAIN_TOKENS, DEFAULT_THRESHOLD_RATIO,
  THRESHOLD_MAX_RATIO, THRESHOLD_MIN_RATIO,
  defaultCompactionTuningConfig,
  type CompactionTuningConfig,
} from './config.ts'

/**
 * The `compaction-tuning` settings schema.
 *
 * `thresholdRatio` is the field the General row drives; `retainTokens` is
 * composition-only (see {@link DEFAULT_RETAIN_TOKENS}) but still validated and
 * applied, so the recency window keeps one source of truth.
 */
export const Config = z.object({
  thresholdRatio: z.number()
    .step(0.01).min(THRESHOLD_MIN_RATIO).max(THRESHOLD_MAX_RATIO)
    .default(DEFAULT_THRESHOLD_RATIO),
  retainTokens: z.number().step(1).min(0).default(DEFAULT_RETAIN_TOKENS),
}) as unknown as z<CompactionTuningConfig>

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
 * Install the settings namespace and keep the live compaction engine in sync.
 * @param ctx - host context of the row that owns this capability.
 * @param config - composition base layer; schema defaults fill the rest.
 */
export function installCompactionTuning(
  ctx: Context,
  config: CompactionTuningConfig = defaultCompactionTuningConfig,
): void {
  const logger = ctx.logger('compaction-tuning')
  let source = (): CompactionTuningConfig => Config(config)

  /** Smallest routed context window seen so far (advisory guard, best effort). */
  let minWindow: number | undefined
  let probing = false

  /**
   * Learn the routed context windows so a write can be refused when it would
   * leave `retainTokens >= floor(window x thresholdRatio)` — the condition
   * under which the engine raises `TargetPressureConfigError` per route and
   * automatic condensation quietly stops for that route.
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
          logger.info(`smallest routed context window: ${smallest} tokens`)
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
   * Overwrite only this module's two fields on the engine's current policy and
   * hand the engine a fresh frozen object.
   * @param reason - short diagnostic tag for the log line.
   */
  const push = (reason: string): void => {
    const compaction = ctx.get('compaction') as LiveCompactionEngine | undefined
    if (compaction === undefined) return
    const base = compaction.config
    if (base === undefined) return
    const value = source()
    const next: LiveCompactionPolicy = {
      ...base,
      thresholdRatio: value.thresholdRatio,
      retainTokens: value.retainTokens,
    }
    delete next.retainRatio
    compaction.config = Object.freeze(next)
    logger.info(
      `applied (${reason}): thresholdRatio=${value.thresholdRatio} retainTokens=${value.retainTokens}`,
    )
  }

  // The engine may mount after this row, so re-apply once its service appears.
  ctx.inject(['compaction'], () => {
    push('compaction-ready')
    probeWindows()
  })

  ctx.inject(['settings'], (settingsCtx) => {
    // A deployment may already serve this namespace — a path-mounted copy of
    // this row during development, or a future native surface. The existing
    // provider wins; failing the whole plugin over an overlap would be worse
    // than skipping a duplicate install.
    if (settingsCtx.settings.get(COMPACTION_SETTINGS_NS) !== undefined) {
      logger.info('settings namespace already served; leaving it to its owner')
      return
    }
    settingsCtx.settings.installSection(ctx, COMPACTION_SETTINGS_NS, Config, Config(config), {
      setSource: (current) => {
        source = current
      },
      onChange: () => {
        push('settings-updated')
      },
      validate: (value) => {
        if (minWindow === undefined) return
        const thresholdTokens = Math.floor(minWindow * value.thresholdRatio)
        if (value.retainTokens >= thresholdTokens) {
          throw new Error(
            `retainTokens (${value.retainTokens}) must stay below the threshold tokens for every `
            + `routed model; the smallest window here is ${minWindow}, so ${value.thresholdRatio} `
            + `leaves only ${thresholdTokens}`,
          )
        }
      },
    })
    push('settings-installed')
    probeWindows()
  })
}
