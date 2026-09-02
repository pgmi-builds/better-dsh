## Why

v0.2.1b 实测报告（`docs/v0.2.1b-实测报告.md`）暴露最严重缺陷 O-3：**任何从 REPL（`eval` cell）内部发起的工具调用（`tool.<name>(...)`）都会让 dsh web daemon 崩溃并自动重启**（4/4 复现，`docs/REPL-工具调用-截断诊断.md`）。截断面是「binding 桥 → registry symbol 查询 → driver 的未处理拒绝」：部署运行态 `registry[TOOL_RUNTIME_SCHEDULER]` 为 undefined（2026-09-01 harness alpha 0.1.2-alpha.1 升级后 `runtimeCtx.tools` 变成缺实例 symbol 字段的服务视图），`scheduler.prepare` TypeError 被 `drive()` 的无 catch async IIFE 放大成 unhandled rejection，`installFailLoud` 判定 fatal → daemon exit(1) → systemd 重启 → repair 合成「interrupted-tool-result」。**这是把「任何分派错误」放大成「整个运行时崩溃」的结构性缺陷，无论直接原因是什么都必须先修。** 本 change 采集修复，**版本代号 v0.2.1c**（上一 commit 0.2.1-b 顺推一位）。

## What Changes

- **六.1 阻断 daemon 崩溃（dashr 立即修）**：`drive()` async IIFE 加 catch；`start()` / `commit()` 抛错必须把 binding promise settle 为错误结果（cell 内转成可见的 `ToolCallError`），**绝不允许以 unhandled rejection 外泄杀 daemon**。这是修复的强制前置，与根因是否解决无关。
- **六.2 scheduler 防御**：`registry[TOOL_RUNTIME_SCHEDULER]` 为 undefined 时抛带上下文的 loud 错误（说明缺调度器 symbol、指向 harness 挂载视图问题），而不是裸 `undefined.prepare` TypeError。
- **六.3 根因定位与修正（harness 接线）**：在活体 daemon 上探针确认 plugin tree 中 `runtimeCtx.tools` 的实际对象形态（cordis 作用域服务视图 / 缺 symbol 的视图），修正挂载/解析使插件拿到原生 `ToolRuntime` 实例（symbol 在位）。测试全绿而生产崩溃的差异即测试组合解析到根作用域原生实例、生产组合解析到视图。
- **六.4 生产形态挂载测试**：按 harness 的 plugin-tree/scope 方式挂载插件，断言 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 已定义 + 一个真实工具 RPC 从 cell 完成——防止此环境差异回归（现有测试组合无法覆盖）。
- **六.5 回归核验基线**：修复后重跑诊断文档第一节的 4 探针矩阵（4/4 应全部返回结果而非截断），并观察 `journalctl --user -u dsh.service` 无新崩溃。
- **部署同步与版本**：`dashr/package.json` 版本 `0.2.1-b` → `0.2.1-c`；重建 `dashr/lib` 并与部署位 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/lib/` md5 逐字节同步（**同时带上诊断轮已实现但未部署的 spill 回喂修复**，工作区 lib `f0febba7` 与部署位 `284722a7` 不一致）；daemon 重启由用户执行。

## Capabilities

### New Capabilities
- `repl-dispatch-resilience`: REPL 子分派韧性——分派错误必须 settle 为 cell 可见的 `ToolCallError` 而非 unhandled rejection；调度器缺失时给出带上下文的 loud 错误；生产组合解析到带 `TOOL_RUNTIME_SCHEDULER` symbol 的原生 `ToolRuntime`；4 探针矩阵全通过为回归基线。

### Modified Capabilities
- 无（既有 `tool-surface`、`escalation-guidance` 的 spec 行为不变；本 change 只改 REPL 分派错误处理与挂载形态）。

## Impact

- **代码**：`dashr/src/index.ts`（`drive()` 加 catch ~591-625、`binding()` 内 `scheduler` 防御 ~666、若需则修 `runtimeCtx.tools` 解析/挂载）。
- **测试**：`test/bridge.spec.ts` 或新增生产形态挂载测试文件（六.4：`ctx.tools[TOOL_RUNTIME_SCHEDULER]` 断言 + cell 内真实工具 RPC）；既有 396 绿保持。
- **文档**：`docs/REPL-工具调用-截断诊断.md`（六 修复方向执行留档）、`docs/v0.2.1c-实测报告.md`（新第一人称核验报告）。
- **部署**：重建 `dashr/lib` 同步部署位（含 spill 回喂修复 + 崩溃修复），md5 核对一致，daemon 重启后核验。
- **无新依赖**；六.3 若需 harness 侧改动则记录在案（可能落在 `dsh-alpha` 仓库，本 change 先在 dashr 侧防御 + 探针确认）。
