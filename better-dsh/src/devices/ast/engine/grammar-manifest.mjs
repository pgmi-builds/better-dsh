/**
 * AST 引擎的资产清单 —— 拷贝脚本（scripts/copy-ast-assets.mjs）与运行时注册表
 * （engine/grammars.ts）的单一真相源。三个包都无 install script、无传递依赖。
 * ABI 锁步：@lumis-sh/wasm-* 与 web-tree-sitter 必须同为主版本 0.26（dylink.0）。
 */
export const ENGINE_ASSETS = [
  { file: 'ast-grep.wasm', subpath: '@ast-grep/wasm/wasm_bg.wasm' },
  { file: 'tree-sitter.wasm', subpath: 'web-tree-sitter/web-tree-sitter.wasm' },
]

export const GRAMMAR_PACKAGES = {
  python: '@lumis-sh/wasm-python',
  javascript: '@lumis-sh/wasm-javascript',
  typescript: '@lumis-sh/wasm-typescript',
  tsx: '@lumis-sh/wasm-tsx',
  rust: '@lumis-sh/wasm-rust',
  go: '@lumis-sh/wasm-go',
  c: '@lumis-sh/wasm-c',
  cpp: '@lumis-sh/wasm-cpp',
  html: '@lumis-sh/wasm-html',
  css: '@lumis-sh/wasm-css',
  json: '@lumis-sh/wasm-json',
  yaml: '@lumis-sh/wasm-yaml',
  bash: '@lumis-sh/wasm-bash',
  ruby: '@lumis-sh/wasm-ruby',
}

/** lang → { file: 包内资产名, subpath: 可 require.resolve 的完整子路径 } */
export const GRAMMAR_ASSETS = Object.fromEntries(
  Object.entries(GRAMMAR_PACKAGES).map(([lang, pkg]) => [
    lang,
    { file: `tree-sitter-${lang}.wasm`, subpath: `${pkg}/tree-sitter-${lang}.wasm` },
  ]),
)
