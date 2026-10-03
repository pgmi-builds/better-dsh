/**
 * 语法注册表。每个语言注册都必须带 expandoChar 'µ'：默认 '$' 只在
 * JS/TS/bash/cpp 下碰巧可用，python/rust/go 会静默 0 命中（spec §2.1）。
 * 注册后对每个语言跑一次空源 parse 自检，把坏语法降级为"该语言不可用"
 * 而不是让整个设备失败（fail-open，spec §1.5）。
 */
import { GRAMMAR_ASSETS } from './grammar-manifest.mjs'
import { AST_LANGUAGES } from './language-map.ts'
import { astEngine, assetPath } from './wasm.ts'

/** ast-grep 的元变量引导字符；所有语言统一用 µ（实测全语言可用）。 */
export const EXPANDO_CHAR = 'µ'

const broken = new Set<string>()
let registered: Promise<void> | undefined

export function ensureLanguages(): Promise<void> {
  registered ??= (async () => {
    const engine = await astEngine()
    const entries: Record<string, { libraryPath: string, expandoChar: string }> = {}
    for (const lang of AST_LANGUAGES) {
      entries[lang] = { libraryPath: assetPath(GRAMMAR_ASSETS[lang]!.file), expandoChar: EXPANDO_CHAR }
    }
    await engine.registerLanguages(entries)
    for (const lang of AST_LANGUAGES) {
      try {
        engine.parse(lang, '')
      } catch {
        broken.add(lang)
      }
    }
  })()
  return registered
}

/** 该语法是否注册成功（失败的语言由 walker 跳过并计入 parseErrors）。 */
export function isLanguageAvailable(lang: string): boolean {
  return !broken.has(lang)
}
