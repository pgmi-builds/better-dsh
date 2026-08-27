/**
 * Extension → LSP language id detection for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/utils/
 * lang-from-path.ts, MIT — see ../LICENSE-OMP.md), trimmed to the languages
 * the vendored defaults.json registry can launch (plus the basename specials
 * upstream handles: Dockerfile/Makefile/Justfile/CMakeLists/.emacs). Upstream
 * additionally maps theme-highlight ids; only the LSP id column is kept.
 */

import * as path from 'node:path'

/** Extension (without dot) → LSP language id (defaults.json coverage). */
const EXTENSION_LANGUAGE_ID: Record<string, string> = {
  rs: 'rust',
  tla: 'tlaplus',
  tlaplus: 'tlaplus',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp',
  zig: 'zig',
  go: 'go',
  mod: 'go.mod',
  sum: 'go.sum',
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  py: 'python',
  pyi: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sbt: 'scala',
  sc: 'scala',
  hs: 'haskell',
  lhs: 'haskell',
  ml: 'ocaml',
  mli: 'ocaml',
  mll: 'ocaml',
  mly: 'ocaml',
  ex: 'elixir',
  exs: 'elixir',
  heex: 'heex',
  eex: 'eex',
  erl: 'erlang',
  hrl: 'erlang',
  gleam: 'gleam',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  erb: 'erb',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  lua: 'lua',
  php: 'php',
  phtml: 'php',
  cs: 'csharp',
  csx: 'csharp',
  yaml: 'yaml',
  yml: 'yaml',
  tf: 'terraform',
  tfvars: 'terraform',
  dockerfile: 'dockerfile',
  tpl: 'helm',
  nix: 'nix',
  odin: 'odin',
  dart: 'dart',
  md: 'markdown',
  markdown: 'markdown',
  tex: 'latex',
  bib: 'bibtex',
  sty: 'latex',
  cls: 'latex',
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  vim: 'vim',
  vimrc: 'vim',
  html: 'html',
  htm: 'html',
  swift: 'swift',
}

/** LSP language identifier; falls back to `plaintext` (upstream behavior). */
export function detectLanguageId(filePath: string): string {
  const baseName = path.basename(filePath).toLowerCase()
  if (baseName === 'dockerfile' || baseName.startsWith('dockerfile.') || baseName === 'containerfile') {
    return 'dockerfile'
  }
  if (baseName === '.emacs') return 'emacs-lisp'
  if (baseName === 'makefile' || baseName === 'gnumakefile') return 'makefile'
  if (baseName === 'justfile') return 'just'
  if (baseName === 'cmakelists.txt') return 'cmake'

  const ext = path.extname(baseName).slice(1)
  return EXTENSION_LANGUAGE_ID[ext] ?? 'plaintext'
}
