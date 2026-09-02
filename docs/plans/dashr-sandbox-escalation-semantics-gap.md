# DSH 沙箱-审批语义缺口：模型先验抑制升级尝试

> 日期：2026-09-01
> 范围：upstream DSH 运行时权限语义（`@deepseek-ai/dsh-sandbox` / `dsh-sandbox-policy` / `dsh-permission-presets` / `dsh-user-approval`，全部结论来自安装包源码核实 + 本机实测）
> 性质：源码证据链 + 语义缺口分析 + 设计提案
> 关联：`docs/plans/dashr-security-sandbox-analysis.md`（2026-08-17，kernel 沙箱边界穿透）；同 session 的 workspace-write 沙箱实测（bwrap `--unshare-pid`，宿主 PID 不可见）

## 0. 结论先行（TL;DR）

**问题**：workspace-write 模式下，模型上下文主动声明 "Current DSH file policy: workspace-write…"（一个只描述限制、不描述出口的句子），却没有告知"受限操作可按调用**单次升级**（`allowed-once`）"。这给大模型注入了一个先验——"整个运行时是沙箱化的、不可绕过的"。后果是模型倾向于**自我设限**：面对 out-of-box 命令时直接报告"受限运行时干不了"，**根本不会去尝试**，因此**永远看不到** denial 返回里附带的升级提示。Denial message 是"后话"——它只对**先尝试过**的模型可见；先验一旦抑制了尝试，升级路径对整个运行时就是永不可见的死信息。

**提议**：沙箱限制**对用户可见**（UI badge + 审批弹窗），但对模型采取"**后知**"披露（model-late disclosure）——不预先声明"你被沙箱化/不可变"，让模型先尝试、撞 denial、再从 denial + escalation hint 中学习"可单次升级"。形成「尝试 → 拒绝 → 可升级」的完整闭环，而不是「告知 → 自我设限 → 死锁」。

**事实支撑**（§2 证据链）：DSH 自身就是"双 knob"模型（sandbox/mode × approval/policy，解耦设计，源码原话 "independent … knobs"）；升级语义字面为 `allowed-once`（单次、按调用、执行前审批）；且三个模式的上下文语句**存在不对称**——read-only 模式反而含有反自我审查指令，workspace-write 没有。

---

## 1. 背景与动机

- Agent 运行时（DeepSeek Harness）的工具执行经 bwrap 沙箱：`--ro-bind / / --unshare-pid --tmpfs /tmp --bind <workspace>`。根文件系统只读、独立 PID namespace、/tmp 为私有 tmpfs、网络 namespace 共享（实测，2026-09-01）。
- 沙箱之外存在一条**单次热升级**通道：工具调用可带 `sandbox_permissions` 重试，经用户审批后该次调用以更宽模式执行（`allowed-once`），下一条调用回到原有效模式。
- 这条通道**语义上无法从"我被沙箱化"推导出来**：Sandbox（capability 层）与 Approval（decision 层）是正交维度；一个只被告知"你被沙箱化"的模型，不会自行推导出"ask for approval 可以解开沙箱"。
- 本文记录该语义缺口，并提出"用户可见、模型后知"的披露策略。

## 2. 源码事实核对（证据链）

全部结论可在安装包源码中复现：`<dsh>/node_modules/@deepseek-ai/dsh-{sandbox,sandbox-policy,permission-presets,user-approval}/lib/`。

### 2.1 双 knob 模型（`dsh-permission-presets`）

设计文档原话：*"User-facing permission presets over the **independent** sandbox-mode and approval-policy knobs."*

- **knob 1 — sandbox/mode**：`read-only | workspace-write | danger-full-access`
- **knob 2 — approval/policy**：`ask | never`（仅两个值）

preset 只是两 knob 的捆绑，默认表：

| preset | sandbox | approval |
|---|---|---|
| `workspace-write` | workspace-write | **ask** |
| `danger-full-access` | danger-full-access | **never** |

推论：官方把 unboxed 与 never 绑定，等于承认"ask 的触发源是 denial"——unboxed 模式没有 denial 事件，ask 就成了惰性 knob。用户设想的 "unboxed ask"（unboxed + ask）不是内置 preset，但 `presets` 表可配置、任意组合允许（不匹配任何表项时投影报 `custom`）。

### 2.2 单次升级机制（`dsh-sandbox/lib/types/escalation.d.ts` + `lib/index.js`）

- 升级**在执行前**解决：`approveEscalation` — *"resolve a sandbox-escalation request BEFORE anything executes"*，有序 fail-closed：严格加宽校验 → 审批通道 → 结果映射。
- 审批结果枚举字面：**`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`**。
- 粒度**恰好这一次调用**：*"Returns the granted mode to stamp onto exactly this call"*；`SandboxPolicy` 注释 *"an approved escalated retry is a new call with a wider policy"*。→ 不是"逃出沙箱"，是**调用级换挡**。
- 严格加宽阶梯（执行期校验，非 schema 静态值）：

```js
WIDER_MODES = { "read-only": ["workspace-write","danger-full-access"],
                "workspace-write": ["danger-full-access"] }
```

- 非加宽请求**永不弹审批**（*"a non-widening request never prompts a human"*，直接拒）。
- 无审批通道 / 无 agent → fail closed，绝不静默放行。
- `sandbox_permissions` 与 `justification` 必须成对（理由缺失 = malformed ask）。

### 2.3 三个模式的模型上下文语句（`dsh-sandbox-policy/lib/index.js` `renderPolicyContext`）——**不对称在这里**

| 模式 | 模型看到的上下文 | 是否提及升级 |
|---|---|---|
| `read-only` | "…**Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.**" | **是**（反自我审查指令 + 升级预告） |
| `workspace-write` | "Current DSH file policy: workspace-write. …may modify files under the session workspace: … Some platform temporary areas may also be writable." | **否** |
| `danger-full-access` | "The DSH file sandbox does not restrict file modifications by available operations." | 不适用（已是顶） |

**最常用的 workspace-write 模式没有任何升级提示，而最该防自我设限的 read-only 反而有。** 这正是语义缺口的具体落点。

### 2.4 denial + escalation hint：反应式教学（`dsh-sandbox/lib/index.js`）

- denial 标记：`[sandbox: file access denied under workspace-write mode]`
- 同轮升级提示：`[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`

设计意图（源码注释）：nudge *"lives at the decision point so the sanctioned retry does not depend on the model recalling the tool description"*。→ 设计者已知"模型会忘"，把提示放在 denial 处。但**它依赖模型先触发 denial**。

### 2.5 审批通道（`dsh-user-approval`）

- `APPROVAL_POLICIES = ["ask","never"]`。
- `ask` 语句：*"Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed."* —— 未枚举"什么需要审批"。
- `never` 语句（反向教学）：*"…do not request sandbox escalation (do not set `sandbox_permissions`)."*
- 审批请求当前**唯一喂入方是升级路径**；不存在"unboxed 下某工具类仍强制审批"的 gate（无硬编码 hook）。→ 想让 unboxed+ask 非惰性，需要给 `request()` 加第二个喂入方。

### 2.6 schema 层补充（实测）

工具 schema **始终**广播升级词汇（`ESCALATION_TARGETS = ["workspace-write","danger-full-access"]`，受限即广播）。设计注释：防止 session *"stranded … with no lever"*。→ 升级的**词汇**模型永远拿得到；缺口只在**上下文先验**，不在 schema。修 prompt 即可，不用动 schema。

## 3. 语义缺口的形式化表述

```
先验注入（"workspace-write 限制"）→ 模型自我设限（"受限运行时，干不了"）
  → 不尝试 out-of-box 操作 → denial 永不触发
  → escalation hint 永不可见 → 升级通道对模型是死信息
  → 自我设限成为自我实现的预言
```

- Denial message 是**后话**：它只奖励"先尝试"的模型；不尝试的模型永远到不了决策点。
- 触发尝试的常见前提恰恰是**用户主动要求探索边界**（如"你给我探测一下沙箱边界"），日常任务注意力被任务本身拽住，不会自发地元思考能力边界。
- 与 `danger-full-access`（unboxed + never）形成**巨大反差**：一边是"受限且不告知出口"，另一边是"全开放且不询问"。中间态（workspace-write + ask 可单次升级）的语义价值因此被埋没。

## 4. 设计提案：用户可见、模型后知（model-late disclosure）

### 4.1 核心主张

> 沙箱限制应该**对用户可见**（UI badge、审批弹窗、`/permission` 视图），但**不必在 prompt 里预先声明给模型**——尤其不要用"你被沙箱化、不可改"的表述注入先验。让模型自然去做 out-of-box 尝试（命令行、tool call），然后在 denial 返回值里给它语义提醒（现有 escalation hint 已具备），告诉它可以单次升级。这才是完整闭环。

- 对用户：策略透明（弹窗携带 `justification` 原文 + 审计记录，通道已存在）。
- 对模型：**不预设失败**，尝试 → denial → hint → escalate（可选）→ 用户批准 → 该调用执行。
- 安全面不扩大：denial 拦截在沙箱层，**命令根本没执行**（"nothing has run"）；尝试失败只是多一轮调用，不构成越权。

### 4.2 具体落地选项（按侵入度排序）

1. **最小改动（推荐先做）**：改写 `renderPolicyContext` 的 workspace-write 语句，对齐 read-only 的句式——不宣称限制不可变，改为中性 + 出口预告：
   - 例如："Current DSH file policy: workspace-write (restricted writes; some platform temporary areas may also be writable). Do not refuse a required operation from this policy alone: try the tool normally and follow any denial and escalation guidance it returns."
2. **严格后知（用户主张）**：workspace-write 下完全不向模型声明沙箱状态（策略仅对用户 UI 可见），升级教学完全依赖 denial + hint。副作用：模型可能对常规受限操作（如工作区外写配置）多打几轮 denial——代价小，且正是教学素材。可做成配置开关（如 `discloseSandboxToModel: false`）。
3. **unboxed ask 前置条件**：若要提供 unboxed+ask preset，必须先实现强制审批 hook（§2.5 所述 `request()` 的第二个喂入方），否则 ask knob 是装饰性的。

### 4.3 披露对称性原则（通用准则）

无论披露什么，**约束与出口必须成对披露**：告诉模型存在约束，就同时告诉它缓解阀（read-only 语句已示范；`never` 语句是反向示范）；不告诉它约束，就由 denial 在决策点教学。禁止"只披露约束、不披露出口"——那是把模型锁进自我实现的预言里。

### 4.4 零侵入实现路径（插件侧，机制已核实 2026-09-01）

> 结论：中性披露**不需要侵入 upstream 源码**。System Prompt 按两个独立集合组装——sections（主 prompt 区）与 contexts（"Current runtime context" 快照区）；两区都支持插件注册，且有组装期改写钩子。

**机制核实**（`dsh-system-prompt` + `dsh-agent-loop` 源码）：
- `ctx.systemPrompt.section()` / `context()` 均为公开 API，任意 order 可注册；contexts 按 order 排序渲染进 `"Current runtime context. This snapshot supersedes…"` 快照（`sandbox:policy`=110，`approval:policy`=115，`subagent:delegation`=120）。
- `assemble()` 尾部有 `system-prompt/assemble` waterfall（"the returned waterfall value is authoritative"）——插件可整体改写 assembly，含 contexts 文本。
- DASHR 已注册 `dashr:control-prompt`（section，order 100）与 `dashr:tool-catalog`（150）——注入通道现成。

**三条路径**（按与政策段落的贴合度排序）：
1. **A. 插件注册 context（order 116）**：`ctx.systemPrompt.context({ name: 'dashr:escalation-guidance', order: 116, text: … })`。渲染进**同一个** runtime-context 快照，紧贴 `approval:policy`（115）之后——模型视为运行时事实的一部分；零上游改动、声明式、无冲突。
2. **B. assemble waterfall 原位改写**：注册 `system-prompt/assemble` listener，把 `assembly.contexts` 中 `sandbox:policy` 的 text 替换为中性 + 出口预告版。模型看到的是政策段落**本体**被改写，等同原位 patch；代价是 waterfall 语义（last non-undefined wins）需与其他 listener 协调。
3. **C. 现有 section 追加一句**：在 `dashr:control-prompt` 加一句。可用，但落在主 prompt 区，与 `sandbox:policy`（快照区）**物理分离**——正是"都在 System Prompt 但隔了一段距离"的情形；且 order 100 先于快照区渲染，属次优位。

推荐：**A 为主，B 为可选强化**。两者都不改 upstream 一行代码。

**最终决策（2026-09-01，并入升级批次）**——选项 A 的落地规格：

- **注入文本（精简：只披露能力，不劝导行为）**：
  `Restricted operations may be retried once with sandbox_permissions for single-call escalation, pending user approval.`
  （语义即"受限操作可带 sandbox_permissions 单次升级（需用户审批）"；**不做**"不要仅凭策略拒绝、先尝试"之类的行为劝导——尝试与否由模型自行决定，运行时只负责让杠杆可知。注入文本用英文，与上游 runtime-context 快照的英文语句同文风。）
- **注入条件（模式判断，仅 workspace-write）**：`text: (ctx) => 有效模式 === 'workspace-write' ? TEXT : ''`（空文本被渲染器过滤，等同 pass）：
  - `read-only`：pass —— 上游该模式语句已自带反自我审查 + 升级指引（§2.3），无需重复；
  - `danger-full-access`：pass —— unboxed，无升级目标可言。
- **机制**：§4.4-A（`ctx.systemPrompt.context({ name: 'dashr:escalation-guidance', order: 116 })`），声明式、零上游改动。
- **批次**：作为一次升级批次中的一项变更，与其余待改项一次性采集实施（§6）。

## 5. 权衡与反方观点

| 维度 | 后知披露的代价 | 缓解 |
|---|---|---|
| 尝试轮次 | 模型可能对常规受限操作多尝试几次才收敛 | denial 是廉价信号；read-only 语句已验证"尝试→指引"模式可用 |
| 用户困惑 | 用户可能看到模型频繁撞 denial | 弹窗/审计已把决策权交还用户；UI badge 表明当前策略 |
| 与"尽量减少 out-of-box 危险动作"的设计哲学 | 后知披露确实会鼓励更多 out-of-box 尝试 | 但尝试被 denial 拦截，**不执行**；真正执行仍需用户审批，风险决策点不变 |
| 模型上下文长度 | 移除先验可省一行；增加出口预告也只是一行 | 净变化为零量级 |

反方观点（诚实记录）：部分设计者会主张"先验设限"正是安全冗余——模型宁可少做也不越权。但该冗余的代价是把**合法且已有人工审批兜底**的升级通道变成死信息，属于可用性损失换来的虚假安全。审批弹窗（ask）本身就是人工决策点，真正的安全边界在用户那里，不在模型的自我设限里。

## 6. 落地建议清单

- [ ] **插件侧实现（无需上游改动）**：DASHR 注册 `dashr:escalation-guidance` context（order 116，§4.4-A），按 §4.4 最终决策的文本与模式条件实施——仅 workspace-write 注入精简版单次升级披露（read-only / danger-full-access pass）。若改走 upstream PR 路线，再落 `renderPolicyContext`（§4.2-1）。
- [ ] （可选）新增配置项 `discloseSandboxToModel`，默认保留当前披露、可选严格后知（§4.2-2）。
- [ ] 若做 unboxed ask preset：为 `ctx.approval.request()` 增加与沙箱无关的强制审批喂入方（按工具类/高危类），并配套文档说明 ask 只在有触发源时有意义（§4.2-3）。
- [ ] 文档化披露对称性原则（§4.3）为权限语义设计不变量。
- [ ] 将"双 knob 解耦（sandbox = enforcement，approval = decision，可组合不可推导）"写入项目约定（CONTEXT.md 或 ADR）。

## 7. 结论

语义缺口真实存在且可定位到具体代码行（`dsh-sandbox-policy/lib/index.js` 的 `renderPolicyContext`）；修复方向明确——**用户可见、模型后知**：策略对用户透明，对模型不注入"不可变"先验，让 denial + escalation hint 在决策点完成升级教学。该改动不扩大攻击面（denial 拦截在执行前），不增加人工决策负担（审批通道已存在），只消除"模型连试都不敢试"的死锁。
