/**
 * `dashr-compaction`: the settings-driven realm engine row (v0.1.8b
 * compaction rework).
 *
 * The DASHR preset includes the shipped `standard` preset, disables its
 * default-config `compaction-basic` row, and inserts THIS row into the same
 * `compaction` group — so the group's isolate realm, its `command-compact`
 * row, and its tool-result pruner all stay untouched, and this row's engine
 * is the ONE `compaction` service the realm resolves.
 *
 * At mount it reads the `dashr-compaction` settings section (registered once
 * on the host plane by `dashr-repl`; see {@link resolveCompactionConfig} for
 * the layer order) and constructs the upstream `BasicCompactionEngine` with
 * `auto: true` — the passive pre-step pressure path, exactly what the
 * disabled row provided, now under the tuned defaults (threshold 0.5, retain
 * 0.05, DeepSeek V4 Flash summarizer) instead of the upstream 0.8/0.16
 * defaults. Because the engine freezes its config at construction, an edit
 * applies to agents mounted afterwards (settings section `applies:
 * 'restart'`), never mid-session.
 *
 * A composition without a settings provider (or an unregistered namespace)
 * falls back to the row config and then the shared defaults, so the row
 * never needs settings to boot.
 * @module dashr-repl/compaction
 */

import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import z from '@deepseek-ai/schemastery'
import { DASHR_COMPACTION_NS, resolveCompactionConfig } from './compaction-shared.ts'
import type { DashrCompactionConfig } from './compaction-shared.ts'

/** Cordis plugin name. */
export const name = 'dashr-compaction'

/** The row config: the four tunable keys as optional overrides of the shared defaults. */
export interface Config extends Partial<DashrCompactionConfig> {}

/** Runtime schema (no defaults: absent keys fall through to the shared defaults). */
export const Config: z<Config> = z.object({
  thresholdRatio: z.number(),
  retainRatio: z.number(),
  summarizationProvider: z.string(),
  summarizationModel: z.string(),
})

/** The settings-provider read surface this row needs (structural; `ctx.get` is untyped). */
interface SettingsRead {
  get(ns: string): unknown
}

export function apply(ctx: Context, config: Config): void {
  const settings = ctx.get('settings') as SettingsRead | undefined
  const settingsValue = settings?.get(DASHR_COMPACTION_NS)
  const resolved = resolveCompactionConfig(
    config,
    typeof settingsValue === 'object' && settingsValue !== null
      ? settingsValue as Partial<DashrCompactionConfig>
      : undefined,
  )
  // auto: true is fixed: the passive pre-step pressure path is the whole
  // point of this row (the model-facing compact() bridge was removed in
  // v0.1.8b — compaction is the host's business, not the REPL's).
  const engineConfig: BasicCompactionConfig = { ...resolved, auto: true }
  ctx.plugin(BasicCompactionEngine, engineConfig)
}

export default { name, Config, apply }
