/**
 * Compaction-tuning client half: registers the `compaction-tuning` dictionaries
 * and its General settings row (one threshold stepper) into the
 * `settings.general.item` slot. No separate card.
 *
 * The row's two inject functions close over `ctx.remote` here, so the component
 * stays free of dsh remote types (narrow structural face only).
 *
 * @module dashr/compaction/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the `settings.general.item` slot-contract merge (the
// General page status row's registration target).
import type { } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `ctx.remote` face with `remote.settings`.
import type { } from '@deepseek-ai/dsh-api-remotes/client'
import { COMPACTION_SETTINGS_NS, DEFAULT_THRESHOLD_RATIO } from '../config.ts'
import { en, zh } from './locales.ts'
import { CompactionRow, type CompactionRowInjected, type CompactionRowProps } from './CompactionRow.tsx'

export type { CompactionRowInjected, CompactionRowProps }
export { CompactionRow }

/**
 * Register the dictionaries and the General settings row.
 *
 * Called from the plugin's client entry, which already injects `locale`,
 * `slots` and `remote.settings`.
 *
 * @param ctx - client root context.
 */
export function setupCompactionRow(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.locale.register(COMPACTION_SETTINGS_NS, { zh, en }),
    'compaction-tuning: dictionaries',
  )

  ctx.slots.inject('settings.general.item', function*() {
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: COMPACTION_SETTINGS_NS,
      order: 110,
      locale: COMPACTION_SETTINGS_NS,
      inject: (): CompactionRowInjected => ({
        loadConfig: async () => {
          const response = await ctx.remote.settings.describe()
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          const view = response.value.namespaces.find((entry) => entry.ns === COMPACTION_SETTINGS_NS)
          if (view === undefined) return null
          const value = view.value as { thresholdRatio?: unknown }
          return {
            thresholdRatio: typeof value.thresholdRatio === 'number'
              ? value.thresholdRatio
              : DEFAULT_THRESHOLD_RATIO,
            revision: view.revision,
          }
        },
        save: async (patch, revision) => {
          const response = await ctx.remote.settings.update(COMPACTION_SETTINGS_NS, patch, revision)
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          return response.value.revision
        },
      }),
    }, CompactionRow)
  })
}
