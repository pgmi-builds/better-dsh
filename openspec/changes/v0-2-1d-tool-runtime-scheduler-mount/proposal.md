## Why

v0.2.1c 已把 REPL 子分派的「裸 `undefined.prepare` TypeError → daemon 崩溃」降级为「cell 可见 loud 错误」（不崩溃 + 可见错误），但**根因未解**：生产组合把 `runtimeCtx.tools` 解析为缺 `TOOL_RUNTIME_SCHEDULER` 实例 symbol 的 scope/service 视图，REPL `tool.*` 子分派在活体 daemon 上**实际不可用**（每次调用都返回 loud 错误而非真实结果）。本 change 真正修复挂载，让调度器 symbol 在位、REPL 子分派实际执行。
> **更正（2026-09-02 活体探针）**：上段「scope/service 视图」为当时的推断，已被证伪。真实根因是**部署拓扑 dual-copy**：崩溃期插件嵌套 `node_modules/@deepseek-ai/*` symlink 指向 dsh-alpha 源码，插件与 host 各持一份 dsh-tools，`TOOL_RUNTIME_SCHEDULER` symbol 跨副本不等 → 实例字段读 undefined。改名悬空 symlink + 清理 + 重启后生产已自愈（活体 4/4 探针通过）。本 change 收敛为：根因落档、guard 错误自诊断增强、symbol 同一性回归锁定；registry 获取路径**不改**。详见 design.md Context/D2。
## What Changes

- **修复 dashr 侧 tools 服务解析路径**：生产组合必须让 REPL 子分派拿到带 `TOOL_RUNTIME_SCHEDULER` symbol 的原生 `ToolRuntime` 实例。根因：`dashr/src/index.ts:1011` 用 `const registry = runtimeCtx.tools`（cordis traceable 访问器）取服务，`getTraceable` 对带 `symbols.shadow` 的值返回 `Object.getPrototypeOf(value)`——类原型有方法（`executionMode`）而无实例 symbol 字段（`TOOL_RUNTIME_SCHEDULER`），故 `:695` 的 `registry[TOOL_RUNTIME_SCHEDULER]` 恒为 undefined。修正点在 **better-dsh 仓库内的 `dashr/src/index.ts`**：改走保留实例 symbol 的解析方式（原始服务解析而非 traceable 访问器），具体机制在 design.md 定。
- **dashr 侧跟进**：补「生产形态挂载测试」——按 harness plugin-tree/scope 方式挂载插件，断言 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 已定义 + 一个真实工具 RPC 从 cell 完成；scheduler 防御（六.2 guard）保留为异常挂载的降级兜底，而非常态拒绝。
- **回归核验**：修复后重跑诊断矩阵 4 探针（`tool.subagent` bg:false / bg:true、`tool.bash` bg:true、`tool.read`），4/4 应返回真实结果（或合法无效调用的可见错误），journal 无新崩溃。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `repl-dispatch-resilience`: 把「生产组合 SHALL 解析带 `TOOL_RUNTIME_SCHEDULER` symbol 的原生 `ToolRuntime` 实例」从 v0.2.1c 的「防御性 loud 错误兜底」推进为「真实可用」——挂载修正后调度器 symbol 在位、REPL 子分派实际执行并返回结果；loud 错误兜底降级为异常挂载的降级路径。

## Impact

- **代码**：`dashr/src/index.ts`（tools 服务解析路径，`:1011` registry 获取 + `:695` scheduler 查询）；`dashr/test/bridge.spec.ts`（生产形态挂载测试）。
- **依赖**：无新增依赖；不改 native DSH（`@deepseek-ai/dsh-tools` / `@deepseek-ai/cordis`）版本——修复在 better-dsh 自身代码内。
- **测试**：生产形态挂载测试 + 4 探针矩阵重跑（活体 daemon）。
- **文档**：`docs/REPL-工具调用-截断诊断.md` §六.3 根因结论落为「已修复」；`docs/v0.2.1c-实测报告.md` 的「根因在 harness（dsh-alpha）、外部依赖」归属**更正**为「根因在 dashr 自身 tools 服务解析路径，better-dsh 仓库内可修」。
