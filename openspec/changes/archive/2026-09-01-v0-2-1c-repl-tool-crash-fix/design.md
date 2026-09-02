# 设计：v0.2.1c REPL 工具调用 daemon 崩溃修复

## 1. 背景与截断面（复述诊断文档结论）

完整链条（`docs/REPL-工具调用-截断诊断.md`）：cell 工具调用 → `binding()` 构造 `ToolExecutionInput` 并入 pending 队列 → `drive()` 单驱动道 `start()` → `registry[TOOL_RUNTIME_SCHEDULER]` 为 undefined → `scheduler.prepare` TypeError → driver 无 catch → unhandled rejection → `installFailLoud` 判定 fatal → daemon exit(1) → systemd 重启 → repair 合成「interrupted-tool-result」。

关键事实：
- 测试全绿是因为测试组合（`test/helpers.ts`）把 `ctx.tools` 解析到**根作用域的原生 ToolRuntime 实例**（symbol 在位）；生产组合经 harness plugin tree / 预设 realm 挂载，`runtimeCtx.tools` 解析到**缺实例 symbol 字段的服务视图**。
- cordis traceable proxy 的 `get` trap 对 symbol 转发 `Reflect.get(target, prop, receiver)`，所以 symbol 丢失不在 traceable 层本身——生产视图是另一个对象形态（有方法、无实例字段）。
- harness agent-loop（`packages/core/agent-loop/src/tool-calls.ts:152-173`）同样经 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 取调度器且**正常工作**——说明生产环境里**存在**一个能解析到原生实例的路径；dashr 的 `runtimeCtx.tools` 与其不同源。

## 2. 分层修复方案

### 2.1 六.1 `drive()` 加 catch（强制前置，dashr 侧立即修）

`drive()`（`src/index.ts:591-625`）的 async IIFE 是 `try { … } finally { … }` 无 catch；调用处 `void drive()`。任何 `start()`/`commit()` 抛错都变成 unhandled rejection，binding promise 既不 resolve 也不 reject → cell 永久挂起 + 进程崩溃。

**改动**：给 async IIFE 补 `catch (error)`。错误分两类处理：
- **pending 中未启动的条目**：遍历 `pendingQueue`，把每个未 settle 的条目以错误 settle（其 `settle` 回调会把结果转成 `{ isError: true, message }` 并 resolve binding promise——但注意 `settle` 是 `PendingDispatch` 内部闭包，需在 catch 里访问；当前结构里 `settle` 定义在 `new Promise` 的 executor 内、经 `pendingQueue.push({...settle 引用在对象闭包里…})` 闭包捕获，catch 无法直接调用——所以需要重构：把 `settle` 提升为每个 pending 条目自己的字段，或在 catch 中遍历队列调用条目的错误 settle 方法）。
- **错误本身的归因**：当队列中第一个未 settle 条目在 `start()` 抛错时，把该条目的 binding promise reject 为 `ToolCallError`（由 kernel 转成 cell 可见错误）。

实现要点（与现有结构最小侵入）：
- `PendingDispatch` 增加一个 `fail(error)` 方法（或让 `settle` 可被错误结果调用——`settle` 已支持 `result.isError`，只需把 `start()` 抛错包装成 `ToolExecutionResult` 形态 `{ isError: true, error }` 再调 `settle`）。
- `drive()` catch 中：若当前在跑的条目已抛错（start 抛错会中止循环），找到对应条目调 `fail`；其余 pending 条目由 run 结束时的 `abandon()` 路径处理（`runController.signal.aborted` 已在循环内处理）。
- 关键不变量：**binding promise 必须 settle，进程不得有 unhandled rejection**。

### 2.2 六.2 scheduler 防御

`binding()` 内 `const scheduler = registry[TOOL_RUNTIME_SCHEDULER]`（`src/index.ts:666`）裸取。

**改动**：取后立即判空：
```ts
const scheduler = registry[TOOL_RUNTIME_SCHEDULER]
if (scheduler === undefined) {
  throw new Error(`${EVAL_NAME}: the tools service resolved by this composition lacks the TOOL_RUNTIME_SCHEDULER symbol (registry is a scope/service view, not the native ToolRuntime instance) — REPL sub-dispatch cannot run; check the harness mount wiring (packages/core/tools) for the plugin's tools service resolution`)
}
```
抛错发生在 `binding()` 内、`new Promise` 之外，会直接 reject binding promise → kernel 转 `ToolCallError` → cell 可见。配合六.1 的 catch，此错误绝不外泄。

### 2.3 六.3 根因定位与修正（harness 接线）

- 探针：在活体 daemon（部署 lib 重建后）的会话里，用 cell 检查 `registry` 形态——但 cell 只见 `tool.*` 命名空间、不见 `runtimeCtx`；更可靠的是**六.4 生产形态挂载测试**在测试环境按 harness 的 plugin-tree/scope 方式挂载（`createScope` + preset realm + agent 加入），断言 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 是否定义。若测试能复现「缺 symbol 视图」，则修正挂载解析（例如插件改用 `ctx.get('tools')` 在 agent 作用域解析、或 harness 侧修正 preset realm 的 tools 服务提供）。
- 若根因在 harness（`dsh-alpha` 仓库），记录为外部依赖修复，本 change 在 dashr 侧先防御（六.1+六.2）+ 探针确认；六.4 测试固化为回归护栏。

### 2.4 六.4 生产形态挂载测试

新增测试（放 `test/bridge.spec.ts` 或新文件）：按 harness 形态——根 `ctx` 挂 `SystemPrompt` + `ToolRuntime` → 创建 preset `Scope` → preset.ctx 挂 `Presentation`（dashr 插件）→ 在 preset 下创建 agent scope → 用 `ctx.inject(['tools'])` 形态解析 `runtimeCtx.tools` 断言 `[TOOL_RUNTIME_SCHEDULER]` 已定义 + 从 cell 完成一次真实工具 RPC（fake 工具注册于根，cell 内 `await tool.<fake>` 返回结果）。这面测试在**测试组合**上验证，若测试组合形态与生产一致则绿；若不一致则暴露差异点。

### 2.5 六.5 回归核验基线

部署同步 + daemon 重启后，在活体会话重跑诊断文档第一节 4 探针矩阵，要求 4/4 返回结果而非截断；`journalctl --user -u dsh.service` 无新崩溃。结果写入 `docs/v0.2.1c-实测报告.md`。

## 3. 部署与版本

- `dashr/package.json`：`0.2.1-b` → `0.2.1-c`。
- 重建 `dashr/lib`（`pnpm build` 或既有脚本），**md5 与部署位逐字节核对**——部署位当前 `284722a7` 是 v0.2.1b 原始构建，工作区 `f0febba7` 已含诊断轮的 spill 回喂修复（未部署）；本次重建同时带上 spill 修复与崩溃修复。
- 同步到 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/lib/`（本会话沙箱只读宿主，需 `danger-full-access` 单次升级）。
- daemon 重启由用户执行（`systemctl --user restart dsh.service` 或 `dsh web` 重启），重启会中断本会话。

## 4. 风险与边界

- **六.1 重构 `settle` 可达性**是唯一结构改动风险点：须保证 catch 路径能 settle 正在抛错的条目，同时不改变正常路径的提交顺序语义（commitQueue 顺序、exclusive 标记、maxParallel 水位）。
- 六.3 若落在 harness 侧，本 change 的 dashr 交付物是「不崩溃 + loud 错误」；「调度器真正可用」取决于 harness 修正，需在实测报告注明。
- 不引入新依赖；不改动 upstream DSH 源码（除非六.3 探针指向 harness 修复，另行记录）。
