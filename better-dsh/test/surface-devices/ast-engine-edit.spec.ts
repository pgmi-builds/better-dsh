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

  it('records a multi-root pattern in patternErrors, no throw', async () => {
    // 0.2.6 契约扩展：多根 pattern（`"alpha": $V`）不再静默 continue——
    // patternErrors 记 pattern → 底层消息，该 pattern 不产出编辑（ast spec
    // "Diagnostic fields (deliberate divergence from the native predecessor)"）。
    // wasm findAll 对它真实抛 "Multiple AST nodes are detected"，native astEdit
    // 实测 totalReplacements=0 且无 parseErrors（spike editprobe.mjs + A/B 复核）。
    // brief 原稿的 TS 用例（`function $N($$$A) { $$$B }` on `function f(a)…`）
    // 在 wasm 与 native（18.2.11）上实测都是 1 次替换、不抛错——其 0 值来自
    // spike 用了无函数的源码，不能作为 golden，故换成本等价用例。
    const r = await editSource('{"alpha": 1}\n', 'json', { '"alpha": $V': '"alpha": 9' })
    expect(r.totalReplacements).toBe(0)
    expect(r.patternErrors?.['"alpha": $V']).toContain('Multiple AST nodes are detected')
  })

  it('returns a rewritten string with every matched site replaced (multi-edit golden)', async () => {
    const r = await editSource(
      'const a = foo(1)\nconst b = foo(2)\nconst c = foo(3)\n',
      'typescript',
      { 'foo($A)': 'bar($A)' },
    )
    expect(r.totalReplacements).toBe(3)
    expect(r.rewritten).toBe('const a = bar(1)\nconst b = bar(2)\nconst c = bar(3)\n')
  })

  it('drops edits that overlap an accepted edit and counts them in `overlapping`', async () => {
    // 同一调用上 'foo($A)' 命中 [10,16)、'foo' 命中 [10,13)：后一编辑与已接受
    // 区间重叠，必须丢弃——不丢则 commitEdits 下被遮蔽的编辑静默消失，而
    // changes[] 仍报告它（probe 实证）。先入列的 pattern 胜。
    const r = await editSource('const a = foo(1)\n', 'typescript', { 'foo($A)': 'bar($A)', foo: 'baz' })
    expect(r.overlapping).toBe(1)
    expect(r.totalReplacements).toBe(1)
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]!.after).toBe('bar(1)')
    expect(r.rewritten).toBe('const a = bar(1)\n')
  })

  it('keeps adjacent (non-overlapping) edits from different patterns', async () => {
    const r = await editSource('const a = foo(1)\n', 'typescript', { 'foo($A)': 'bar($A)', a: 'x' })
    expect(r.overlapping).toBe(0)
    expect(r.totalReplacements).toBe(2)
    expect(r.rewritten).toBe('const x = bar(1)\n')
  })
})
