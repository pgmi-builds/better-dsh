import { describe, expect, it } from 'vitest'
import {
  DASHR_COMPACTION_DEFAULTS,
  DASHR_COMPACTION_NS,
  resolveCompactionConfig,
  validateCompactionConfig,
} from '../src/compaction-shared.ts'

describe('resolveCompactionConfig (the tuned defaults + settings layer merge)', () => {
  it('returns the tuned defaults when every layer is absent', () => {
    expect(resolveCompactionConfig(undefined, undefined)).toEqual({
      thresholdRatio: 0.5,
      retainRatio: 0.05,
      summarizationProvider: 'deepseek-official',
      summarizationModel: 'deepseek-v4-flash',
    })
  })

  it('lets the row config override individual defaults without dropping the rest', () => {
    expect(resolveCompactionConfig({ thresholdRatio: 0.3 }, undefined)).toMatchObject({
      thresholdRatio: 0.3,
      retainRatio: DASHR_COMPACTION_DEFAULTS.retainRatio,
      summarizationModel: DASHR_COMPACTION_DEFAULTS.summarizationModel,
    })
  })

  it('lets the settings layer win over both the defaults and the row config', () => {
    expect(resolveCompactionConfig(
      { thresholdRatio: 0.3, summarizationModel: 'row-model' },
      { retainRatio: 0.02, summarizationModel: 'settings-model' },
    )).toMatchObject({
      thresholdRatio: 0.3,
      retainRatio: 0.02,
      summarizationProvider: DASHR_COMPACTION_DEFAULTS.summarizationProvider,
      summarizationModel: 'settings-model',
    })
  })

  it('ignores undefined fields in partial layers (no accidental shadowing)', () => {
    expect(resolveCompactionConfig({ thresholdRatio: undefined }, undefined).thresholdRatio)
      .toBe(DASHR_COMPACTION_DEFAULTS.thresholdRatio)
  })

  it('treats an empty-string summarizer route as a legitimate inherit-me value', () => {
    const resolved = resolveCompactionConfig(undefined, { summarizationProvider: '', summarizationModel: '' })
    expect(resolved.summarizationProvider).toBe('')
    expect(resolved.summarizationModel).toBe('')
  })
})

describe('validateCompactionConfig (the cross-key invariant the engine also enforces)', () => {
  it('accepts the defaults', () => {
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS })).not.toThrow()
  })

  it('rejects retainRatio at or above thresholdRatio', () => {
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, retainRatio: 0.5 }))
      .toThrow(/retainRatio .* must stay below thresholdRatio/)
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, retainRatio: 0.7, thresholdRatio: 0.5 }))
      .toThrow(/retainRatio .* must stay below thresholdRatio/)
  })

  it('rejects out-of-range threshold ratios', () => {
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, thresholdRatio: 0 }))
      .toThrow(/thresholdRatio/)
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, thresholdRatio: 1.2 }))
      .toThrow(/thresholdRatio/)
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, thresholdRatio: Number.NaN }))
      .toThrow(/thresholdRatio/)
  })

  it('rejects retain ratios at 1 or above', () => {
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, retainRatio: 1 }))
      .toThrow(/retainRatio/)
    expect(() => validateCompactionConfig({ ...DASHR_COMPACTION_DEFAULTS, retainRatio: -0.1 }))
      .toThrow(/retainRatio/)
  })
})

describe('the settings namespace', () => {
  it('is the single stable registration id the host row and the realm rows share', () => {
    expect(DASHR_COMPACTION_NS).toBe('dashr-compaction')
  })
})
