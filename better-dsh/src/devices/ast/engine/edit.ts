/**
 * 结构改写核心。native 在替换模板里做元变量替换（实测 `bar($A)`→`bar(42)`、
 * `bar($_)`→`bar()`、`$$$A` 按源文本逗号拼接），wasm 的 `node.replace` 只收
 * 字面文本，所以替换串由我们展开后再喂给 `commitEdits`。跨 pattern 的重叠
 * 命中在 commit 前被丢弃（计入返回值 `overlapping`，见下方守卫）。
 */
import type { AstReplaceChange } from '../types.ts'
import { ensureLanguages, isLanguageAvailable } from './grammars.ts'
import { astEngine } from './wasm.ts'

const META_TOKEN = /\$\$\$([A-Z_][A-Z0-9_]*)|\$([A-Z_][A-Z0-9_]*)/g

const MULTI_NODE = 'Multiple AST nodes are detected'

/**
 * 把模板里的元变量替换成该次命中的捕获文本（`$_`-匿名 → 空串）。
 * `$$$A` 取整个多捕获区间的**源文本**（首捕获节点起点 → 末捕获节点终点，
 * 空捕获 → 空串）——这才是 native 的实测行为（`greet( 1,2 , 3 )` → `log(1,2 , 3)`、
 * `greet()` → `log()`，A/B 复核 2026-10-03）；对逐节点文本做 naive join 会得到
 * `1, ,, 2, ,, 3`，与 native 的 `1, 2, 3` 不符。
 */
function expand(template: string, source: string, node: import('./wasm.ts').SgNode): string {
  return template.replace(META_TOKEN, (whole, multi?: string, single?: string) => {
    if (multi !== undefined) {
      const parts = node.getMultipleMatches(multi)
      if (parts.length === 0) return ''
      const start = parts[0]!.range().start.index
      const end = parts[parts.length - 1]!.range().end.index
      return source.slice(start, end)
    }
    if (single === undefined) return whole
    if (single.startsWith('_')) return ''
    return node.getMatch(single)?.text() ?? ''
  })
}

export async function editSource(
  source: string,
  lang: string,
  rewrites: Record<string, string>,
): Promise<{ changes: AstReplaceChange[], rewritten: string, totalReplacements: number, parseErrorCount: number, overlapping: number }> {
  await ensureLanguages()
  if (!isLanguageAvailable(lang) || Object.keys(rewrites).length === 0) {
    return { changes: [], rewritten: source, totalReplacements: 0, parseErrorCount: 0, overlapping: 0 }
  }
  const engine = await astEngine()
  const root = engine.parse(lang, source).root()

  const edits: Array<{ edit: { start_pos: number, end_pos: number, inserted_text: string }, change: AstReplaceChange }> = []
  for (const [pattern, template] of Object.entries(rewrites)) {
    let hits: import('./wasm.ts').SgNode[]
    try {
      hits = root.findAll(pattern)
    } catch (error) {
      if (error instanceof Error && error.message.includes(MULTI_NODE)) continue
      throw error
    }
    for (const node of hits) {
      const range = node.range()
      const replacement = expand(template, source, node)
      const byteStart = Buffer.byteLength(source.slice(0, range.start.index), 'utf8')
      edits.push({
        edit: { start_pos: range.start.index, end_pos: range.end.index, inserted_text: replacement },
        change: {
          path: '',
          before: node.text(),
          after: replacement,
          byteStart,
          byteEnd: byteStart + Buffer.byteLength(node.text(), 'utf8'),
          deletedLength: Buffer.byteLength(node.text(), 'utf8'),
          startLine: range.start.line + 1,
          startColumn: range.start.column + 1,
          endLine: range.end.line + 1,
          endColumn: range.end.column + 1,
        },
      })
    }
  }

  // 重叠守卫（spec 复核条件 c）：命中是按 pattern 逐个在同一棵树上收集的，两个
  // 不同 pattern 可以命中重叠区间；commitEdits 对重叠区间是未定义行为（实测被
  // 遮蔽的编辑会静默消失，而 changes[] 仍报告它）。按 start 升序排（稳定排序，
  // 同起点时先入列的 pattern 胜）后线性扫描：与已接受区间重叠的编辑丢弃并计入
  // `overlapping`，不进 changes/totalReplacements。
  edits.sort((a, b) => a.edit.start_pos - b.edit.start_pos)
  const accepted: typeof edits = []
  let overlapping = 0
  let lastEnd = -1
  for (const candidate of edits) {
    if (candidate.edit.start_pos < lastEnd) {
      overlapping += 1
      continue
    }
    accepted.push(candidate)
    lastEnd = Math.max(lastEnd, candidate.edit.end_pos)
  }

  // commitEdits 只服务于「真写盘」那份新源码；changes[] 全部来自扫描期的源文本，
  // 不从重放结果反推（多字节字符与相邻替换会互相推走偏移）。
  accepted.sort((a, b) => b.edit.start_pos - a.edit.start_pos)
  const rewritten = root.commitEdits(accepted.map(e => e.edit))
  return { changes: accepted.map(e => e.change), rewritten, totalReplacements: accepted.length, parseErrorCount: 0, overlapping }
}
