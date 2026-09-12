/**
 * The compaction General settings row: one stepper for the automatic-
 * condensation threshold.
 *
 * Geometry, controls and copy mirror the shipped Font-size row — title +
 * description on the left, a `%`-suffixed stepper pill on the right — so the
 * General page keeps one visual rhythm. Data rides the two narrow inject
 * functions (`loadConfig` / `save`) so this component stays free of dsh remote
 * types.
 *
 * Like Font-size there is no Save button: each click writes one step. Because
 * every step IS a settings write, they are serialized latest-wins, so a burst
 * of clicks cannot race the revision fence.
 *
 * @module dashr/compaction/client/CompactionRow
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.general.item` SlotMap entry (owner props empty).
import type { } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  COMPACTION_SETTINGS_NS,
  THRESHOLD_MAX_PERCENT, THRESHOLD_MIN_PERCENT, THRESHOLD_STEP_PERCENT,
} from '../config.ts'
import css from './CompactionRow.module.css'

/** Injected dependencies of {@link CompactionRow} (slot `inject`). */
export interface CompactionRowInjected {
  /** Read the namespace's resolved threshold + revision (null when absent). */
  loadConfig(): Promise<{ thresholdRatio: number; revision?: number } | null>
  /** Merge one threshold step into the namespace; returns the post-write revision. */
  save(patch: { thresholdRatio: number }, revision?: number): Promise<number | undefined>
}

/** Props delivered by the slot outlet: runtime share + locale seat + inject face. */
export type CompactionRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<typeof COMPACTION_SETTINGS_NS> & CompactionRowInjected

/** Render the compaction-threshold row. */
export function CompactionRow({ t, loadConfig, save }: CompactionRowProps): ReactNode {
  const [percent, setPercent] = useState<number | null>(null)
  const [absent, setAbsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revisionRef = useRef<number | undefined>(undefined)
  const pendingRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const current = await loadConfig()
        if (!alive) return
        // The area registers the row only for a deployment whose host half
        // actually serves the namespace. Without it there is nothing to read
        // and nothing to write, so the row draws nothing at all rather than a
        // dead control (the settings card contract for an unserved namespace).
        if (current === null) {
          setAbsent(true)
          return
        }
        revisionRef.current = current.revision
        setPercent(Math.round(current.thresholdRatio * 100))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [loadConfig])

  /** Write the newest pending step; the revision always comes from the last commit. */
  const flush = (): void => {
    if (inFlightRef.current || pendingRef.current === null) return
    const next = pendingRef.current
    pendingRef.current = null
    inFlightRef.current = true
    void save({ thresholdRatio: next / 100 }, revisionRef.current).then(
      (revision) => {
        revisionRef.current = revision
        inFlightRef.current = false
        setError(null)
        flush()
      },
      (err: unknown) => {
        inFlightRef.current = false
        pendingRef.current = null
        setError(err instanceof Error ? err.message : String(err))
        // Put the display back on the committed value the host still holds.
        void (async () => {
          try {
            const current = await loadConfig()
            if (current === null) return
            revisionRef.current = current.revision
            setPercent(Math.round(current.thresholdRatio * 100))
          } catch {
            // The write failure above is already on screen.
          }
        })()
      },
    )
  }

  const step = (delta: number): void => {
    if (percent === null) return
    const next = Math.min(THRESHOLD_MAX_PERCENT, Math.max(THRESHOLD_MIN_PERCENT, percent + delta))
    if (next === percent) return
    setPercent(next)
    setError(null)
    pendingRef.current = next
    flush()
  }

  if (absent) return null

  return (
    <div className={css.thresholdRow}>
      <div className={css.thresholdText}>
        <div className={css.thresholdTitle}>{t('title')}</div>
        <div className={css.thresholdDesc}>{t('description')}</div>
        {error !== null ? <div className={css.thresholdError}>{t('error', { message: error })}</div> : null}
      </div>
      <div className={css.thresholdControl}>
        <div className={css.thresholdStepper}>
          <span className={css.thresholdValue}>{percent === null ? '–' : String(percent)}</span>
          <span className={css.thresholdArrows}>
            <button
              type="button"
              className={css.thresholdArrow}
              aria-label={t('increase')}
              disabled={percent === null || percent >= THRESHOLD_MAX_PERCENT}
              onClick={() => { step(THRESHOLD_STEP_PERCENT) }}
            >
              <IconChevronUpOutline14 size={9} />
            </button>
            <button
              type="button"
              className={css.thresholdArrow}
              aria-label={t('decrease')}
              disabled={percent === null || percent <= THRESHOLD_MIN_PERCENT}
              onClick={() => { step(-THRESHOLD_STEP_PERCENT) }}
            >
              <IconChevronDownOutline14 size={9} />
            </button>
          </span>
        </div>
        <span className={css.thresholdUnit}>{t('unit')}</span>
      </div>
    </div>
  )
}
