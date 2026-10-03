import { describe, expect, it } from 'vitest'
import { findInSource } from '../../src/devices/ast/engine/match.ts'

describe('engine/match', () => {
  it('reports 1-based lines/columns and UTF-8 byte offsets', async () => {
    const source = 'const 世界 = "汉字"\nconst b = foo(世界)\n'
    const { matches } = await findInSource(source, 'typescript', 'foo($A)', {})
    expect(matches).toHaveLength(1)
    expect(matches[0]!.text).toBe('foo(世界)')
    expect(matches[0]!.byteStart).toBe(34)          // native 实测同值
    expect(matches[0]!.startLine).toBe(2)           // 1-based
    expect(matches[0]!.startColumn).toBe(11)
  })

  it('collects meta variables; multi-metavar reproduces the native Debug string', async () => {
    const source = 'greet(1, 2, 3)\n'
    const { matches } = await findInSource(source, 'typescript', 'greet($$$A)', { includeMeta: true })
    expect(matches[0]!.metaVariables).toEqual({ A: '[1, ,, 2, ,, 3]' })
  })

  it('turns a multi-root pattern into zero matches, not a throw (native parity)', async () => {
    // golden 值取自 shipped pi-natives 的 A/B 实测（spec §2.1）：native 对同样
    // 输入同样返回 0 命中 —— ast-grep 上游语义，不是 WASM 退化。
    // 注：本用例用的是 JSON 多根 pattern（`"alpha": $V`）—— wasm findAll 对它
    // 真实抛 "Multiple AST nodes are detected"，native 实测 0 命中（A/B 复核）。
    // brief 原稿的 TS 用例（`function $N($$$A) { $$$B }` on `function f(a)…`）
    // 在 wasm 与 native（18.2.11）上实测都是 1 命中，不抛错——其 0 值来自
    // spike 用了无函数的源码，不能作为 golden，故换成本等价用例。
    const { matches } = await findInSource('{"alpha": 1}\n', 'json', '"alpha": $V', {})
    expect(matches).toEqual([])
  })
  it('reproduces the native zero-hit quirks for C and CSS (upstream ambiguity)', async () => {
    // golden 值取自 shipped pi-natives 的 A/B 实测（spec §2.1）：native 对同样
    // 输入同样返回 0 命中 —— ast-grep 上游语义，不是 WASM 退化。
    const c = await findInSource('int main(void){ return foo(1); }\n', 'c', 'foo($A)', {})
    expect(c.matches).toEqual([])
    const css = await findInSource('.a { color: red; margin: 0 }\n', 'css', 'color: $V', {})
    expect(css.matches).toEqual([])
  })
})
