/**
 * The failover General settings row: two fallback model selectors, each fed by
 * the live LLM catalog and defaulting to "not set" (native no-failover).
 *
 * Read-only geometry is the upstream Setting-Cell; the two `<select>`s are the
 * control surface (no separate card). Data rides the three narrow inject
 * functions (`catalog` / `loadConfig` / `save`) so this component stays free of
 * dsh remote types.
 *
 * @module dashr/failover/client/FailoverRow
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.general.item` SlotMap entry (owner props empty).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './FailoverRow.module.css'

/** Injected dependencies of {@link FailoverRow} (slot `inject`). */
export interface FailoverRowInjected {
  /** List every `provider/model` route in the live LLM catalog. */
  catalog(): Promise<string[]>
  /** Read the `failover` namespace's resolved value + revision (null when absent). */
  loadConfig(): Promise<{ fallback1: string; fallback2: string; revision?: number } | null>
  /** Merge a slot patch into the namespace; returns the post-write revision. */
  save(patch: { fallback1?: string; fallback2?: string }, revision?: number): Promise<number | undefined>
}

/** Props delivered by the slot outlet: runtime share + locale seat + inject face. */
export type FailoverRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'failover'> & FailoverRowInjected

interface Loaded {
  routes: string[]
  config: { fallback1: string; fallback2: string }
  revision: number | undefined
}

/** Render the failover row: title + two model selectors. */
export function FailoverRow({ catalog, loadConfig, save, t }: FailoverRowProps): ReactNode {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [routes, cfg] = await Promise.all([catalog(), loadConfig()])
        if (!alive) return
        setLoaded({ routes, config: cfg ?? { fallback1: '', fallback2: '' }, revision: cfg?.revision })
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [catalog, loadConfig])

  const select = async (slot: 'fallback1' | 'fallback2', value: string): Promise<void> => {
    if (loaded === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const nextRevision = await save({ [slot]: value }, loaded.revision)
      setLoaded({ ...loaded, config: { ...loaded.config, [slot]: value }, revision: nextRevision })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const routes = loaded?.routes ?? []
  const renderSelect = (slot: 'fallback1' | 'fallback2', label: string): ReactNode => {
    const value = loaded?.config[slot] ?? ''
    return (
      <div className={css.slot}>
        <span className={css.slotLabel}>{label}</span>
        <select
          className={css.select}
          value={value}
          disabled={saving || loaded === null}
          onChange={(event) => { void select(slot, event.target.value) }}
        >
          <option value="">{t('not-set')}</option>
          {routes.map((route) => (
            <option key={route} value={route}>{route}</option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className={css.row}>
      <div className={css.title}>{t('title')}</div>
      {error !== null ? <div className={css.alert} role="alert">{t('error', { message: error })}</div> : null}
      <div className={css.slots}>
        {renderSelect('fallback1', t('fallback1'))}
        {renderSelect('fallback2', t('fallback2'))}
      </div>
    </div>
  )
}
