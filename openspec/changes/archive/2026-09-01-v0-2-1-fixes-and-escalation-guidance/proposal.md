## Why

v0.2.1 实测报告（`docs/v0.2.1-实测报告.md`）暴露三类问题：工具面 `subagent` 双面暴露（own-layer 注册超出 registry restriction 可达范围）、eval 传输的模型面描述与运行期语义相悖（承诺顶层 return 可用而 kernel 刻意拒绝）、两处 prompt hint 措辞问题。同时设计分析（`docs/plans/dashr-sandbox-escalation-semantics-gap.md`）确认了沙箱升级语义缺口：workspace-write 模式下模型上下文只声明限制、不披露单次升级（`allowed-once`）通道，先验抑制了 out-of-box 尝试。本 change 一次性采集这些修复与注入，**版本代号 v0.2.1b**（上一 commit 0.2.1-a 顺推一位）。

## What Changes

- **subagent 临时处理（D1，接受暴露 + alias 注解）**：`subagent` 从 mask 名单移除、不再尝试 restrict（其 own-layer 注册超出 registry restriction 可达范围，原因已在 design.md 确认）——接受其在 wire / catalog / REPL 的可见性（REPL 本就直传 registry 不做过滤）；在 control-prompt 自由文本注解 `subagent` 为 `agent`（统一 agent-spawn 入口）的 alias、两者经同一 runtime 委托，保持模型面逻辑自洽。其余八名照常 mask；mask 失败显式化保留（对剩余八名）。
- **修正 eval 传输描述契约（D2）**：`EVAL_DESCRIPTION` / `EVAL_CELL_PARAM_DESCRIPTION` 与 `control-prompt.md` 的「top-level `await` and `return` work」改为「top-level `await` works（kernel 以 `PyCF_ALLOW_TOP_LEVEL_AWAIT` 编译并运行模块协程）；顶层 `return` 是 SyntaxError——cell 以 module scope 运行」。await 条款保留（行为为真且属环境特性，需向模型声明）。
- **收紧 catalog 段非平坦措辞（O3）**：bridge instructions 的 `hyphens or \`__\` infixes` 改为 `non-identifier characters (e.g. hyphens)`，避免模型把合法标识符 `__` 中缀误读为禁用符。
- **control 段补齐非平坦例外（O2）**：`control-prompt.md`「Tools inside a cell」补半句非平坦例外，与 catalog 段互为印证，防御 control 段未来独立渲染。
- **新增沙箱升级指引注入（escalation-guidance）**：DASHR 注册 `dashr:escalation-guidance` context（order 116，位于 `approval:policy` 115 之后），**仅当**有效 sandbox 模式为 `workspace-write` 时注入精简披露文本（英文：「Restricted operations may be retried once with sandbox_permissions for single-call escalation, pending user approval.」）；`read-only` / `danger-full-access` 不注入（前者上游已自带指引，后者无升级目标）。只披露能力、不劝导行为。

## Capabilities

### New Capabilities
- `escalation-guidance`: 沙箱升级指引注入——workspace-write 模式下向模型披露单次升级（allowed-once）能力，仅模式条件触发、精简披露、零上游改动。

### Modified Capabilities
- `tool-surface`: subagent 有意不 mask 并注解为 agent 的 alias（D1）、mask 失败显式化（对剩余八名）、eval 传输描述契约（D2）、catalog 段非平坦措辞精确化（O3）、control 段非平坦例外（O2）。

## Impact

- **代码**：`dashr/src/index.ts`（`MASKED_TOOL_NAMES` 九名 → 八名、`EVAL_DESCRIPTION`/`EVAL_CELL_PARAM_DESCRIPTION` ~205-217、新增 `dashr:escalation-guidance` context 注册）、`dashr/src/py-sdk.ts`（`REPL_BRIDGE_INSTRUCTIONS` ~616）、`dashr/control-prompt.md`（D2 措辞、非平坦例外、subagent alias 注解）。
- **测试**：`test/runtime.spec.ts`（顶层 return 判错已固化，需补描述契约断言）、mask 双面探针、escalation 注入探针（模式矩阵）。
- **文档**：`docs/v0.2.1-实测报告.md`（结论留档）、`docs/plans/dashr-sandbox-escalation-semantics-gap.md`（§4.4 最终决策为注入规格来源）。
- **无新依赖**；不涉及 upstream DSH 源码改动（注入走公开 `ctx.systemPrompt.context()` API）；部署需重建 `dashr/lib` 并核对与部署位 md5 同步。
