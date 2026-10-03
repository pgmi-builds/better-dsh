/**
 * pattern 编译与命中映射。wasm 的 `findAll` 在多根节点 pattern 上会抛
 * "Multiple AST nodes are detected"；native 实测对这类 pattern 返回 0 命中
 * 且不写 parseErrors，因此这里捕获后归零（spec §3）。
 * 坐标换算：wasm 给 0-based 行列 + 字符偏移；native 契约是 1-based 行列 +
 * UTF-8 字节偏移。
 */
import type { AstFindMatch } from '../types.ts'
import { ensureLanguages, isLanguageAvailable } from './grammars.ts'
import { astEngine } from './wasm.ts'
import type { SgNode } from './wasm.ts'

const MULTI_NODE = 'Multiple AST nodes are detected'

/** 字符偏移 → UTF-8 字节偏移。 */
function byteOffsetOf(source: string, charIndex: number): number {
  return Buffer.byteLength(source.slice(0, charIndex), 'utf8')
}

function toMatch(source: string, node: SgNode, meta: Record<string, string> | undefined): AstFindMatch {
  const range = node.range()
  const byteStart = byteOffsetOf(source, range.start.index)
  return {
    path: '',
    text: node.text(),
    byteStart,
    byteEnd: byteStart + Buffer.byteLength(node.text(), 'utf8'),
    startLine: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.column + 1,
    ...(meta !== undefined && Object.keys(meta).length > 0 ? { metaVariables: meta } : {}),
  }
}

/** 单 metavar → 捕获文本；多 metavar → 复刻 native 的 Rust Debug 数组串。 */
function collectMeta(node: SgNode, pattern: string, includeMeta: boolean): Record<string, string> | undefined {
  if (!includeMeta) return undefined
  const meta: Record<string, string> = {}
  for (const raw of pattern.matchAll(/\$+\$?([A-Z_][A-Z0-9_]*)/g)) {
    const token = raw[0]
    const name = raw[1]!
    if (token === `$$$${name}`) {
      const parts = node.getMultipleMatches(name).map(n => n.text())
      if (parts.length > 0) meta[name] = `[${parts.join(', ')}]`
    } else if (!token.startsWith('$$')) {
      const bound = node.getMatch(name)
      if (bound !== undefined) meta[name] = bound.text()
    }
  }
  return meta
}

export async function findInSource(
  source: string,
  lang: string,
  pattern: string,
  options: { includeMeta?: boolean },
): Promise<{ matches: AstFindMatch[], unavailable: boolean }> {
  await ensureLanguages()
  if (!isLanguageAvailable(lang)) return { matches: [], unavailable: true }
  const engine = await astEngine()
  const root = engine.parse(lang, source).root()
  let hits: SgNode[]
  try {
    hits = root.findAll(pattern)
  } catch (error) {
    if (error instanceof Error && error.message.includes(MULTI_NODE)) return { matches: [], unavailable: false }
    throw error
  }
  return {
    matches: hits.map(node => toMatch(source, node, collectMeta(node, pattern, options.includeMeta === true))),
    unavailable: false,
  }
}
