## Context

动机见 proposal.md — Why；行为契约见 specs/。本 change 的现状与约束（均已源码/实测核实）：

- **mask 接线**（`dashr/src/index.ts` ~1036-1039）：对整表 `restrict({ deny })` 抛错后逐名降级；单名失败被 catch **静默跳过**。**D1 根因（已确认，2026-09-01）**：standard preset 的 `tool-subagent` 行配置 `modelSelectionSettings: true` → dsh-tool-subagent 走 `agent/created` → `candidate.ctx.inject(...)` 路径，把 subagent 工具注册到**该 agent 自己的层**；registry `restrict` 只过滤 inherited 名（global + ancestors），own-layer 名永远可见、不可 restrict（view() 对 own.tools 无条件 visible）→ subagent 的 restrict 抛错被跳过 → wire/catalog/REPL 全表面泄漏。其余八名（subagent_fork / workflow / ralph 等）无该配置 → composition 层 → 可 restrict → 正常。v0.2.1 报告的 fallbacks 假设不成立。部署 lib 与工作区 md5 一致，排除陈旧部署。会话日志实证：第一轮 request/header 的 wire 数组（43 tools）即含 subagent。
- **eval 描述**（`dashr/src/index.ts:205-217`、`control-prompt.md:8`）：「top-level `await` and `return` work」是 08-19 原生语义重构前的 rewriter 设计残留；kernel 行为正确（`bootstrap.ts:231-280` 显式判顶层 return 为 SyntaxError，`test/runtime.spec.ts:92` 已固化）。
- **非平坦口径**（`dashr/src/py-sdk.ts:447` `isFlatBindableName`）：实现已正确——`__` 中缀是合法标识符，连字符才是元凶；`REPL_BRIDGE_INSTRUCTIONS`（`py-sdk.ts:616`）的措辞「hyphens or `__` infixes」需收紧。
- **系统 prompt 组装**（upstream `dsh-system-prompt`）：contexts 集合按数值 order 排序渲染进「Current runtime context」快照——`sandbox:policy`=110、`approval:policy`=115、`subagent:delegation`=120；`ctx.systemPrompt.context()` 是公开 API；`assemble()` 尾部有 `system-prompt/assemble` waterfall。DASHR `inject = ['tools']`，`systemPrompt` 在 use time 经 `runtimeCtx.get()` 解析；upstream `sandboxPolicy` service 同样可 `get()` 解析，`resolve({ session })` 返回 `{ mode, workspaceRoot }`（approved override > session `sandbox/mode` 事件 > deployment default）。

## Goals / Non-Goals

**Goals:**
- D1（临时决策）：`subagent` 接受暴露并注解为 `agent` 的 alias（不 mask、不覆盖）；其余八名照常 mask、失败显式化。
- D2：eval 描述契约与运行期语义一致（await 保留、return 明示 SyntaxError）。
- O2/O3：catalog 与 control 段非平坦措辞精确化（元凶是 non-identifier characters，非 `__`）。
- escalation-guidance：workspace-write 下注入精简披露（order 116），read-only / danger-full-access 不注入。
- 全部改动零 upstream DSH 源码修改；重建 `dashr/lib` 并 md5 核验部署同步。

**Non-Goals:**
- 不改变 kernel 顶层 return 语义（保持 SyntaxError，与原生 IPython 一致）。
- 不做「严格后知」（完全不披露沙箱状态）——本 change 采用中性披露：保留上游 policy 语句，追加升级指引。
- 不实现 unboxed ask preset / 强制审批 hook（另行 change）。
- 不修改 upstream `dsh-sandbox-policy` 的 `renderPolicyContext`。
- 不修 `subagent` 的 own-layer mask 与 wire 残留（本 change 以 control prompt alias 注解代替；彻底方案轨道 A/B/上游另议）。

## Decisions

**D1. 注入机制：插件 context（order 116），非 waterfall 原位改写**
`ctx.systemPrompt.context({ name: 'dashr:escalation-guidance', order: 116, text })`——渲染进与 policy 段落同一个 runtime-context 快照、紧贴 `approval:policy`（115）之后，模型视为运行时事实；声明式、无冲突面。备选：assemble waterfall 改写 `sandbox:policy` 文本（更"原位"但引入 last-non-undefined-wins 的 listener 协调）；section 注入（落主 prompt 区、与 policy 快照物理分离，次优）。选 context。

**D2. 模式解析：text 函数内 use-time `ctx.get('sandboxPolicy')`**
与上游同口径：`sandboxPolicy?.resolve({ session: context.agent?.session })`，`mode === 'workspace-write'` 时返回注入文本，否则返回空串（渲染器过滤空文本 = 不注入）。service 缺失/无 agent 时 fail closed（空串）。备选：重读 session 事件投影复现解析（重复实现，放弃）。

**D3. 注入文本：精简披露、英文、无劝导**
`Restricted operations may be retried once with sandbox_permissions for single-call escalation, pending user approval.` 只披露 allowed-once 能力；不写「先尝试」也不写「别拒绝」——尝试与否是模型自己的决定（规格 escalation-guidance R2）。英文与上游快照同文风。备选：中文（与上游快照英文不一致，放弃）；中性+劝导（用户明确否决劝导，放弃）。

**D4. D1 处理决策（2026-09-01，用户拍板）：暂时接受暴露 + control prompt alias 注解**

根因（源码核实 + 会话日志实证）不变：standard preset 的 `tool-subagent` 行 `modelSelectionSettings: true` → dsh-tool-subagent 的 `agent/created` 监听走 `candidate.ctx.inject([...])` 把 subagent 注册到该 agent **自己的层**；registry `restrict` 只过滤 inherited 名，own-layer 名永远可见、不可 restrict。**本 change 的决策是缓兵之计而非根治**：

- **接受暴露**：`subagent` 从 `MASKED_TOOL_NAMES` 移除（九名 → 八名），不再尝试 restrict。理由：① 严格说这不是「双面暴露」——REPL 的定义就是直传 tool registry、不做过滤，tool registry → REPL 桥接层的原则（直接桥接，除不符合命名规范者）依然守得住；② REPL 只是整套工具中的一个工具（scratchpad / capacity maximizer），第一层 tool registry 才是入口，90% 场景是 direct call 第一层工具，不应把焦点放在 REPL。
- **alias 注解**：在 control-prompt 自由文本（`control-prompt.md`，非自动硬编码的 tool catalog）加一句：`subagent` 是 `agent`（统一 agent-spawn 入口）的 alias，两者经同一 runtime 委托。逻辑自洽：系统 prompt 投影出重复入口时，明确告知其为 alias，思维模型不崩；运行时大模型无暇深究，随手抓一个能用即可。
- **其余八名照常 mask**；mask 失败显式化保留（对剩余八名，spec: Masking failures surface loudly）。
- **未来彻底方案（另行 change，不在本 change 内）**：轨道 A（部署配置 modelSelectionSettings: false，恢复 composition 层注册）或轨道 B（DASHR own-layer 防线：guard + 绑定/catalog 滤除，wire 残留文档化）或上游修复（dsh-tools own-layer 可见性过滤）。

**D5. D2 措辞落点**：`EVAL_DESCRIPTION` / `EVAL_CELL_PARAM_DESCRIPTION`（`src/index.ts:205-217`）与 `control-prompt.md:8` 统一为同一句式；await 条款保留（行为为真且属环境特性，正需向模型声明）。

**D6. O2/O3 措辞落点**：`REPL_BRIDGE_INSTRUCTIONS`（`py-sdk.ts:616`）的 `hyphens or \`__\` infixes` → `non-identifier characters (e.g. hyphens)`；`control-prompt.md`「Tools inside a cell」补半句非平坦例外，与 catalog 段同义。

## Risks / Trade-offs

- [order 116 依赖 upstream `CONTEXT_ORDERS` 数值布局] → 注册处注释注明依赖（110/115/120）；若 upstream 新增 context 落入区间，重排并更新注释。
- [`sandboxPolicy` service 缺失时注入静默失效] → text 返回空串 fail-closed，加 debug 日志便于核验；对用户体验无影响（本就该不注入）。
- [D1 采用临时方案：subagent 在 wire/catalog/REPL 有意可见（重复入口）] → control prompt alias 注解保证模型面逻辑自洽；若未来模型困惑或注册层变化，再走轨道 A/B/上游（另议）。
- [描述文本与 kernel 语义未来漂移] → `test/runtime.spec.ts` 已固化 return 判错；补一条描述文本断言防回潮。
- [注入文本增加上下文长度] → 一行英文（约 20 token），相对整个 system prompt 可忽略。

## Migration Plan

1. 改 `dashr/src/index.ts`（mask 校验、EVAL 描述、escalation-guidance context）、`dashr/src/py-sdk.ts`（O3 措辞）、`dashr/control-prompt.md`（D2 + O2 措辞）。
2. 补测试：mask 应用后校验单测、eval 描述文本断言、escalation 注入模式矩阵（workspace-write 注入 / read-only、danger-full-access 不注入）。
3. 重建 `dashr/lib`，md5 核对与部署位一致（沿用 v0.2.1 报告的核验方式）。
4. 重跑挂载探针：`dir(tool)` mask 断言、eval 描述读取、注入文本在 runtime-context 快照中的出现与位置。
5. 回滚：还原 `dashr/lib` 构建产物（源码改动仅限上述三个文件，无 schema/数据迁移）。
