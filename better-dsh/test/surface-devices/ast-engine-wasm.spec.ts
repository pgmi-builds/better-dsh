import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { astEngine, assetPath } from '../../src/devices/ast/engine/wasm.ts'
import { ENGINE_ASSETS, GRAMMAR_ASSETS } from '../../src/devices/ast/engine/grammar-manifest.mjs'

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
  it('resolves every manifest asset to an existing file (dev or bundled layout)', () => {
    // 回归网：dev 下 14 个语法分属 14 个包、tree-sitter.wasm 在 web-tree-sitter，
    // 不得把全部资产指到同一个目录（先于 build 的 dev 树即此形态）。
    const files = [
      ...ENGINE_ASSETS.map(a => a.file),
      ...Object.values(GRAMMAR_ASSETS).map(a => a.file),
    ]
    expect(files).toHaveLength(16)
    for (const file of files) expect(existsSync(assetPath(file)), file).toBe(true)
  })
})


