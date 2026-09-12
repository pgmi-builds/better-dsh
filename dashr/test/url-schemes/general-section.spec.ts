import { describe, expect, it } from 'vitest'
import { generalSection, GENERAL_SECTION_NAME } from '../../src/url-schemes/general-section.ts'

describe('url-schema:general guidance section', () => {
  it('renders only while the URL capability is enabled (gated disclosure)', () => {
    expect(generalSection({ urlSchemes: false, hashline: true })).toBeUndefined()
    expect(generalSection({ urlSchemes: true, hashline: false })).toBeDefined()
  })

    it('surfaces the url-schemes-instruction.md section (single disclosure point)', async () => {
    const section = generalSection({ urlSchemes: true, hashline: true })
    expect(section).toBeDefined()
    expect(section!.name).toBe(GENERAL_SECTION_NAME)
    expect(section!.text).toContain('# Internal URL Schemes')
    for (const token of ['skill://', 'agent://', 'dsh://', 'ctx://', 'dvc://', 'http(s)://']) {
      expect(section!.text).toContain(token)
    }
    expect(section!.text).toContain(':raw:N-M')
    expect(section!.text).toContain('ctx://session/<face>')
    expect(section!.text).toContain('dvc://<device>')
  })
})
