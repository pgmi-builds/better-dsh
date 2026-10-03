import { describe, expect, it } from 'vitest'
import { astEngine, assetPath } from '../../src/devices/ast/engine/wasm.ts'
import { GRAMMAR_ASSETS } from '../../src/devices/ast/engine/grammar-manifest.mjs'

describe('ast WASM engine boot', () => {
  it('boots, parses, and memoizes the singleton', async () => {
    const a = await astEngine()
    // 本 @ast-grep/wasm 构建零内置语言：parse 前必须 registerDynamicLanguage
    await a.registerLanguages({
      python: { libraryPath: assetPath(GRAMMAR_ASSETS.python!.file), expandoChar: 'µ' },
    })
    const root = await a.parse('python', 'def f(n):\n    return n\n')
    expect(root.root().findAll('return $X')).toHaveLength(1)
    const b = await astEngine()
    expect(b).toBe(a)
  })
})
