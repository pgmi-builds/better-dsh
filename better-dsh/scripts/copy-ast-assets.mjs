/**
 * 把 AST 引擎的 wasm 资产从 node_modules 拷进 lib/ast-assets（发布面）。
 * 必须在 tsdown 之后运行 —— tsdown 会清空 lib/（同 lib/client/ 的老坑）。
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { ENGINE_ASSETS, GRAMMAR_ASSETS } from '../src/devices/ast/engine/grammar-manifest.mjs'

const require = createRequire(import.meta.url)
const OUT = join(process.cwd(), 'lib', 'ast-assets')
mkdirSync(OUT, { recursive: true })

let bytes = 0
for (const entry of [...ENGINE_ASSETS, ...Object.values(GRAMMAR_ASSETS)]) {
  const from = require.resolve(entry.subpath)
  const size = statSync(from).size
  copyFileSync(from, join(OUT, entry.file))
  bytes += size
  console.log(`  ast-asset ${entry.file.padEnd(30)} ${(size / 1024).toFixed(0)} KB`)
}
console.log(`ast-assets: ${Object.keys(GRAMMAR_ASSETS).length + ENGINE_ASSETS.length} files, ${(bytes / 1048576).toFixed(1)} MB`)
