import { describe, expect, it } from 'vitest'
import { findInSource } from '../../src/devices/ast/engine/match.ts'
import { ensureLanguages, isLanguageAvailable } from '../../src/devices/ast/engine/grammars.ts'

/**
 * 全语言正命中矩阵（spec §6 `expandoChar 静默失效` 处置的落地）。
 *
 * `ensureLanguages` 的注册自检只 parse 空源，探测不到"注册成功但 pattern 静默
 * 0 命中"的坑（漏给 expandoChar 'µ' 时 python/rust/go 会静默 0 命中，不报错）。
 * 本矩阵对 14 个语言各跑一条已知正命中 pattern——任何语言退化成 0 命中即红。
 * 用例全部来自 spike 实证（spec §2.1 + 本轮 empirical 复测），经真实引擎驱动。
 */
const MATRIX: ReadonlyArray<{ lang: string, source: string, pattern: string, expectText?: string }> = [
  { lang: 'python', source: 'def f(n):\n    return n\n', pattern: 'return $X', expectText: 'return n' },
  { lang: 'javascript', source: 'const x = foo(1, 2);\n', pattern: 'foo($$$A)', expectText: 'foo(1, 2)' },
  { lang: 'typescript', source: 'function f(a: number) { return g(a) }\n', pattern: 'g($A)', expectText: 'g(a)' },
  { lang: 'tsx', source: 'export const A = () => <div>hi</div>\n', pattern: '<div>$$$K</div>', expectText: '<div>hi</div>' },
  { lang: 'rust', source: 'fn main() { let v = vec![1, 2]; }\n', pattern: 'vec![$$$A]', expectText: 'vec![1, 2]' },
  { lang: 'go', source: 'package main\nfunc main() { x := foo(1) }\n', pattern: 'foo($A)', expectText: 'foo(1)' },
  // C 的裸 `foo($A)` 是上游已知 0 命中（pattern 上下文歧义，spec §2.1）——用 return 包裹形。
  { lang: 'c', source: 'int main(void){ return foo(1); }\n', pattern: 'return foo($A)', expectText: 'return foo(1);' },
  { lang: 'cpp', source: 'int main(){ return bar(1); }\n', pattern: 'bar($A)', expectText: 'bar(1)' },
  { lang: 'html', source: '<div class="x">hi</div>\n', pattern: '<div class=$C>$$$K</div>', expectText: '<div class="x">hi</div>' },
  // css 实测（本轮 empirical + spec §2.1）：`color: red` / `color: $V` 均 0 命中（上游歧义）；
  // 已知正命中形态是声明整块捕获 `.a { $$$D }`。
  { lang: 'css', source: '.a { color: red; }\n', pattern: '.a { $$$D }', expectText: '.a { color: red; }' },
  { lang: 'json', source: '{"a": {"b": 1}}\n', pattern: '{"a": $V}', expectText: '{"a": {"b": 1}}' },
  { lang: 'yaml', source: 'a:\n  b: 1\nc: 2\n', pattern: 'b: $V', expectText: 'b: 1' },
  { lang: 'bash', source: 'echo "$HOME"\n', pattern: 'echo $A', expectText: 'echo "$HOME"' },
  { lang: 'ruby', source: "puts 'hi'\n", pattern: 'puts $A', expectText: "puts 'hi'" },
]

describe('ast engine language matrix (expandoChar drift tripwire)', () => {
  it('covers exactly the 14 shipped grammars', () => {
    expect(MATRIX).toHaveLength(14)
    expect(new Set(MATRIX.map(m => m.lang)).size).toBe(14)
  })

  for (const { lang, source, pattern, expectText } of MATRIX) {
    it(`${lang}: registers and matches ≥1 hit for a known-good pattern`, async () => {
      await ensureLanguages()
      expect(isLanguageAvailable(lang), `${lang} registered`).toBe(true)
      const { matches, unavailable } = await findInSource(source, lang, pattern, {})
      expect(unavailable, `${lang} not unavailable`).toBe(false)
      expect(matches.length, `${lang} must yield ≥1 match for ${pattern}`).toBeGreaterThanOrEqual(1)
      expect(matches[0]!.text).toBe(expectText)
    })
  }
})
