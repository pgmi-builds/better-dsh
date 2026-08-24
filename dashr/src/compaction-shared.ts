/**
 * Shared compaction configuration for the settings-driven upstream engine
 * activation (v0.1.8b compaction rework).
 *
 * DASHR no longer mounts its own `RecencyAwareCompactionEngine`: the upstream
 * `BasicCompactionEngine` already runs per-agent inside the standard preset's
 * `compaction` group, and what the deployment needed was a CONFIGURATION, not
 * a second engine. The tuned values live in ONE place — this module — and
 * flow two ways:
 *
 * - the host-plane `dashr-repl` row registers them as the `dashr-compaction`
 *   settings section base (`applies: 'restart'`), so the WebUI exposes the
 *   knobs and a user layer overrides the base per deployment;
 * - the preset-local `dashr-compaction` row (subpath export `./compaction`)
 *   reads the resolved section at mount and constructs the upstream engine
 *   with it, falling back to the defaults below when no settings provider
 *   exists.
 *
 * The invariant `retainRatio < thresholdRatio` is the one cross-model rule
 * the engine itself machine-checks; validating it here too makes a bad edit
 * fail at settings-save time instead of at the next agent mount.
 * @module dashr-repl/compaction-shared
 */

import z from '@deepseek-ai/schemastery'

/** The settings namespace for the passive-compaction knobs. */
export const DASHR_COMPACTION_NS = 'dashr-compaction'

/** The four tunable keys (the upstream engine's config subset DASHR exposes). */
export interface DashrCompactionConfig {
  /** Compaction trigger: fraction of the routed model's context window (0.5 = half the window). */
  thresholdRatio: number
  /** Retained tail after compaction, as a fraction of the same window. Must stay below `thresholdRatio`. */
  retainRatio: number
  /** The summarizer's provider route (empty = inherit the conversation's own model). */
  summarizationProvider: string
  /** The summarizer's model id (empty = inherit the conversation's own model). */
  summarizationModel: string
}

/** The tuned defaults (user-decided: threshold 0.5, retain 0.05, DeepSeek V4 Flash summarizer). */
export const DASHR_COMPACTION_DEFAULTS: Readonly<DashrCompactionConfig> = Object.freeze({
  thresholdRatio: 0.5,
  retainRatio: 0.05,
  summarizationProvider: 'deepseek-official',
  summarizationModel: 'deepseek-v4-flash',
})

/** The settings-section schema: numeric bounds + the tuned defaults as schema defaults. */
export const DASHR_COMPACTION_SCHEMA = z.object({
  thresholdRatio: z.number().min(0).max(1).default(DASHR_COMPACTION_DEFAULTS.thresholdRatio),
  retainRatio: z.number().min(0).max(1).default(DASHR_COMPACTION_DEFAULTS.retainRatio),
  summarizationProvider: z.string().default(DASHR_COMPACTION_DEFAULTS.summarizationProvider),
  summarizationModel: z.string().default(DASHR_COMPACTION_DEFAULTS.summarizationModel),
})

/** The tunable key list, for picking known keys out of partially-specified inputs. */
const DASHR_COMPACTION_KEYS = ['thresholdRatio', 'retainRatio', 'summarizationProvider', 'summarizationModel'] as const

/**
 * Validate the cross-key invariant and numeric sanity the schema bounds alone
 * cannot express. Throws with an actionable message; returns the config
 * unchanged on success.
 */
export function validateCompactionConfig(config: DashrCompactionConfig): DashrCompactionConfig {
  if (!Number.isFinite(config.thresholdRatio) || config.thresholdRatio <= 0 || config.thresholdRatio > 1) {
    throw new Error(`dashr-compaction: thresholdRatio must be a finite number in (0, 1], got ${JSON.stringify(config.thresholdRatio)}`)
  }
  if (!Number.isFinite(config.retainRatio) || config.retainRatio < 0 || config.retainRatio >= 1) {
    throw new Error(`dashr-compaction: retainRatio must be a finite number in [0, 1), got ${JSON.stringify(config.retainRatio)}`)
  }
  if (config.retainRatio >= config.thresholdRatio) {
    throw new Error(`dashr-compaction: retainRatio (${config.retainRatio}) must stay below thresholdRatio (${config.thresholdRatio}) — at or above it every compaction keeps everything`)
  }
  return config
}

/**
 * Resolve the engine config: defaults ← row config ← settings value, then
 * validate. Partial inputs only carry the tunable keys; `undefined` fields
 * never shadow a lower layer.
 */
export function resolveCompactionConfig(
  row: Partial<DashrCompactionConfig> | undefined,
  settings: Partial<DashrCompactionConfig> | undefined,
): DashrCompactionConfig {
  const merged: Record<string, unknown> = { ...DASHR_COMPACTION_DEFAULTS }
  for (const layer of [row, settings]) {
    if (layer === undefined) continue
    for (const key of DASHR_COMPACTION_KEYS) {
      const value = layer[key]
      if (value !== undefined) merged[key] = value
    }
  }
  return validateCompactionConfig(merged as unknown as DashrCompactionConfig)
}
