import { describe, expect, it } from 'vitest'
import { editSource } from '../../src/devices/ast/engine/edit.ts'

describe('engine/edit', () => {
  it('substitutes single and multi meta variables in the replacement template', async () => {
    const one = await editSource('const a = foo(42)\n', 'typescript', { 'foo($A)': 'bar($A)' })
    expect(one.changes[0]!.after).toBe('bar(42)')          // native 实测同值
    const many = await editSource('greet(1, 2, 3)\n', 'typescript', { 'greet($$$A)': 'log($$$A)' })
    expect(many.changes[0]!.after).toBe('log(1, 2, 3)')    // native 实测同值
  })

  it('collapses an anonymous metavar to empty and keeps literals literal', async () => {
    const anon = await editSource('const a = foo(42)\n', 'typescript', { 'foo($A)': 'bar($_)' })
    expect(anon.changes[0]!.after).toBe('bar()')
    const lit = await editSource('const a = foo(42)\n', 'typescript', { 'foo($A)': 'bar(1)' })
    expect(lit.changes[0]!.after).toBe('bar(1)')
  })

  it('records a multi-root pattern as zero replacements, no throw', async () => {
    // 用 JSON 多根 pattern（`"alpha": $V`）：wasm findAll 对它真实抛
    // "Multiple AST nodes are detected"，native astEdit 实测 totalReplacements=0
    // 且无 parseErrors（spike editprobe.mjs + 本轮 A/B 复核）。
    // brief 原稿的 TS 用例（`function $N($$$A) { $$$B }` on `function f(a)…`）
    // 在 wasm 与 native（18.2.11）上实测都是 1 次替换、不抛错——其 0 值来自
    // spike 用了无函数的源码，不能作为 golden，故换成本等价用例。
    const r = await editSource('{"alpha": 1}\n', 'json', { '"alpha": $V': '"alpha": 9' })
    expect(r.totalReplacements).toBe(0)
  })
})
