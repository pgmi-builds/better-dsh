# AST 去 OMP 化：内置 WASM 引擎 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `dvc://ast_grep` / `dvc://ast_edit` 不再依赖 `@oh-my-pi/pi-natives`，改用随包发布的官方 ast-grep WASM 引擎 + 我们 TS 实现的遍历/聚合底盘，70.8 MB 下载 / 328 MB 落盘 → 14.4 MB 随包、永久离线。

**Architecture:** 引擎层（`src/devices/ast/engine/`）封装 wasm-bindgen 手动装配、语法注册、pattern 编译与命中映射；底盘层（`walker.ts`）负责 `.gitignore` 感知遍历 / glob / 限额；`ast-device.ts` 保持模型面契约不变，只换后端；`natives-loader.ts` 删除。

**Tech Stack:** `@ast-grep/wasm@0.45.3`（官方 ast-grep WASM）· `web-tree-sitter@0.26.x` · `@lumis-sh/wasm-*@0.26.x`（14 语法）· `ignore@7`（纯 JS，`.gitignore` 语义）— 全部 devDependencies，构建期内联/拷入 `lib/`。

**Spec:** `docs/specs/ast-engine-deomp/spec.md`（计划与规格同读；规格含 A/B 证据与三个已解的坑）

## Global Constraints

- `package.json` 的 `dependencies` / `optionalDependencies` / `scripts.postinstall` **必须始终不存在**（零运行时依赖契约）。
- 源码 / 产物 / tarball 中**不得出现** `@oh-my-pi` 或 `pi_natives`（验收 `grep` = 0）。
- 所有语法注册 `expandoChar: 'µ'` —— 漏给会**静默 0 命中**（python/rust/go 实测）。
- `web-tree-sitter` 与 `@lumis-sh/wasm-*` **主版本锁步 pin 在 0.26**：语法 wasm 必须是 `dylink.0`，legacy `dylink`（如 `tree-sitter-wasms@0.1.13`）与 0.26 硬不兼容。
- 资产必须在 **tsdown 之后**拷贝（tsdown 清空 `lib/`）。
- 模型面契约不动：`ops`/`paths`/`dryRun`、`patterns`/`path`/`offset`/`limit`/`includeMeta`，以及全部结果字段。
- 行列 **1-based**、偏移 **UTF-8 字节**（native 口径；换算见 Task 5）。
- 多根节点 pattern → **记 0 命中**，不抛错、不写 `parseErrors`（native 实测行为，见 spec §3）。
- 每个 Task 结束 `tsc --noEmit` 0 错 + 相关单测绿 + commit。

---

### Task 1: 资产清单 + 拷贝脚本 + 构建链

**Files:**
- Create: `src/devices/ast/engine/grammar-manifest.mjs`
- Create: `src/devices/ast/engine/grammar-manifest.d.ts`
- Create: `scripts/copy-ast-assets.mjs`
- Modify: `package.json`（build 链 + devDependencies）
- Modify: `tsdown.config.ts`（`BUNDLED_RUNTIME` 增两项）
- Test: `test/surface-devices/ast-engine-assets.spec.ts`

**Interfaces:**
- Produces: `ENGINE_ASSETS` / `GRAMMAR_PACKAGES` / `GRAMMAR_ASSETS`（后续所有任务从这里拿资产名）；`npm run build` 产出 `lib/ast-assets/**`（16 个 wasm）。

- [ ] **Step 1: 安装 devDependencies**

```bash
cd better-dsh
npm i -D @ast-grep/wasm@0.45.3 web-tree-sitter@0.26.12 ignore@^7.0.12 \
  @lumis-sh/wasm-python@0.26.5 @lumis-sh/wasm-javascript@0.26.4 @lumis-sh/wasm-typescript@0.26.3 \
  @lumis-sh/wasm-tsx@0.26.3 @lumis-sh/wasm-rust@0.26.5 @lumis-sh/wasm-go@0.26.3 @lumis-sh/wasm-c@0.26.3 \
  @lumis-sh/wasm-cpp@0.26.2 @lumis-sh/wasm-html@0.26.4 @lumis-sh/wasm-css@0.26.4 @lumis-sh/wasm-json@0.26.5 \
  @lumis-sh/wasm-yaml@0.26.3 @lumis-sh/wasm-bash@0.26.6 @lumis-sh/wasm-ruby@0.26.4
```

验证：`node -e "const p=require('./package.json'); if(p.dependencies||p.optionalDependencies||p.scripts.postinstall) throw new Error('runtime dep leaked')"` 退出码 0。这三个包实测均**无 install script**（`@ast-grep/wasm` scripts 为 `{}`，`web-tree-sitter` 只有 build/lint/test）。

- [ ] **Step 2: 写清单（plain ESM + 手写 d.ts，仿 `src/hashline/constants.js` 既有模式）**

`src/devices/ast/engine/grammar-manifest.mjs`：

```js
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
```

`src/devices/ast/engine/grammar-manifest.d.ts`：

```ts
export interface AssetEntry { file: string, subpath: string }
export declare const ENGINE_ASSETS: readonly AssetEntry[]
export declare const GRAMMAR_PACKAGES: Readonly<Record<string, string>>
export declare const GRAMMAR_ASSETS: Readonly<Record<string, AssetEntry>>
```

- [ ] **Step 3: 写拷贝脚本**

`scripts/copy-ast-assets.mjs`：

```js
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
```

- [ ] **Step 4: 接线构建链与 noExternal**

`package.json`：

```json
"build": "tsdown && npm run build-client && node scripts/copy-kernel-bridge.mjs && node scripts/copy-ast-assets.mjs"
```

`tsdown.config.ts` 的 `BUNDLED_RUNTIME` 数组**末尾追加**两项（前缀匹配已覆盖 `/wasm_bg.js` 子路径）：

```ts
  'web-tree-sitter',
  '@ast-grep/wasm',
```

注意 `ignore` 不进 `BUNDLED_RUNTIME`（Task 7 再加，避免本任务出现未使用项）。

- [ ] **Step 5: 写失败测试**

`test/surface-devices/ast-engine-assets.spec.ts`：

```ts
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { ENGINE_ASSETS, GRAMMAR_ASSETS, GRAMMAR_PACKAGES } from '../../src/devices/ast/engine/grammar-manifest.mjs'

const require = createRequire(import.meta.url)

describe('ast engine asset manifest', () => {
  it('covers exactly the 14 languages of the device surface', () => {
    expect(Object.keys(GRAMMAR_PACKAGES).sort()).toEqual([
      'bash', 'c', 'cpp', 'css', 'go', 'html', 'javascript', 'json',
      'python', 'ruby', 'rust', 'tsx', 'typescript', 'yaml',
    ])
  })
  it('pins every grammar to a @lumis-sh 0.26 package (dylink.0 ABI lockstep)', () => {
    for (const pkg of Object.values(GRAMMAR_PACKAGES)) {
      expect(pkg).toMatch(/^@lumis-sh\/wasm-[a-z]+$/)
    }
  })
  it('resolves every asset from node_modules (dev form) — engine wasm + runtime + 14 grammars', () => {
    for (const entry of [...ENGINE_ASSETS, ...Object.values(GRAMMAR_ASSETS)]) {
      expect(existsSync(require.resolve(entry.subpath)), entry.subpath).toBe(true)
    }
  })
})
```

- [ ] **Step 6: 跑测试确认通过（清单是纯数据，无失败路径可先写；若 Step 1 未装包则此步 FAIL）**

Run: `npx vitest run test/surface-devices/ast-engine-assets.spec.ts`
Expected: PASS

- [ ] **Step 7: 跑构建，确认 16 个资产落位**

Run: `npm run build 2>&1 | tail -5 && ls lib/ast-assets | wc -l`
Expected: `ast-assets: 16 files, ≈14.4 MB`，`ls | wc -l` = 16

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsdown.config.ts scripts/copy-ast-assets.mjs \
  src/devices/ast/engine/grammar-manifest.mjs src/devices/ast/engine/grammar-manifest.d.ts \
  test/surface-devices/ast-engine-assets.spec.ts
git commit -m "feat(ast): stage WASM engine assets — manifest, copy script, build chain"
```

---

### Task 2: `engine/wasm.ts` — 手动装配 + 惰性单例

**Files:**
- Create: `src/devices/ast/engine/wasm.ts`
- Test: `test/surface-devices/ast-engine-wasm.spec.ts`

**Interfaces:**
- Produces: `astEngine(): Promise<AstGrepEngine>`，`AstGrepEngine = { parse(lang, src): Promise<SgRoot> }`；结构类型 `SgRoot` / `SgNode` / `SgRange` / `SgPos`；`assetPath(file: string): string`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { astEngine } from '../../src/devices/ast/engine/wasm.ts'

describe('ast WASM engine boot', () => {
  it('boots, parses, and memoizes the singleton', async () => {
    const a = await astEngine()
    const root = await a.parse('python', 'def f(n):\n    return n\n')
    expect(root.root().findAll('return $X')).toHaveLength(1)
    const b = await astEngine()
    expect(b).toBe(a)
  })
})
```

Run: `npx vitest run test/surface-devices/ast-engine-wasm.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现**

`src/devices/ast/engine/wasm.ts`：

```ts
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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'web-tree-sitter'
import { PACKAGE_ROOT } from '../../kernel-env.ts'
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
}
export interface SgRoot { root(): SgNode }

export interface AstGrepEngine {
  parse(lang: string, source: string): SgRoot
  registerLanguages(entries: Record<string, { libraryPath: string, expandoChar: string }>): Promise<void>
}

const ASTGREP_WASM = ENGINE_ASSETS[0]!
const TREE_SITTER_WASM = ENGINE_ASSETS[1]!

function assetsDir(): string {
  const bundled = join(PACKAGE_ROOT, 'lib', 'ast-assets')
  if (existsSync(bundled)) return bundled
  const require = createRequire(import.meta.url)
  return dirname(require.resolve(GRAMMAR_ASSETS.python!.subpath))
}

export function assetPath(file: string): string {
  return join(assetsDir(), file)
}

async function readAsset(file: string): Promise<Buffer> {
  const p = assetPath(file)
  if (existsSync(p)) return readFile(p)
  // dev：node_modules 直解析（不要求先跑过 build）
  const require = createRequire(import.meta.url)
  return readFile(require.resolve(subpathOf(file)))
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
  const bg = (await import('@ast-grep/wasm/wasm_bg.js')) as {
    __wbg_set_wasm(exports: unknown): void
    initializeTreeSitter(): Promise<void>
    registerDynamicLanguage(langs: Record<string, { libraryPath: string, expandoChar?: string }>): Promise<void>
    parse(lang: string, source: string): SgRoot
  }
  const bytes = await readAsset(ASTGREP_WASM.file)
  const { instance } = await WebAssembly.instantiate(bytes, { './wasm_bg.js': bg })
  bg.__wbg_set_wasm(instance.exports)
  ;(instance.exports as { __wbindgen_start(): void }).__wbindgen_start()

  await Parser.init({ locateFile: () => assetPath(TREE_SITTER_WASM.file) })
  await bg.initializeTreeSitter()

  return {
    parse: (lang, source) => bg.parse(lang, source),
    registerLanguages: entries => bg.registerDynamicLanguage(entries),
  }
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/surface-devices/ast-engine-wasm.spec.ts`
Expected: PASS（首次冷启含 121 ms 的 wasm 实例化 + `Parser.init`）

- [ ] **Step 4: 确认打包形态仍可用（防 Task 1 的 noExternal 回归）**

```bash
npm run build 2>&1 | tail -3
grep -rl "wasm_bg\|web-tree-sitter" lib/*.js | head -3
```
Expected: 至少一个 chunk 含内联后的引擎代码（不是 `require('@ast-grep/wasm')`）。

- [ ] **Step 5: Commit**

```bash
git add src/devices/ast/engine/wasm.ts test/surface-devices/ast-engine-wasm.spec.ts
git commit -m "feat(ast): engine/wasm — manual wasm-bindgen boot, lazy singleton"
```

---

### Task 3: `language-map.ts` + `grammars.ts` — 语言面单一真相源

**Files:**
- Create: `src/devices/ast/engine/language-map.ts`
- Create: `src/devices/ast/engine/grammars.ts`
- Test: `test/surface-devices/ast-engine-grammars.spec.ts`

**Interfaces:**
- Produces: `EXTENSION_TO_LANGUAGE`、`languageForPath(path): string | undefined`、`AST_LANGUAGES: readonly string[]`；`ensureLanguages(): Promise<void>`、`isLanguageAvailable(lang): boolean`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { AST_LANGUAGES, EXTENSION_TO_LANGUAGE, languageForPath } from '../../src/devices/ast/engine/language-map.ts'
import { ensureLanguages, isLanguageAvailable } from '../../src/devices/ast/engine/grammars.ts'

describe('language map (single source of truth)', () => {
  it('maps the probed extension set onto 14 grammars', () => {
    expect(languageForPath('a/b/c.ts')).toBe('typescript')
    expect(languageForPath('a/b/c.mts')).toBe('typescript')
    expect(languageForPath('x/y.PY')).toBe('python')            // 大小写不敏感
    expect(languageForPath('x/y.md')).toBeUndefined()
  })
  it('every mapped language is registered and available', async () => {
    await ensureLanguages()
    expect(AST_LANGUAGES).toHaveLength(14)
    for (const lang of AST_LANGUAGES) expect(isLanguageAvailable(lang), lang).toBe(true)
  })
})
```

Run: `npx vitest run test/surface-devices/ast-engine-grammars.spec.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

`src/devices/ast/engine/language-map.ts`：

```ts
/**
 * 扩展名 → 内置 tree-sitter 语法。AST 语言面的单一真相源：
 * walker 的语言推断与 ast-reminder 的提醒集合都从这里派生，
 * 不再各自维护（也不再"对 shipped 二进制实测"）。
 */
export const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.py': 'python', '.pyi': 'python',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.tsx': 'tsx',
  '.rs': 'rust',
  '.go': 'go',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp',
  '.html': 'html',
  '.css': 'css',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.sh': 'bash',
  '.rb': 'ruby',
}

/** 该设备支持的全部语法（去重、稳定序）。 */
export const AST_LANGUAGES: readonly string[] = [...new Set(Object.values(EXTENSION_TO_LANGUAGE))]

/** 小写扩展名 → 语法；未知扩展名返回 undefined。 */
export function languageForPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.')
  if (dot <= filePath.lastIndexOf('/')) return undefined
  return EXTENSION_TO_LANGUAGE[filePath.slice(dot).toLowerCase()]
}
```

`src/devices/ast/engine/grammars.ts`：

```ts
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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/surface-devices/ast-engine-grammars.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/devices/ast/engine/language-map.ts src/devices/ast/engine/grammars.ts test/surface-devices/ast-engine-grammars.spec.ts
git commit -m "feat(ast): language map + grammar registry with expandoChar µ"
```

---

### Task 4: `types.ts` — 设备契约类型从 natives-loader 迁出

**Files:**
- Create: `src/devices/ast/types.ts`
- Modify: `src/devices/ast/ast-device.ts`（仅 import 改向；**实现本任务不改逻辑**）

**Interfaces:**
- Produces: `AstFindMatch` / `AstFindResult` / `AstReplaceChange` / `AstReplaceFileChange` / `AstReplaceOptions` / `AstReplaceResult`（与原 `natives-loader.ts` 逐字段一致）。

- [ ] **Step 1: 迁移类型**

把 `src/devices/ast/natives-loader.ts` 里 `// Native API surface` 到 `export interface PiNatives { ... }` 之间的**全部类型定义原样剪切**到 `src/devices/ast/types.ts`，文件头改为：

```ts
/**
 * `dvc://ast_edit` / `dvc://ast_grep` 的结果与选项形状 —— 模型面契约。
 * 字段与语义一字不改（spec §1.1）；唯一变化是后端从 pi-natives 换成内置
 * WASM 引擎。坐标口径：行列 1-based、偏移 UTF-8 字节（native 口径）。
 *
 * @module dashr/devices/ast/types
 */
```

`ast-device.ts` 的 import 从 `'./natives-loader.ts'` 改为 `'./types.ts'`（类型 import 与 `PiNatives` 一并去掉，`PiNatives` 类型不迁移——它描述的是被删除的后端）。

- [ ] **Step 2: 验证不回归**

Run: `npx tsc --noEmit && npx vitest run test/surface-devices/`
Expected: tsc 0 错；现有 ast spec 仍 PASS（后端还没换）

- [ ] **Step 3: Commit**

```bash
git add src/devices/ast/types.ts src/devices/ast/ast-device.ts
git commit -m "refactor(ast): move device contract types out of natives-loader"
```

---

### Task 5: `engine/match.ts` — pattern 编译 + 命中映射（字节偏移）

**Files:**
- Create: `src/devices/ast/engine/match.ts`
- Test: `test/surface-devices/ast-engine-match.spec.ts`

**Interfaces:**
- Consumes: `astEngine()` / `ensureLanguages()` / `isLanguageAvailable()`（Task 2/3）
- Produces: `findInSource(source: string, lang: string, pattern: string, options: { includeMeta?: boolean }): Promise<{ matches: AstFindMatch[], unavailable: boolean }>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { findInSource } from '../../src/devices/ast/engine/match.ts'

describe('engine/match', () => {
  it('reports 1-based lines/columns and UTF-8 byte offsets', async () => {
    const source = 'const 世界 = "汉字"\nconst b = foo(世界)\n'
    const { matches } = await findInSource(source, 'typescript', 'foo($A)', {})
    expect(matches).toHaveLength(1)
    expect(matches[0]!.text).toBe('foo(世界)')
    expect(matches[0]!.byteStart).toBe(34)          // native 实测同值
    expect(matches[0]!.startLine).toBe(2)           // 1-based
    expect(matches[0]!.startColumn).toBe(11)
  })

  it('collects meta variables; multi-metavar reproduces the native Debug string', async () => {
    const source = 'greet(1, 2, 3)\n'
    const { matches } = await findInSource(source, 'typescript', 'greet($$$A)', { includeMeta: true })
    expect(matches[0]!.metaVariables).toEqual({ A: '[1, ,, 2, ,, 3]' })
  })

  it('turns a multi-root pattern into zero matches, not a throw (native parity)', async () => {
    const { matches } = await findInSource('function f(a) { return a }\n', 'typescript', 'function $N($$$A) { $$$B }', {})
    expect(matches).toEqual([])
  })
  it('reproduces the native zero-hit quirks for C and CSS (upstream ambiguity)', async () => {
    // golden 值取自 shipped pi-natives 的 A/B 实测（spec §2.1）：native 对同样
    // 输入同样返回 0 命中 —— ast-grep 上游语义，不是 WASM 退化。
    const c = await findInSource('int main(void){ return foo(1); }\n', 'c', 'foo($A)', {})
    expect(c.matches).toEqual([])
    const css = await findInSource('.a { color: red; margin: 0 }\n', 'css', 'color: $V', {})
    expect(css.matches).toEqual([])
  })
})
```

> **A/B 常驻化的方式**（spec §5.1）：native 已从依赖面删除，测试不能在运行期 dlopen 它，
> 所以把 A/B 实测结果**固化为 golden 断言值**。上面各用例的期望值都来自对真实
> `pi_natives.linux-x64-modern.node` 的实测输出（spike 的 `ab-native.mjs` / `cjk.mjs` /
> `subst.mjs` / `multi.mjs`）：`byteStart: 34`、`startColumn: 11`、`bar(42)`、`log(1, 2, 3)`、
> `[1, ,, 2, ,, 3]`、C/CSS 的 0 命中。回归时这些断言就是那场 A/B。
```

Run: `npx vitest run test/surface-devices/ast-engine-match.spec.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

`src/devices/ast/engine/match.ts`：

```ts
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
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/surface-devices/ast-engine-match.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/devices/ast/engine/match.ts test/surface-devices/ast-engine-match.spec.ts
git commit -m "feat(ast): engine/match — pattern search with native coordinate parity"
```

---

### Task 6: `engine/edit.ts` — 结构改写（含元变量替换）

**Files:**
- Create: `src/devices/ast/engine/edit.ts`
- Test: `test/surface-devices/ast-engine-edit.spec.ts`

**Interfaces:**
- Consumes: `astEngine()` / `ensureLanguages()`（Task 2/3）
- Produces: `editSource(source: string, lang: string, rewrites: Record<string, string>): Promise<{ changes: AstReplaceChange[], rewritten: string, totalReplacements: number, parseErrorCount: number }>`（`rewritten` = 重放后的整份源码，Task 8 在 `dryRun:false` 时一次性写盘）

- [ ] **Step 1: 写失败测试**

```ts
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

  it('records a multi-root pattern as zero replacements, no throw', async () => {
    const r = await editSource('function f(a) { return a }\n', 'typescript', { 'function $N($$$A) { $$$B }': 'x' })
    expect(r.totalReplacements).toBe(0)
  })
})
```

Run: `npx vitest run test/surface-devices/ast-engine-edit.spec.ts`
Expected: FAIL

- [ ] **Step 2: 实现**

`src/devices/ast/engine/edit.ts`：

```ts
/**
 * 结构改写核心。native 在替换模板里做元变量替换（实测 `bar($A)`→`bar(42)`、
 * `bar($_)`→`bar()`、`$$$A` 按源文本逗号拼接），wasm 的 `node.replace` 只收
 * 字面文本，所以替换串由我们展开后再喂给 `commitEdits`。
 */
import type { AstReplaceChange } from '../types.ts'
import { ensureLanguages, isLanguageAvailable } from './grammars.ts'
import { astEngine } from './wasm.ts'

const META_TOKEN = /\$\$\$([A-Z_][A-Z0-9_]*)|\$([A-Z_][A-Z0-9_]*)/g

const MULTI_NODE = 'Multiple AST nodes are detected'

/** 把模板里的元变量替换成该次命中的捕获文本（`$_`-匿名 → 空串）。 */
function expand(template: string, node: import('./wasm.ts').SgNode): string {
  return template.replace(META_TOKEN, (whole, multi?: string, single?: string) => {
    if (multi !== undefined) return node.getMultipleMatches(multi).map(n => n.text()).join(', ')
    if (single === undefined) return whole
    if (single.startsWith('_')) return ''
    return node.getMatch(single)?.text() ?? ''
  })
}

export async function editSource(
  source: string,
  lang: string,
  rewrites: Record<string, string>,
): Promise<{ changes: AstReplaceChange[], totalReplacements: number, parseErrorCount: number }> {
  await ensureLanguages()
  if (!isLanguageAvailable(lang) || Object.keys(rewrites).length === 0) {
    return { changes: [], totalReplacements: 0, parseErrorCount: 0 }
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
      const replacement = expand(template, node)
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

  // commitEdits 只服务于「真写盘」那份新源码；changes[] 全部来自扫描期的源文本，
  // 不从重放结果反推（多字节字符与相邻替换会互相推走偏移）。
  edits.sort((a, b) => b.edit.start_pos - a.edit.start_pos)
  const rewritten = root.commitEdits(edits.map(e => e.edit))
  return { changes: edits.map(e => e.change), rewritten, totalReplacements: edits.length, parseErrorCount: 0 }
}
```

`changes[]` 的 `before` / `byte*` / `start*` 在收集阶段就已定格为**源文本**坐标，`after` 即展开后的替换串；`rewritten` 是整份重放源码，供 `ast-device.ts` 在 `dryRun:false` 时一次性写盘（单一写、单一审计，与现有 write 契约一致）。

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/surface-devices/ast-engine-edit.spec.ts`
Expected: PASS（四条用例全绿）

- [ ] **Step 4: 更新接口说明**

`editSource` 返回 `{ changes, rewritten, totalReplacements, parseErrorCount }` —— `rewritten: string` 是重放后的整份源码，Task 8 在 `dryRun:false` 时写它。

- [ ] **Step 5: Commit**

- [ ] **Step 5: Commit**

```bash
git add src/devices/ast/engine/edit.ts test/surface-devices/ast-engine-edit.spec.ts
git commit -m "feat(ast): engine/edit — structural rewrite with meta-variable substitution"
```

---

### Task 7: `walker.ts` — .gitignore 感知遍历 + glob + 限额

**Files:**
- Create: `src/devices/ast/walker.ts`
- Modify: `tsdown.config.ts`（`BUNDLED_RUNTIME` 增 `'ignore'`）
- Modify: `package.json`（`devDependencies` 增 `ignore@^7.0.12`，Task 1 已装）
- Test: `test/surface-devices/ast-walker.spec.ts`

**Interfaces:**
- Consumes: `languageForPath()`（Task 3）
- Produces: `walkSources(root: string, options: { glob?: string, maxFiles?: number }): Promise<{ files: string[], limitReached: boolean }>`（返回 cwd 无关的**绝对**路径，按字典序稳定排序）

- [ ] **Step 1: 安装并在 tsdown 内联 `ignore`**

```bash
npm i -D ignore@^7.0.12
```

`tsdown.config.ts` 的 `BUNDLED_RUNTIME` **插入** `'ignore'`（放 `'@ast-grep/wasm'` 之前）。

- [ ] **Step 2: 写失败测试**

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { walkSources } from '../../src/devices/ast/walker.ts'

let dir: string
beforeEach(() => { dir = mkdirSyncSync() })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
function mkdirSyncSync(): string {
  const d = path.join(os.tmpdir(), `ast-walk-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(d, { recursive: true })
  return d
}
const write = (rel: string, body = 'const a = 1\n') => {
  const p = path.join(dir, rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, body)
}

describe('ast walker', () => {
  it('skips node_modules, dotdirs, and non-AST extensions', async () => {
    write('src/a.ts'); write('src/b.md'); write('node_modules/x/c.ts'); write('.hidden/d.ts')
    const { files } = await walkSources(dir, {})
    expect(files.map(f => path.relative(dir, f))).toEqual(['src/a.ts'])
  })
  it('honours .gitignore', async () => {
    write('src/a.ts'); write('src/gen/keep.ts'); write('.gitignore', 'src/gen/\n')
    const { files } = await walkSources(dir, {})
    expect(files.map(f => path.relative(dir, f))).toEqual(['src/a.ts'])
  })
  it('applies a glob tail against the root and reports limitReached', async () => {
    write('src/a.ts'); write('src/b.ts'); write('src/c.rb')
    const globbed = await walkSources(dir, { glob: '**/*.ts' })
    expect(globbed.files).toHaveLength(2)
    const capped = await walkSources(dir, { maxFiles: 1 })
    expect(capped.files).toHaveLength(1)
    expect(capped.limitReached).toBe(true)
  })
})
```

Run: `npx vitest run test/surface-devices/ast-walker.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/devices/ast/walker.ts`：

```ts
/**
 * .gitignore 感知的源文件遍历 —— 对应 OMP 底盘里的 `ignore` crate。
 * 语义：跳过 node_modules / .git / 隐藏目录；逐层读取 .gitignore；
 * `glob` 作为相对 root 的过滤尾；`maxFiles` 达到即停（limitReached）。
 * 输出为绝对路径、字典序稳定，调用方（ast-device）负责再归属到 cwd。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'
import { ignore } from 'ignore'
import { languageForPath } from './engine/language-map.ts'

const ALWAYS_SKIP = new Set(['node_modules', '.git'])

export interface WalkOptions { glob?: string, maxFiles?: number }
export interface WalkResult { files: string[], limitReached: boolean }

function ignoresFor(root: string): ReturnType<typeof ignore> {
  const ig = ignore()
  let dir = root
  const chain: string[] = []
  for (;;) {
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
      if (entry.name.startsWith('.') && ALWAYS_SKIP.has(entry.name)) continue
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/surface-devices/ast-walker.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/devices/ast/walker.ts tsdown.config.ts package.json package-lock.json test/surface-devices/ast-walker.spec.ts
git commit -m "feat(ast): gitignore-aware walker with glob and maxFiles"
```

---

### Task 8: 重写 `ast-device.ts` 到引擎上，删除 `natives-loader.ts`

**Files:**
- Modify: `src/devices/ast/ast-device.ts`
- Delete: `src/devices/ast/natives-loader.ts`
- Modify: `test/surface-devices/ast-device.spec.ts`（换后端；loader 段删除）
- Test: `test/surface-devices/ast-device.spec.ts`

**Interfaces:**
- Consumes: `findInSource` / `editSource` / `walkSources` / `languageForPath`（Task 3/5/6/7）
- Produces: `registerAstDevices(registry?)`、`summaries`（签名与文案不变）

- [ ] **Step 1: 重写两个 execute 的取数路径（聚合逻辑保留）**

`ast-device.ts` 里删除 `nativesOrThrow()`，改为：

```ts
import { editSource } from './engine/edit.ts'
import { findInSource } from './engine/match.ts'
import { languageForPath } from './engine/language-map.ts'
import { walkSources } from './walker.ts'
```

`executeAstGrep` 的取数段替换为：

```ts
  await ensureLanguages()
  const target = resolveTarget(rawPath !== undefined && rawPath.length > 0 ? rawPath : '.', cwd)
  const walked = await walkSources(target.root, { glob: target.glob, maxFiles: MAX_FILES })
  const matches: AstFindMatch[] = []
  let filesWithMatches = 0
  const parseErrors: string[] = []
  for (const file of walked.files) {
    const lang = languageForPath(file)
    if (lang === undefined) continue
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch { continue }
    const found = await findInSource(source, lang, patterns[0]!, { includeMeta })
    if (found.unavailable) { parseErrors.push(`${rel(file)}: language unavailable`); continue }
    if (found.matches.length > 0) filesWithMatches += 1
    matches.push(...found.matches.map(m => ({ ...m, path: rel(file) })))
  }
```

> 多 pattern（`patterns: [a, b]`）沿用 native 的 OR 语义：对同一文件**逐 pattern** 调 `findInSource` 后合并；`offset`/`limit` 在合并后的列表上切（`matches.slice(offset ?? 0, (offset ?? 0) + (limit ?? Infinity))`），`totalMatches` = 切之前的长度，`limitReached` = `totalMatches > matches.length`。

`executeAstEdit` 的取数段同理换成 `editSource`，`dryRun` 仍默认 `true`；`applied = !dryRun`；`fileChanges` 由 `changes` 按 path 聚合（沿用现有 `Map` 计数）；`limitReached` 来自 `walked.limitReached`；`filesSearched` 来自 `walked.files.length`。`dryRun:false` 时用 `editSource` 返回的 `rewritten` **一次性写盘**（单一写、单一审计，保持现有 write 契约——不先删后写、不做两次 I/O）。`changes[].path` 归属 `rel(file)`。多 pattern 的 rewrites 已由 `Object.fromEntries` 语义在入口收敛（保留现有逻辑）。

`rel(file)` = `path.relative(cwd, file).split(path.sep).join('/')`。

- [ ] **Step 2: 改写测试文件**

`test/surface-devices/ast-device.spec.ts`：
- 删除 `describe('pi-natives loader')` 整段与相关 import（`loadPiNatives` / `piNativesAddonFilenames` / `piNativesPackageName` / `setPiNativesForTest`）。
- 删除 `describe('ast device failure modes')` 里"addon unavailable"一条，替换为：

```ts
  it('rejects with DVC_DEVICE_ERROR for an unsupported pattern (engine throws through)', async () => {
    const { error } = await dvcWrite('dvc://ast_grep', { patterns: [';;;not a pattern;;;'], path: fixtureDir })
    expect(error.message).toContain('dvc:// device "ast_grep" execute failed')
  })
```

- 其余用例（结构化搜索、分页、dryRun 默认、真写盘、ops 去重、glob、ctx.cwd）**不改断言**，只确认仍绿——它们就是本次换后端的回归网。

- [ ] **Step 3: 删除 loader 并验证**

```bash
git rm src/devices/ast/natives-loader.ts
grep -rn "natives-loader\|pi-natives\|@oh-my-pi" src test --include=*.ts
```
Expected: grep 无输出

Run: `npx tsc --noEmit && npx vitest run test/surface-devices/`
Expected: tsc 0 错；全绿

- [ ] **Step 4: Commit**

```bash
git add -A src/devices/ast test/surface-devices/ast-device.spec.ts
git commit -m "feat(ast): mount ast devices on the in-package WASM engine; drop pi-natives loader"
```

---

### Task 9: `ast-reminder.ts` 对齐语言面

**Files:**
- Modify: `src/devices/ast/ast-reminder.ts`
- Test: `test/surface-devices/ast-reminder.spec.ts`

**Interfaces:**
- Consumes: `EXTENSION_TO_LANGUAGE`（Task 3）
- Produces: `AST_CODE_EXTENSIONS`（集合成员从"对二进制实测"改为"对语言面派生"）

- [ ] **Step 1: 派生集合**

`ast-reminder.ts` 里手写的 `AST_CODE_EXTENSIONS` 字面量替换为：

```ts
import { EXTENSION_TO_LANGUAGE } from './engine/language-map.ts'

/**
 * AST-capable extension set —— 从引擎的语言面**派生**（spec：单一真相源）。
 * 2026-09-27 那版是对 shipped 二进制逐扩展实测的快照；引擎内置后两者必然
 * 一致，不再人工维护第二份。
 */
export const AST_CODE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXTENSION_TO_LANGUAGE))
```

- [ ] **Step 2: 跑现有 spec**

Run: `npx vitest run test/surface-devices/ast-reminder.spec.ts`
Expected: PASS（既有断言集合不变——`.pyi/.mts/.cts/.h/.hpp/.yml` 等都在 `EXTENSION_TO_LANGUAGE` 里）

- [ ] **Step 3: Commit**

```bash
git add src/devices/ast/ast-reminder.ts
git commit -m "refactor(ast): derive the reminder extension set from the language map"
```

---

### Task 10: 文档与许可同步

**Files:**
- Modify: `docs/20_specs/ast/spec.md` + `docs/specs/ast/spec.md`（两文件**内容相同**，同步改）
- Modify: `docs/20_specs/dvc/spec.md` + `docs/specs/dvc/spec.md`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `src/NOTICE-OMP.md`（**不删**——已核它覆盖 browser/lsp/ast 共 8 个文件，ast 只是其一）

- [ ] **Step 1: 行为契约措辞**

`docs/20_specs/ast/spec.md`（及镜像）的 `### Requirement: Lazy natives, zero startup cost` 整段替换为：

```markdown
### Requirement: Lazy in-package engine, zero startup cost
The ast device's WASM engine SHALL load lazily on first use; host start and agent session start SHALL NOT parse anything or load grammar binaries. The engine and its grammars SHALL ship inside the package (`lib/ast-assets/`) and SHALL require no network access, no npm resolution, and no `.vendor` provisioning at call time.

#### Scenario: Cold session
- **WHEN** a session ends without ever invoking the ast device
- **THEN** no WASM engine was instantiated and no grammar binary was loaded

#### Scenario: Offline first use
- **WHEN** the device is first invoked with no network access and no `.vendor` directory
- **THEN** the search still completes from the in-package engine
```

`docs/20_specs/dvc/spec.md`（及镜像）的 `### Requirement: ast devices` 一句改为：

```markdown
The system SHALL provide `ast_edit` (staged structured codemod) and `ast_grep` (structured search) devices, backed by the official ast-grep engine compiled to WebAssembly plus an in-package tree-sitter grammar set (`lib/ast-assets/`), with no OMP and no native binary.
```

- [ ] **Step 2: 许可表**

`THIRD_PARTY_NOTICES.md` 的表格追加三行（MIT，各自 copyright 保留在上游文件里）：

```markdown
| `@ast-grep/wasm` | 0.45.3 | MIT | <https://github.com/ast-grep/ast-grep> |
| `web-tree-sitter` | 0.26.12 | MIT | <https://github.com/tree-sitter/tree-sitter> |
| `@lumis-sh/wasm-*` (14 grammars) | 0.26.x | MIT | <https://www.npmjs.com/org/lumis-sh> |
```

- [ ] **Step 3: Commit**

```bash
git add docs/20_specs/ast/spec.md docs/specs/ast/spec.md docs/20_specs/dvc/spec.md docs/specs/dvc/spec.md THIRD_PARTY_NOTICES.md
git commit -m "docs(ast): retarget the behaviour contract onto the in-package WASM engine"
```

---

### Task 11: 离线第一人称实测 + 零 OMP 实证 + 报告

**Files:**
- Create: `docs/50_test-reports/2026-10-03-ast-engine-deomp-4999实测报告.md`
- Test: 全量 + rig

- [ ] **Step 1: 全量卫生**

```bash
npm run build && npm run typecheck && npx vitest run
```
Expected: build 完成、tsc 0 错、全量单测绿

- [ ] **Step 2: tarball 零 OMP**

```bash
npm pack --dry-run 2>&1 | tail -3
tar -xzf better-dsh-<version>.tgz -C /tmp/astpkg 2>/dev/null || (mkdir -p /tmp/astpkg && npm pack --pack-destination /tmp/astpkg >/dev/null && tar -xzf /tmp/astpkg/better-dsh-*.tgz -C /tmp/astpkg)
grep -rc "pi_natives\|@oh-my-pi" /tmp/astpkg/package 2>/dev/null | grep -v ':0' | head
ls /tmp/astpkg/package/lib/ast-assets | wc -l
```
Expected: grep 无输出（0 处）；ast-assets = 16

- [ ] **Step 3: 离线 rig 实测（对齐"改动点同类"红线）**

```bash
# 断网不可行时，用 BLOCKED registry 模拟：确保 <pkg>/.vendor 不存在 + 无网络
rm -rf /home/u1/workspaces/dashr/.test/home/compat/profiles/web/node_modules/better-dsh/.vendor
cd ~/workspaces/dashr/better-dsh && npm pack
cd ~/workspaces/dashr && DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web remove better-dsh
DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web add $PWD/better-dsh/better-dsh-<version>.tgz
bash .test/seed/test123/start.sh
```

真实 agent session（HTTP 端点发起）依次：
1. `write dvc://ast_grep` `{"patterns":["export function $NAME($$$ARGS)"],"path":"<workspace>/better-dsh/src/devices/ast"}` → 期待结构化命中（`totalMatches`/`filesWithMatches`/`filesSearched` 字段齐全）
2. `write dvc://ast_edit` `{"ops":[{"pat":"export function $NAME($$$ARGS)","out":"export function $NAME($$$ARGS) {}"}],"paths":["<同一文件>"]}`（dryRun 默认 true）→ 期待 `applied:false` 且文件未变
3. 同 ops + `"dryRun":false` → 期待真写盘，`git diff` 可见
4. 期间确认 `<pkg>/.vendor` **没有**被创建，日志无 registry 请求

- [ ] **Step 4: 报告落盘 + Commit**

报告至少含：三个设备调用的真实返回 JSON、`.vendor` 未创建的证据、tarball 计数、全量单测数、与 native 的 A/B 对照表。

```bash
git add docs/50_test-reports/2026-10-03-ast-engine-deomp-4999实测报告.md
git commit -m "docs(test): ast engine de-OMP first-person rig report"
```

> 发布（`npm publish`）仍需 user 单次明确放行 —— 见根 AGENTS.md 〇节，本计划不包含发包。
