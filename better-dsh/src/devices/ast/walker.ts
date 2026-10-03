/**
 * .gitignore 感知的源文件遍历 —— 对应 OMP 底盘里的 `ignore` crate。
 * 语义：跳过 node_modules / .git / 隐藏目录；逐层读取 .gitignore；
 * `glob` 作为相对 root 的过滤尾；`maxFiles` 达到即停（limitReached）。
 * 输出为绝对路径、字典序稳定，调用方（ast-device）负责再归属到 cwd。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import ignore from 'ignore'
import { languageForPath } from './engine/language-map.ts'

const ALWAYS_SKIP = new Set(['node_modules', '.git'])

export interface WalkOptions { glob?: string, maxFiles?: number }
export interface WalkResult { files: string[], limitReached: boolean }

function ignoresFor(root: string): ReturnType<typeof ignore> {
  const ig = ignore()
  let dir = root
  const chain: string[] = []
  for (; ;) {
    const gitignore = path.join(dir, '.gitignore')
    try {
      ig.add(readFileSync(gitignore, 'utf8'))
      chain.unshift(path.relative(root, dir) || '.')
    } catch { /* 无该层 .gitignore */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ig
}

function matchesGlob(root: string, abs: string, glob: string | undefined): boolean {
  if (glob === undefined) return true
  const rel = path.relative(root, abs).split(path.sep).join('/')
  const ig = ignore()
  // ignore 包的 glob 语义与 gitwildmatch 一致，恰好覆盖 ast-grep 的 glob 尾
  ig.add(glob.startsWith('!') ? glob : glob)
  return ig.ignores(rel)
}

export async function walkSources(root: string, options: WalkOptions): Promise<WalkResult> {
  const maxFiles = options.maxFiles ?? 1000
  const ig = ignoresFor(root)
  const out: string[] = []
  let limitReached = false

  const visit = (dir: string): void => {
    if (limitReached) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (limitReached) return
      if (entry.name.startsWith('.') || ALWAYS_SKIP.has(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      const relFromRoot = path.relative(root, abs)
      if (relFromRoot && ig.ignores(relFromRoot.split(path.sep).join('/'))) continue
      if (entry.isDirectory()) { visit(abs); continue }
      if (languageForPath(entry.name) === undefined) continue
      if (!matchesGlob(root, abs, options.glob)) continue
      if (out.length >= maxFiles) { limitReached = true; return }
      out.push(abs)
    }
  }
  try {
    if (statSync(root).isFile()) {
      out.push(root)
    } else {
      visit(root)
    }
  } catch { /* root 不存在：返回空 */ }
  return { files: out.sort(), limitReached }
}
