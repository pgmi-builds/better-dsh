import { describe, expect, it } from 'vitest'
import { AST_LANGUAGES, EXTENSION_TO_LANGUAGE, languageForPath } from '../../src/devices/ast/engine/language-map.ts'
import { ensureLanguages, isLanguageAvailable } from '../../src/devices/ast/engine/grammars.ts'

describe('language map (single source of truth)', () => {
  it('maps the probed extension set onto 14 grammars', () => {
    expect(languageForPath('a/b/c.ts')).toBe('typescript')
    expect(languageForPath('a/b/c.mts')).toBe('typescript')
    expect(languageForPath('x/y.PY')).toBe('python')            // 大小写不敏感
    expect(languageForPath('x/y.md')).toBeUndefined()
  })
  it('every mapped language is registered and available', async () => {
    await ensureLanguages()
    expect(AST_LANGUAGES).toHaveLength(14)
    for (const lang of AST_LANGUAGES) expect(isLanguageAvailable(lang), lang).toBe(true)
  })
})
