# 2026-09-26 — LSP mount 收尾 + AST 可用性提醒 hook

状态：**已实现，测试全绿，未发布**（commit 见 better-dsh `change(2026-09-26-lsp-ast-reminder)`）。

## 背景（已裁决的事实）

1. LSP gate 的 per-agent 挂载修复（`agent/session-start` → `agent/created`）已在 HEAD
   （`ce0541c`，2026-09-24），**未发布未部署**（最后 tag `v0.2.4b`，prod 跑的是它）。
   本计划核实其完备性，不重复实现。
2. AST 提醒（新功能）：在 `write`/`edit`/`grep` 的工具结果尾部追加一行
   "ast_edit / ast_grep 可用"提示。**无 cap、每次都提示**（user 裁决 2026-09-26），
   但按文件类型收窄（user 裁决：只认 Python/TypeScript 有限集）。
   不与 LSP gate 交互、不中断/不改写原结果。
3. auto-review 适配（binding schema）**本计划不做**（user 裁决：experimental，不适配）。

## 核实项（Task 0，只读）— 全部通过

- [x] `src/url-schemes/index.ts` per-agent 挂载在 `agent/created`（HEAD 已修）
- [x] `src/index.ts`（REPL 行）同上（:1114）
- [x] 核心 0.1.7 发 `agent/created`/`agent/disposed`，不发 `agent/session-start`
- [x] 核心 `postExecute` 认 accept+content 变体 → notice append 在挂载后即生效
- [x] `src/hashline/index.js` 的 `session-start` 监听属旧独立插件壳，不在 bundle
  exports（活路径是 `install.js#installHashline`，随 installAgentTools 走）
  → **不改动**，仅在报告中记录
- [x] 全量 grep src 确认无其他死事件注册

## Task 1: `ast-reminder` 纯函数模块（TDD）✅

- `src/devices/ast/ast-reminder.ts`
- `test/surface-devices/ast-reminder.spec.ts`
- 扩展名集：`.py .ts .tsx .mts .cts`；grep 规则：include 命中 py/ts、或 path 为
  目录/缺省/代码文件 → 提示；仅当 path 明确指向非代码文件时静默。
- 文案单行：`ast_edit / ast_grep available for Python/TypeScript — write
  dvc://ast_edit (structured rewrite) or dvc://ast_grep (pattern search)`

## Task 2: 接入 post-execute 钩子 ✅

`src/url-schemes/index.ts`：工具名集合扩为 `read/edit/write/grep`；LSP 语义逐字节
不变（副作用时序、isError 早退、accept-only append）；两个 suffix 组合到一次
append（`appendSuffixes` 泛型 helper）。

## Task 3: 构建 + 全量测试 ✅

`npm run build` ✔；`tsc --noEmit` host+client ✔；`vitest run` **617 passed +
1 skipped**（基线 611+1skip，新增 ast-reminder 单测 7 + 钩子级 6）。

## Task 4: 4999 第一人称实测（待执行）

`bash .test/seed/test123/start.sh` 需 systemd-run（user bus）——agent 会话沙箱可能
拒绝；被拒则交 user 在终端执行。验收点：
1. boot graph 含 `better-dsh`；2. 新会话写 `.py` 后工具结果尾部两行提醒
（LSP nag + AST 行）；3. `.md` 写入零提醒；4. 模型据提示真实调用 `dvc://ast_grep`。

## 明确不做

- auto-review binding schema 适配（user：experimental，不适配）
- `src/hashline/index.js` 死事件改名（不在发布面，记录即可）
- npm publish / GitHub tag（需 user 单次确认）
