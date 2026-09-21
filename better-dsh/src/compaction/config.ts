/**
 * The `compaction-tuning` General-row config: the share of the routed context
 * window at which automatic condensation starts.
 *
 * Pure module — no `@deepseek-ai/*` value imports — so the host half and the
 * client half may both import it without dragging either runtime into the
 * browser bundle: the host takes the namespace and the schema defaults, the
 * client takes the namespace literal plus the stepper bounds.
 *
 * @module dashr/compaction/config
 */

/** The settings namespace the General row reads and writes. */
export const COMPACTION_SETTINGS_NS = 'compaction-tuning'

/** Upstream `compaction-basic`'s own default: condense at 80% of the window. */
export const DEFAULT_THRESHOLD_RATIO = 0.8

/**
 * Absolute recent-tail budget, in estimated tokens (~50 KB of English text).
 *
 * Composition-only, deliberately: the General row drives `thresholdRatio`
 * alone, so the recency window stays a deployment decision (its base layer is
 * the row config in `cordis.patch.yml`) rather than a second knob on the
 * settings page. The host half still applies it to the engine.
 */
export const DEFAULT_RETAIN_TOKENS = 50000

/** Ratio bounds the settings schema accepts (a config file may use either end). */
export const THRESHOLD_MIN_RATIO = 0.05

/** @see THRESHOLD_MIN_RATIO */
export const THRESHOLD_MAX_RATIO = 1

/** Whole-percent bounds for the General row's stepper. */
export const THRESHOLD_MIN_PERCENT = 10

/** @see THRESHOLD_MIN_PERCENT */
export const THRESHOLD_MAX_PERCENT = 95

/** Percent moved per arrow click (a stepper cannot express an arbitrary value). */
export const THRESHOLD_STEP_PERCENT = 5

/** The `compaction-tuning` settings value. */
export interface CompactionTuningConfig {
  /** Condense at `floor(routedContextWindow x thresholdRatio)`. */
  thresholdRatio: number
  /** Verbatim recent tail, in estimated tokens. */
  retainTokens: number
}

/** Spec defaults — `Config({})` must equal this. */
export const defaultCompactionTuningConfig: CompactionTuningConfig = {
  thresholdRatio: DEFAULT_THRESHOLD_RATIO,
  retainTokens: DEFAULT_RETAIN_TOKENS,
}
