# 事件报告：write 工具 sandbox 升级透传 bug（复发 + 新失败模式：调用挂起）

> 日期：2026-09-06 · 环境：DSH v0.1.2-alpha 线（prod 3080 / Web GUI），session 模型 GLM，
> file policy = workspace-write（workspace：`/home/u1/workspaces/dashr`），approval policy = ask。
> 前置记录：2026-09-03 edit 工具同类 bug（session `8e966430`，"hashline edit escalation
> passthrough bug"；dashr 插件侧修复 commit `e27fdec` + 报告 follow-up `419ca0e`——该修复仅覆盖
> vendored hashline edit 路径，本次 write 工具复发说明 harness 层文件工具透传问题未除根）。

## 场景

向 workspace 之外写文件：`/home/u1/workspaces/superd/docs/00-blueprint.md`（Super D 蓝图，
新建同级仓）。workspace-write 模式下首次尝试即被拒（`Read-only file system` / file access denied），
按规则走单次 `sandbox_permissions` 升级重试。

## 失败 1（已知 bug 复发）：write 的升级字段被丢弃

首次 `write` 调用携带 `sandbox_permissions: "danger-full-access"` + justification，直接返回
`[sandbox: file access denied under workspace-write mode]`——**未弹出任何审批卡片**，升级字段
疑似在 harness 透传层被丢弃。与 2026-09-03 记录的 edit 工具症状同类：**文件类工具（write/edit）
的 sandbox_permissions 透传失效，bash 工具的升级正常**。

## 失败 2（新失败模式，更严重）：升级后的 write 调用挂起至手动停止

agent 推理链（UI 可见）：此前一次 bash 升级到 workspace-write 被拒，报错提示"升级必须严格宽于
当前模式"（当前已是 workspace-write）；据此判断应改用 danger-full-access 重试 `write`。
该重试调用**表面上已发出，但此后 >5 分钟 agent 无任何活动**——非响应/挂起。用户在 UI 按
"stop" 并发新 prompt 才恢复。

即：升级版 write 不仅没有触发审批提示，还把整个 turn 挂死直到手动中断。两种可能根因待查：
(a) 审批提示从未渲染（透传丢失后 promise 悬空）；(b) 调用 promise 永不 settle。

## 有效的 workaround

`bash` heredoc + `sandbox_permissions: "danger-full-access"` —— bash 的升级链路正常，审批弹出、
批准后写入成功（superd 仓蓝图 + git commit `1c1969a` 均经此路径完成）。

## 建议

1. **修复前**：跨 workspace 文件写入一律走 bash heredoc + 升级，不用 write/edit 的升级。
2. **根因排查**：write/edit 的 sandbox_permissions 透传丢失点（harness 文件工具包装层）；
   以及挂起问题——需区分"审批提示未渲染"与"promise 未 settle"，二者修法不同。
3. 回归范围：至少覆盖 write / edit / undo_last_edit 三个文件工具 × workspace-write 与
   read-only 两种基线模式下的升级路径。

## 同日复测（本地 Web GUI）：write 升级链路实测通过

> 环境差异：prod 3080 / GLM → 本地 Web GUI（127.0.0.1:4999）/ deepseek-v4-flash；
> file policy = workspace-write（workspace：`/home/u1/workspaces/temp`），approval policy = ask。
> 测试目标（workspace 之外）：`/home/u1/workspaces/base/.scratch/dsh_ws_test.txt`

### 实测记录

1. **基线越界 write → 立即被拒，无审批卡**：
   `[sandbox: file access denied under workspace-write mode]`
   且拒绝消息自带第二行 affordance 提示（本轮行为的关键信号源）：
   `[sandbox: escalation available — retry this exact operation once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`
2. **单次升级重试**：`sandbox_permissions: "danger-full-access"` + justification → 返回
   `Created`（审批通过），未再出现 denial；磁盘校验 `-rw------- 1 u1 u1 26`，内容
   `test write from dsh agent`。
3. 全程**无挂起、无字段丢弃、无静默失败**。

**结论**：本地构建上 write 升级链路（字段透传 → 审批渲染 → promise settle）实测通过，与 prod 3080
报告的「字段丢弃 + 挂起」复发症状不一致 → 缺陷疑为环境/构建相关（或已被修复）。建议按上文
「建议 3」在 prod 3080 上回归 write / edit / undo_last_edit × workspace-write 与 read-only 基线。

## 附 A：escalation 提示机制的优化（reminder 文案）

同一机制在 system prompt 中至少出现三处，语义同一但角色不同：
① 工具 schema 参数声明（affordance / API 表面，只声明字段存在）；
② policy 规则段（procedure：何时、怎么用 + 大量禁令）；
③ runtime-context 快照补充句（情境重启，位于每次 turn 顶部、工具调用前最后读到的位置）。

本轮讨论聚焦③的措辞。现文：

> Restricted operations may be retried once with sandbox_permissions for single-call escalation,
> pending user approval.

对字面论 / 风险厌恶型模型，存在两种可被误读的推理路径：

(a) **配额式误读**：「once」被理解为一次性越权许可——只能带 escalation 请求一次；若首次升级被
user deny，模型可能推断整个机制已耗尽、连后续命令也不再尝试升级。但 runtime **无状态**：不记录某
命令是否已 escalate / 被 deny，系统不存在这类配额。
(b) **ask-first 误读**：「pending user approval」被读成先征得批准再 retry，与 policy 的
「don\'t detour through chat — the retry itself raises the approval prompt」相悖。

「once」的字面语义与真实策略（单次 retry）并不冲突；歧义在于**未声明机制的 per-call / 无状态属性**，
而该属性正是阻止 (a) 误读的关键事实。因此措辞应从「配额式」改为「机制式」，显式声明：per-call、
无配额记录、审批由 retry 自动触发、单次 deny 只作用于该 call。

**定稿（同日终版，替换③；上文「主推 / 短变体」作废）**：

> A sandbox-deniable/denied call may be escalated with `sandbox_permissions="danger-full-access"` and a
> one-line `justification`; the runtime will prompt for user approval. Escalation and its
> approval/denial are per-call.

双词并列**中立覆盖两条路径**：`deniable`——读到本段、且按 policy 可演绎判定为越界的调用（workspace +
temporary 之外）直接升级，不做 doomed 往返；`denied`——未注意本段、已被拒的调用同样可升级。全文无
retry / once / 配额措辞。安全边界是**双重硬 guard**：sandbox（policy 判定）+ user approval（审批卡）；
预升级至多多弹一张可拒审批卡，无实害，「等审批」的心理摩擦天然抑制滥用。`danger-full-access` 经源码
核对（`escalation.ts` `WIDER_MODES`：workspace-write → [danger-full-access]，且本句仅在该模式下渲染），
参数名与 justification 单句配对均与 schema 一致。

**具体 example（agent 视角最小推演）**：

```
#1  write(workspace 外路径)                          → denied（无审批，返回 marker + affordance 行）
#2  write(同路径, sandbox_permissions="danger-full-access", justification="…")   → 弹审批卡
    user 点 deny
    → 语义：该 call 就此结束（stop and explain），≠ 「escalation 机制已耗尽」
#3  稍后另一条命令被拒 → 仍可走同一升级路径（per-call，runtime 无配额记录）
    ✗ 错误推理：#2 被 deny ⇒ 我不能再发起任何 escalation
```

**配套建议**：

- ②policy 段的关键句（rejected = final for that command，但不禁止后续命令升级）与③措辞需锁死一致，
  避免三处漂移；
- 最强一层是**环境内信号**：denial 消息自带 affordance 行（本轮实测可见，现构建已带）。它零 token、
  位置恰好、不可能被 attention 漏掉；应作为固定格式保留，并让提示中的 mode / 参数名与消息完全一致。

## 附 B：保留并补充该 reminder 的必要性（语态 / 效价问题）

系统 prompt 原本已含等价语义（②policy 段），但该段 **permission 密度低、被高强度禁令包围**
（Do not detour… / Never escalate speculatively / A rejected escalation is final / no exception /
a denial is final）。LLM 对禁令性词语的权重显著高于许可性陈述；风险厌恶型模型读后的净效价收敛为
「escalation 是高风险的非常规动作，能避则避」——这为观测到的「静默失败」（denial 后直接放弃、从不
尝试升级）提供了行为学解释：**这不是注意力丢失，而是语态 / 效价问题**。

③是全文唯一「零否定、纯许可」的 escalation 表述，且位于 turn 顶部快照（决策前最后读到）→ 命题上
与②重复，但功能上不冗余：它承载 **grant（放行）**，②承载 **procedure（程序 + 禁令）**。本轮复测中
agent 在 denial 后正确、立即升级，除错误消息 affordance 外，③的纯许可语态是「敢试」的直接依据。

结论：③应保留并按附 A 修正措辞；不要在静态 prompt 中继续增加第四处副本（边际收益到顶），后续投资
应放在 denial 消息的 affordance 质量（直接给出该传的 mode）。

## 附 C（新发现 · 待修）：rules 段「escalating up front is fine only when this session already denied the same access」自相矛盾

> 追加于定稿同日；定位为文本漂移，修复另行排期，本轮未改动任何源码。

**归属结论（同日追查）**：该子句位于**上游** DSH v0.1.2-alpha.5 源码——本 checkout 即
github.com/deepseek-ai/deepseek-harness 的浅克隆（HEAD `db6bdc3576`，唯一 remote 为上游
origin）；`packages/shell/tool-bash/src/index.ts:89` 与 `packages/shell/tool-pwsh/src/index.ts:140`
均经 `git ls-files` 确认是上游跟踪文件。blame 止于 `47f943859b`（2026-08-13，上游 PR #2519
merge）系浅克隆边界，真实引入 commit 更早、被截断。对照：刚定稿的快照句（dashr:escalation-
guidance，`packages/better-dsh/better-dsh/src/index.ts`）属 Better Dash（repo：pgmi-builds/
better-dsh），在上游 tree 内为 untracked（`??`）叠层。**修复含义**：改矛盾句 = 改上游跟踪
文件，不能直接 commit 进本 checkout；两条路——上游 PR，或在 better-dsh 的 prompt 装配层覆盖
订正 bash/pwsh 工具描述（与 dashr:escalation-guidance 同款注入方式）。

**自相矛盾分析**：按字面语义，「escalating up front」（未尝试即升级）与「already denied the
same access」（已尝试且被拒，同一 access）互斥——后者成立则前者必然不成立，条件永远无法满足。
属两条规则被硬拼成一句的编辑事故。**推断的原意**：同一 access 已被本 session 拒绝过一次之后，
再次需要时不必重发 doomed 调用、可直接升级（豁免重复往返）——但这层豁免语义句子本身没写出来。

**事实核对（源码）**：

- 该子句仅存在于两处模型可见的工具描述：`packages/shell/tool-bash/src/index.ts:89`、
  `packages/shell/tool-pwsh/src/index.ts:140`；并随描述文本进入 35 个
  `snapshots/**/tool-schemas*.expected.json` 快照（随源重生成，不需手改）。
- 同策略的文档版本（tool-bash / tool-pwsh 的 README.md 与 README.zh.md）**均无此子句**
  （0 命中）——同一策略在工具描述与文档中本就是两个版本（次级漂移）。
- runtime 无 prior-denial 状态：`approveEscalation`（`packages/sandbox/sandbox/src/escalation.ts`）
  只有三道闸——参数配对、严格更宽（`WIDER_MODES`）、审批通道。文档所称
  「a request with no real prior denial … fails closed」在代码中并未实现为状态检查；
  该子句纯属 prompt 层规范。

**与本轮定稿的关系**：附 A 定稿（快照句）规定 deniable（policy 可演绎判定越界）调用可直接升级；
本子句规定 upfront 升级仅在 same-access 已 denied 后才允许——同一动作两个触发定义，且其中之一
自相矛盾。rules 段禁令权重高（见附 B 效价分析），模型大概率取 deny-first 读法，与快照句的
deniable 路径持续张力。

**修复方向（未实施，待排期）**：把豁免语义显式化，例如「once this session has already denied
the same access, you may escalate again without re-firing the doomed call」；或与 deniable 原则
统一为「policy 可演绎判定将被拒的调用可直接升级」。需同步：tool-bash / tool-pwsh 工具描述 ×2、
README ×2（en/zh 一并对齐）、35 个快照重生成；并与 deniable/denied 的 deny-first vs 预判升级
产品决策对齐后再动。
