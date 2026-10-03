/**
 * ast-grep WASM 引擎的装载层 —— 全插件唯一的 wasm 入口。
 *
 * 三个坑（spec §2.1，勿重新踩）：
 *  1. Node 不吃 ESM wasm import：`@ast-grep/wasm/wasm_bg.js` 不自举，由我们
 *     手动 `WebAssembly.instantiate` 后 `__wbg_set_wasm` 注入（import module
 *     名实测为 './wasm_bg.js'）。
 *  2. `initializeTreeSitter()` 内部才调 `Parser.init()`，没暴露 locateFile，
 *     所以先自行 `Parser.init({ locateFile })` 指向包内 tree-sitter.wasm
 *     （web-tree-sitter 单例缓存该 Promise，随后的内部 init 是 no-op）。
 *  3. 资产有两个解析形态：构建后的 `lib/ast-assets/`（发布面）优先；dev 下
 *     回落 node_modules 直解析。
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { Parser } from 'web-tree-sitter'
import { PACKAGE_ROOT } from '../../../kernel-env.ts'
import { ENGINE_ASSETS, GRAMMAR_ASSETS } from './grammar-manifest.mjs'

export interface SgPos { line: number, column: number, index: number }
export interface SgRange { start: SgPos, end: SgPos }
export interface SgNode {
  text(): string
  kind(): string
  range(): SgRange
  findAll(matcher: unknown): SgNode[]
  find(matcher: unknown): SgNode | undefined
  getMatch(name: string): SgNode | undefined
  getMultipleMatches(name: string): SgNode[]
  replace(text: string): unknown
  /** Apply { start_pos, end_pos, inserted_text } edits (character offsets) and return the rewritten source. */
  commitEdits(edits: unknown): string
}
export interface SgRoot { root(): SgNode }

export interface AstGrepEngine {
  parse(lang: string, source: string): SgRoot
  registerLanguages(entries: Record<string, { libraryPath: string, expandoChar: string }>): Promise<void>
}

const ASTGREP_WASM = ENGINE_ASSETS[0]!
const TREE_SITTER_WASM = ENGINE_ASSETS[1]!

/**
 * WebAssembly 运行时全局。本仓 tsconfig 无 DOM lib，@types/node 也未声明该全局值
 * （TS2708：仅存类型命名空间），故经 globalThis 取类型化句柄 —— 运行时是同一全局对象。
 */
const WebAssemblyGlobal = (globalThis as unknown as {
  WebAssembly: {
    instantiate(bytes: Buffer, imports: Record<string, unknown>): Promise<{ instance: { exports: unknown } }>
  }
}).WebAssembly

/**
 * 资产解析的唯一机制，逐文件生效：构建产物 `lib/ast-assets/` 在场 → 用它（发布面）；
 * 否则 dev 下按 manifest subpath 在 node_modules 直解析（不要求先跑过 build）。
 * 14 个语法分属 14 个 `@lumis-sh/wasm-*` 包、tree-sitter.wasm 在 web-tree-sitter ——
 * 不存在装下全部资产的单一 dev 目录，故不做目录级回落。
 */
export function assetPath(file: string): string {
  const bundled = join(PACKAGE_ROOT, 'lib', 'ast-assets')
  if (existsSync(bundled)) return join(bundled, file)
  return createRequire(import.meta.url).resolve(subpathOf(file))
}

async function readAsset(file: string): Promise<Buffer> {
  return readFile(assetPath(file))
}


function subpathOf(file: string): string {
  return ENGINE_ASSETS.find(a => a.file === file)?.subpath
    ?? Object.values(GRAMMAR_ASSETS).find(a => a.file === file)!.subpath
}

let enginePromise: Promise<AstGrepEngine> | undefined

/** Boot the engine once per process; every later call returns the same instance. */
export function astEngine(): Promise<AstGrepEngine> {
  enginePromise ??= boot()
  return enginePromise
}

async function boot(): Promise<AstGrepEngine> {
  // @ts-expect-error — wasm-bindgen 胶水模块无类型声明，形状由下面的 as 断言给出
  const bg = (await import('@ast-grep/wasm/wasm_bg.js')) as {
    __wbg_set_wasm(exports: unknown): void
    initializeTreeSitter(): Promise<void>
    registerDynamicLanguage(langs: Record<string, { libraryPath: string, expandoChar?: string }>): Promise<void>
    parse(lang: string, source: string): SgRoot
  }
  const bytes = await readAsset(ASTGREP_WASM.file)
  const { instance } = await WebAssemblyGlobal.instantiate(bytes, { './wasm_bg.js': bg })
  bg.__wbg_set_wasm(instance.exports)
  ;(instance.exports as { __wbindgen_start(): void }).__wbindgen_start()

  await Parser.init({ locateFile: () => assetPath(TREE_SITTER_WASM.file) })
  await bg.initializeTreeSitter()

  return {
    parse: (lang, source) => bg.parse(lang, source),
    registerLanguages: entries => bg.registerDynamicLanguage(entries),
  }
}
