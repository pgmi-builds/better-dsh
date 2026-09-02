## Context

- 部署/运行态：dashr 插件（`@pgmi-builds/better-dsh`）挂载进 harness（原生 DSH），REPL `eval` 的 `tool.*` 子分派走 `dashr/src/index.ts` 的 `binding()`。
- 关键代码位：
  - `dashr/src/index.ts:1011` `const registry = runtimeCtx.tools` —— 经 cordis traceable 访问器取 tools 服务。
  - `dashr/src/index.ts:695` `const scheduler = registry[TOOL_RUNTIME_SCHEDULER]` —— 读实例 symbol 字段（v0.2.1c 已加判空 guard，缺 symbol 时抛 loud 错误）。
  - `dashr/src/index.ts:1079` `runtimeCtx.tools.register(createRunCellTool(registry, {...}))` —— 把 `registry`（shadow 展开后的原型）传进工具工厂。
- 对照原生 code-mode（`packages/core/tools/src/index.ts:923`）：`createRunCodeTool(this, {...})` 传的是 **ToolRuntime 实例本身**（`this`），其 `code-mode.ts:483` 同样 `registry[TOOL_RUNTIME_SCHEDULER]` 却能取到——因为 `this` 是实例、实例自带 `[TOOL_RUNTIME_SCHEDULER]` 字段。
- 根因（cordis `getTraceable`）：`Object.hasOwn(value, symbols.shadow)` 为真时返回 `Object.getPrototypeOf(value)`。生产组合的 preset realm / isolate 发布路径让 tools 服务值带上 `symbols.shadow`，于是 `runtimeCtx.tools` 返回 `ToolRuntime.prototype`（类原型有方法 `executionMode`、无实例字段 `[TOOL_RUNTIME_SCHEDULER]`）。`createTraceable` 代理本会转发 symbol（`typeof prop === 'symbol' → Reflect.get(target, ...)`），但 shadow 分支在其之前短路，代理根本到不了。
- 根因（v0.2.1 时的工作假设，2026-09-02 已被活体证据**证伪并更正**）：当时推断 cordis `getTraceable` 的 `Object.hasOwn(value, symbols.shadow)` 分支返回 `Object.getPrototypeOf(value)`，生产组合的 preset realm / isolate 发布路径让 tools 服务值带上 `symbols.shadow`，于是 `runtimeCtx.tools` 返回 `ToolRuntime.prototype`。
- **更正后的根因（2026-09-02 活体探针 + 受控实验锁定）**：崩溃时期（2026-09-01 17:39–18:02）部署位的插件嵌套 `node_modules/@deepseek-ai/*` symlink（已退役的 dev 接线）指向 dsh-alpha 源码树，插件 import 的 `TOOL_RUNTIME_SCHEDULER` 来自 **dsh-alpha 的 dsh-tools 模块副本**；而 daemon 的 `ToolRuntime` 实例由 **host 自带 vendored 副本**构建，其 symbol 字段以 host 副本的 symbol 为键。两个副本的 symbol 是不同 `Symbol()` 实例——`registry[TOOL_RUNTIME_SCHEDULER]`（alpha 符号）读 host 键实例字段 → `undefined`；字符串键方法（`executionMode`）不受 symbol 同一性影响，故照常工作——与实测症状逐字吻合。`dsh-alpha → z_dsh-alpha` 改名（2026-09-01 22:29）使 symlink 悬空、2026-09-02 清理删除、daemon 重启后，插件解析回落到 host vendored 副本（③→④ 层），单一模块实例、symbol 同一性恢复。
- 活体证据（2026-09-02 18:0x，本 change 探针任务 1.1/1.2 一并完成）：4 探针矩阵经 `eval` cell 路径 4/4 返回真实结果（`tool.bash` fg/bg、`tool.read`、`tool.subagent` bg:false/bg:true）；`require.resolve('@deepseek-ai/dsh-tools')`（自部署位插件目录）= `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`（host vendored 副本）；受控实验证实 host/alpha 两副本 `TOOL_RUNTIME_SCHEDULER` 不严格相等、跨副本读实例字段得 `undefined`。
- 旧诊断 §六.3 的 shadow 分支理论与症状吻合但从未被活体证实；其无法解释「重启后自愈」，dual-copy 机制同时解释故障与恢复，判定为真实根因。v0.2.1c 报告中「symbol 严格相等」的排除测量与崩溃期拓扑矛盾（很可能测的是同一副本两次，或取于改名后），以 2026-09-02 直接证据为准。
## Goals / Non-Goals

**Goals:**
- 让 REPL `tool.*` 子分派拿到带 `[TOOL_RUNTIME_SCHEDULER]` 的原生 `ToolRuntime` 实例，使 cell 内工具调用真实执行并返回结果（而非 loud 错误）。
- 修复点严格落在 better-dsh 仓库内（`dashr/src/index.ts`），不改 native DSH（cordis/dsh-tools）。

**Non-Goals:**
- 不修改 native DSH 的 cordis `getTraceable` / dsh-tools 挂载（那是上游行为，dashr 无权改也不应改）。
- 不移除 v0.2.1c 的判空 guard（保留为异常挂载的降级兜底）。
- 不重构 `createRunCellTool` 的 dispatch 管道本身（六.1/六.2 韧性结构不动）。

## Decisions

**D1：修复落在 dashr 侧 tools 服务解析路径。**
- 选定：改 `dashr/src/index.ts` 里 `registry` 的获取方式，使其返回**保留实例 symbol** 的对象，而非 shadow 展开后的原型。
- 备选（否决）：改 native cordis `getTraceable` / dsh-tools 挂载——越出 better-dsh 边界，且是上游行为。

**D2：获取实例的候选机制——2026-09-02 活体探针裁决：全部候选不需要，registry 获取保持 `runtimeCtx.tools` 原样。**
- 探针结果：现行生产拓扑（① symlink 清理后）下，`runtimeCtx.tools` 的 plain read 即返回带 `[TOOL_RUNTIME_SCHEDULER]` 的原生实例（4/4 探针经 cell 路径真实执行）。原候选 A（apply 上下文 `ctx.tools`）/B（`runtimeCtx.root.tools`）/C（raw `_getImpl`）/D（注册期捕获 `this`）解决的是一个不存在的问题——shadow 视图从未在活体上出现，真实根因是部署拓扑的 dual-copy（见 Context 更正）。
- 遗留有价值动作：① loud guard 错误信息附上插件自身 `require.resolve('@deepseek-ai/dsh-tools')` 的解析路径，使未来任何 dual-copy 事件在错误文本里自诊断；② 回归测试锁定「插件 import 的 symbol 与组合挂载实例的 symbol 键同一」不变量。
- 原候选机制记录（存档，均未实施）：A=apply ctx.tools、B=root.tools、C=raw `_getImpl('tools')?.value`、D=注册期捕获实例。
**D3：保留 v0.2.1c guard 作为兜底。**
- `binding()` 里 `scheduler === undefined` 的 loud 错误保留——修复后正常路径取得到，异常挂载仍 fail loud 而非崩溃。

## Risks / Trade-offs

- [候选 A/B/C/D 全部不需要] → 已由活体探针证实：现行拓扑 plain read 即达；若未来部署再次引入第二副本，guard 的 loud 错误（v0.2.1d 起附解析路径）会立即自诊断。
- [dual-copy 复发风险] → 部署纪律：部署位插件 `node_modules/@deepseek-ai/` 只允许 `schemastery`+`cosmokit`（AGENTS.md ①层契约）；本 change 在诊断文档记录该不变量。
- [测试组合无法复现生产 realm 差异] → 已无 realm 差异需要复现；原「生产形态挂载测试」改为「symbol 同一性回归测试」+ 活体 4 探针矩阵（后者即生产形态本身）。
## Migration Plan

1. ~~探针确认候选机制~~ **已完成（2026-09-02）**：活体 4 探针 4/4 通过 + 解析走查 + 受控 dual-copy 实验，结论「无需改 registry 获取」，D2 裁决落档。
2. ~~改 `dashr/src/index.ts:1011`~~ **取消**：registry 获取保持原样。
2'.（替代）guard 错误信息附 dsh-tools 解析路径（自诊断）+ symbol 同一性回归测试。
3. `npm run build` 重建 lib，md5 核对部署位。
4. 活体 daemon 重跑 4 探针矩阵，4/4 返回真实结果；journal 0 崩溃。
5. 回滚：guard 增强为纯错误文本变化，回滚即恢复原文；guard 本体（v0.2.1c）不动。
## Open Questions

- ~~生产组合里 tools 服务值带上 `symbols.shadow` 的确切附着点~~ **已关闭（2026-09-02）**：活体证据证明不存在该附着点——现行生产拓扑下 `runtimeCtx.tools` plain read 返回原生实例；崩溃期症状由部署拓扑 dual-copy（① symlink → dsh-alpha 第二副本）解释，恢复由 symlink 悬空/清理解释。证据链：4/4 活体探针、部署位 `require.resolve` 走查、host/alpha symbol 严格不等 + 跨副本读 undefined 的受控实验、时间线（改名 22:29 → 悬空 → 清理 → 重启 → 自愈）。
