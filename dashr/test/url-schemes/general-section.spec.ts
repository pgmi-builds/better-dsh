import { describe, expect, it } from 'vitest'
import { generalSection, GENERAL_SECTION_NAME } from '../../src/url-schemes/general-section.ts'

describe('url-schema:general guidance section', () => {
  it('renders only while the URL capability is enabled (gated disclosure)', () => {
    expect(generalSection({ urlSchemes: false, hashline: true })).toBeUndefined()
    expect(generalSection({ urlSchemes: true, hashline: false })).toBeDefined()
  })

  it('surfaces the enriched URL section from url-schemes-section.md (the single disclosure point)', () => {
    const section = generalSection({ urlSchemes: true, hashline: true })
    expect(section).toBeDefined()
    expect(section!.name).toBe(GENERAL_SECTION_NAME)
    expect(section!.text).toContain('Internal URLs')
    // Regression guard: every registered scheme stays visible to the model
    // (ctx:// was absent from every model-facing enumeration from 074b6ae
    // (v0.1.8c) onward — the whole point of the catalogue).
    for (const scheme of ['skill://', 'agent://', 'dsh://', 'ctx://', 'dvc://', 'http(s)://']) {
      expect(section!.text).toContain(scheme)
    }
    // Composite-selector clause: line windows index the canonical full content.
    expect(section!.text).toContain(':raw:N-M')
    // Read-only disclaimer: only dvc:// writes.
    expect(section!.text).toContain('read-only')
    // ctx:// face coverage (first-level resource enumeration per scheme).
    for (const face of ['transcript', 'thinking', 'system']) {
      expect(section!.text).toContain(face)
    }
  })
})
