/**
 * dsh-llm-failover client half: registers the `failover` dictionaries and the
 * General settings row (two model selectors) into the `settings.general.item`
 * slot. No separate card.
 *
 * The row's three inject functions close over `ctx.remote` here, so the
 * component stays free of dsh remote types (narrow structural face only).
 *
 * @module dashr/failover/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the `settings.general.item` slot-contract merge (the
// General page status row's registration target).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `ctx.remote` face with `remote.settings` / `remote.session`.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-settings/types'
import { FAILOVER_SETTINGS_NS } from '../config.ts'
import { en, NS, zh } from './locales.ts'
import { FailoverRow, type FailoverRowInjected, type FailoverRowProps } from './FailoverRow.tsx'

export type { FailoverRowInjected, FailoverRowProps }
export { FailoverRow }

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.settings', 'remote.session']

/**
 * Register the `failover` dictionaries and the General settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-failover: dictionaries')

  ctx.slots.inject('settings.general.item', function* () {
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: 'failover',
      order: 100,
      locale: NS,
      inject: (): FailoverRowInjected => ({
        catalog: async () => {
          const response = await ctx.remote.session.modelCatalog()
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          return response.value.groups.flatMap((group) =>
            group.models.map((model) => `${group.id}/${model.id}`),
          )
        },
        loadConfig: async () => {
          const response = await ctx.remote.settings.describe()
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          const view = response.value.namespaces.find((entry) => entry.ns === FAILOVER_SETTINGS_NS)
          if (view === undefined) return null
          const value = view.value as { fallback1?: unknown; fallback2?: unknown }
          return {
            fallback1: typeof value.fallback1 === 'string' ? value.fallback1 : '',
            fallback2: typeof value.fallback2 === 'string' ? value.fallback2 : '',
            revision: view.revision,
          }
        },
        save: async (patch, revision) => {
          const response = await ctx.remote.settings.update(FAILOVER_SETTINGS_NS, patch, revision)
          if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`)
          return response.value.revision
        },
      }),
    }, FailoverRow)
  })
}
