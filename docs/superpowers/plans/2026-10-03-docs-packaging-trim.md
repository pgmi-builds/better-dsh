# 发布包瘦身：docs-packaging-trim — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布副本不再携带与 DSH / 本插件无关的材料（别家框架的文档镜像、技能未引用的第三方资料、抓取工具与构建清单），tarball 20.2 MB → ≈3.7 MB、安装后 docs 磁盘 98 MB → ≈15 MB，repo 的 `docs/` 一字不动。

**Architecture:** 只改 `scripts/copy-docs.mjs` 的 EXCLUDE 过滤集。为了可测，把 EXCLUDE 数组从直跑脚本改为**可导入的具名导出**，主流程用 `import.meta.url` 判定是否被 CLI 调用 —— 既有行为零变化，新增纯数据测试面。

**Tech Stack:** 无新依赖。纯 Node `fs` + 正则。

**Spec:** `docs/specs/docs-packaging-trim/spec.md`（含全树盘点表与档位 F 的实测数字）

## Global Constraints

- **repo 的 `docs/` 一字不动**：只改写发布副本 `better-dsh/docs/`。
- 承重面完好：`docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/`（含 `SKILL.md`）、`src/docs/`、`src/site-pages-map.txt` 必须保留。
- 规则按**路径前缀锚定**（`dsh-dev-skill/…`），不做裸名匹配，防误伤同名目录。
- 已知例外（明示接受，不修）：发布副本里 `dsh-dev-skill/src-README.md` 会提到不在包内的 `src-scripts/`，无功能影响。
- 每个 Task 结束 `tsc --noEmit` 0 错 + 相关单测绿 + commit。

---

### Task 1: EXCLUDE 规则 + 可测化

**Files:**
- Modify: `scripts/copy-docs.mjs`
- Test: `test/packaging/copy-docs-exclude.spec.ts`

**Interfaces:**
- Produces: `EXCLUDE: readonly RegExp[]`（含既有 4 条 + 新增 3 条）；`excluded(srcPath: string): boolean`。

- [ ] **Step 1: 写失败测试**

`test/packaging/copy-docs-exclude.spec.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { EXCLUDE, excluded } from '../../scripts/copy-docs.mjs'

describe('copy-docs EXCLUDE (docs-packaging-trim, 档位 F)', () => {
  it('drops the foreign doc mirror entirely', () => {
    expect(excluded('docs/80_upstream-docs-and-skills/hermes-dev-skill/src/api-skills.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/hermes-dev-skill/src-README.md')).toBe(true)
  })
  it('drops the uncited third-party reference and the fetch tooling', () => {
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/pi-and-omp/omp/x.md')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/pi-and-omp/.tools/omp_extracted.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/src-scripts/docs-tree.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/src-scripts/crawl.py')).toBe(true)
  })
  it('keeps every load-bearing path', () => {
    for (const p of [
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/SKILL.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/chapters/ch02-plugin-basics.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/src/docs/architecture.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/src/site-pages-map.txt',
      'docs/50_test-reports/x.md',
      'docs/20_specs/ast/spec.md',
      'docs/specs/ast-engine-deomp/spec.md',
    ]) expect(excluded(p), p).toBe(false)
  })
  it('keeps the pre-existing rules working', () => {
    expect(excluded('docs/60_exploration-and-research/a.md')).toBe(true)
    expect(excluded('docs/superd/x.md')).toBe(true)
    expect(excluded('docs/dsh-sys-prompt_20260910.md')).toBe(true)
  })
  it('exports the rules for audit', () => {
    expect(EXCLUDE).toHaveLength(7)
  })
})
```

Run: `npx vitest run test/packaging/copy-docs-exclude.spec.ts`
Expected: FAIL（模块没有 `EXCLUDE`/`excluded` 导出）

- [ ] **Step 2: 改写脚本**

`scripts/copy-docs.mjs` 顶部改为：

```js
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Path fragments excluded from the shipped copy (matched against source path). */
export const EXCLUDE = [
  /(^|\/)60_exploration-and-research($|\/)/,
  /(^|\/)superd($|\/)/,
  /(^|\/)dsh-sys-prompt_[^/]*\.md$/,
  /(^|\/)[^/]*_artifacts($|\/)/,
  // docs-packaging-trim（docs/specs/docs-packaging-trim/spec.md，档位 F）：
  //   摘掉与 DSH / 本插件无关的材料。repo 的 docs/ 一字不动，只影响发布副本。
  /(^|\/)hermes-dev-skill($|\/)/,                    // 别家框架文档镜像；抓取阶段产物，无 SKILL.md
  /(^|\/)dsh-dev-skill\/pi-and-omp($|\/)/,           // OMP/Pi 第三方资料；技能正文零引用
  /(^|\/)dsh-dev-skill\/src-scripts($|\/)/,          // 抓取工具 + 3.5MB 构建清单
]

/** True when a repo-relative source path must NOT enter the published copy. */
export function excluded(srcPath) {
  return EXCLUDE.some(re => re.test(srcPath))
}
```

原 `cpSync('../docs', 'docs', { recursive: true, filter: … })` 的 filter 改为 `src => !excluded(relativeSrc(src))`，其中：

```js
const relativeSrc = (src) => src.replace(/^\.\.\//, '').replace(/^\.\.\\/, '')
```

（若原 filter 已是等价实现，仅把判定函数换名，别改目录遍历方式。）

文件末尾把原直跑主体包进：

```js
const invokedAsCli = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsCli) {
  // …原有 rmSync + cpSync + 脱敏 walk 逻辑原样…
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/packaging/copy-docs-exclude.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add scripts/copy-docs.mjs test/packaging/copy-docs-exclude.spec.ts
git commit -m "build(packaging): drop foreign docs, uncited references, and fetch tooling from the published copy"
```

---

### Task 2: 构建验证 + 量化 + 报告

**Files:**
- Create: `docs/50_test-reports/2026-10-03-docs-packaging-trim实测报告.md`

- [ ] **Step 1: 重建发布副本并量化**

```bash
cd better-dsh && npm run build 2>&1 | tail -3
du -sh docs
du -sh docs/80_upstream-docs-and-skills/*
```
Expected: `docs` ≈ 15 MB；`hermes-dev-skill` 不存在；`dsh-dev-skill` ≈ 7.3 MB（11 − 2.8 − 0.3 src-scripts 之后余 skill + src）

- [ ] **Step 2: 打包并核对承重面**

```bash
npm pack --pack-destination /tmp/trimpkg
tar -tzf /tmp/trimpkg/better-dsh-*.tgz | grep -c "hermes-dev-skill\|pi-and-omp\|src-scripts"
tar -tzf /tmp/trimpkg/better-dsh-*.tgz | grep -c "dsh-dev-skill/skill/SKILL.md"
tar -tzf /tmp/trimpkg/better-dsh-*.tgz | grep -c "dsh-dev-skill/src/site-pages-map.txt"
ls -la /tmp/trimpkg/better-dsh-*.tgz | awk '{printf "tarball %.1f MB\n", $5/1048576}'
```
Expected: 第一个 grep = **0**；后两个 = **1** 各；tarball ≈ 3.7 MB

- [ ] **Step 3: 零新增悬空引用（已知例外除外）**

```bash
tar -xzf /tmp/trimpkg/better-dsh-*.tgz -C /tmp/trimx 2>/dev/null || (mkdir -p /tmp/trimx && tar -xzf /tmp/trimpkg/better-dsh-*.tgz -C /tmp/trimx)
grep -rn "hermes-dev-skill\|pi-and-omp\|src-scripts" /tmp/trimx/package/docs | grep -v "src-README.md"
```
Expected: 除 `src-README.md` 那一处外无输出

- [ ] **Step 4: rig 冒烟 + 报告**

`bash .test/seed/test123/start.sh` 后确认：
- 会话技能目录仍列出 `dsh-dev-skill`，`skill://dsh-dev-skill` 可读
- `read dsh://docs` 列表正常；抽查 `dsh://docs/50_test-reports/` 一份可读

报告记录：tarball 前后体积、磁盘前后体积、四条 grep 计数、技能可读证据。

```bash
git add docs/50_test-reports/2026-10-03-docs-packaging-trim实测报告.md
git commit -m "docs(test): docs packaging trim measurement and rig smoke"
```

> 发布（`npm publish`）仍需 user 单次明确放行 —— 见根 AGENTS.md 〇节，本计划不包含发包。
