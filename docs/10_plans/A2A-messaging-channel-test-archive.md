# Dash 运行时 A2A Messaging Channel 实测存档

> 实测日期（UTC）：2026-08-17T17:57:57Z
> 实测主体：Dash Agent 运行时自身（root session，`deepseek-v4-pro`）
> 工作区：`/home/u1/workspaces/dashr`
> 方式：全程通过 `run_cell` 调用 `tools.*` 实际执行，所有结论均来自真实工具返回，非文档推断。

---

## 1. 测试目标与范围

验证 Dash 运行时的 **A2A（Agent-to-Agent）messaging channel** 是否实现及其边界。

Dash 运行时按 **session 树** 划分 agent，因此 A2A 关系可归为三类：

1. **Parent ↔ Child**（双向）
2. **Siblings**（同父、同层）
3. ~~Out of family tree~~（跨 family tree）

第 3 类**天然不在范围**：运行时没有全局 session 总线，消息路由完全基于 session 树的 `parentSession` 指针。本存档只实测第 1、2 类，并以一个 grandchild 场景做旁证。

---

## 2. 实测拓扑（真实 session 树）

从 root 视角 `list_agents(scope=descendants)` 及各 session 头部记录还原：

```text
ROOT(me)  session-d11e193f-a813-4200-96b1-0465ae8e8063   depth=0  parentSession=null  preset=standard
├── A     f743dca9-3953-4382-ac45-487a27df9db1           depth=1  parentSession=ROOT  preset=rlm-mode
│   └── G 057bd298-d186-4eb4-bb5c-4a6ee2c158cd           depth=2  parentSession=A     preset=rlm-mode
└── B     06ac8b2c-fb2e-458f-80d6-a0d28e50f193           depth=1  parentSession=ROOT  preset=rlm-mode
```

各 session 头部记录（`session.jsonl.zstd` 首行，`type=session`）实测摘录：

| agent | id | parentSession | origin | delegationDepth | agentPreset |
|---|---|---|---|---|---|
| root | `session-d11e193f-a813-4200-96b1-0465ae8e8063` | `null` | `null` | 0 | `standard` |
| A | `f743dca9-3953-4382-ac45-487a27df9db1` | `session-d11e193f-...` | `subagent` | 1 | `rlm-mode` |
| B | `06ac8b2c-fb2e-458f-80d6-a0d28e50f193` | `session-d11e193f-...` | `subagent` | 1 | `rlm-mode` |
| G | `057bd298-d186-4eb4-bb5c-4a6ee2c158cd` | `f743dca9-3953-...` | `subagent` | 2 | `rlm-mode` |

---

## 3. 关键机制发现

### 3.1 身份：subagent id == 子 session id == `DSH_SESSION_ID`

`subagent(..., run_in_background=true)` 返回的 `subagentId` 就是子 session 的 id，也等于子 agent 进程内的 `DSH_SESSION_ID`。

- spawn A 返回：`{"kind":"continuable","subagentId":"f743dca9-3953-4382-ac45-487a27df9db1"}`
- A 自报：`DSH_SESSION_ID=f743dca9-3953-4382-ac45-487a27df9db1`（一致）

### 3.2 父身份：不暴露在 env / list_agents，只写在子 session 日志头部

子 agent **无法**通过环境变量（无 `DSH_PARENT_*`）或 `list_agents`（只显示自己的 children/descendants）得知父身份。

但父身份写在子 agent **自己的** `session.jsonl` 头部 `parentSession` 字段里。B 实测是读自己 session 日志首条记录发现的：

```json
{"type":"session","id":"06ac8b2c-...","parentSession":"session-d11e193f-a813-4200-96b1-0465ae8e8063","origin":"subagent","delegationDepth":1,"agentPreset":"rlm-mode"}
```

### 3.3 路由规则（核心）

`send_message(caller, target)` 仅当 **`target.parentSession == caller.sessionId`** 时放行，即 **只能给自己的“直接子”发消息**。

越界时统一抛 `ToolCallError`：
> `subagent "<id>" belongs to another parent session`

---

## 4. 测试矩阵与结果

### 4.1 Parent ↔ Child ✅（可用，但**不对称**）

| 方向 | 通道 | 结果 | 证据 |
|---|---|---|---|
| Parent→Child | `send_message`（显式下行） | ✅ 可用，可递归 | 见下 |
| Child→Parent | completion notice（完成回传） | ✅ 可用 | A/B/G 每次 final message 都回到 root |
| Child→Parent | `send_message`（显式上行 push） | ❌ 不可用 | `belongs to another parent session` |

**下行实测（都回传了 token）：**
- root→A：`DOWN_PING_8841` → A 回 `DOWN_OK` ✅
- root→B：`RELAY_OK` → B 回 `RELAY_OK` ✅
- A→G：`G_ECHO_PING` → G 回 `G_ECHO_OK` ✅（证明子 agent 可递归当父节点）

**上行实测：**
- A 调 `send_message(subagent_id="session-d11e193f-...", ...)` → 抛错 `subagent "session-d11e193f-..." belongs to another parent session` ❌

> 结论：下行是显式消息通道；上行只有“交结果”的完成回传，**不是对等双向**。

### 4.2 Siblings ❌（无直接通道）

- **A→B 直接发消息**：抛错 `subagent "06ac8b2c-fb2e-458f-80d6-a0d28e50f193" belongs to another parent session` ❌
- **不可见**：A 视角 `list_agents(scope=children)` 与 `scope=descendants` 均返回 `[]`，看不到 sibling B；sibling 关系只有共同父节点（root）能通过 `list_agents` 看到。
- **唯一通路**：经共同 parent 中转（A 交回 root → root 转发给 B）。实测 root→B 中转腿可行。

### 4.3 Grandchild（旁证：规则不特判、只认“直接子”）

- root→G（depth 2）直接发消息：抛错 `subagent "057bd298-..." belongs to another parent session` ❌
- 说明 sibling / 向上 / 跨层 全被同一条规则挡下，**不是针对 sibling 的特判**。

---

## 5. 原始证据汇总

**关键消息 ID（`send_message` 返回）：**
- root→A（DOWN 测试）：`400063ce-b604-48db-b853-5bc2811df8e2`
- root→B（RELAY 测试）：`946106a9-59e3-4527-8eba-211999289db4`
- A→G（follow-up）：`590760b1-443d-4124-a0f9-8bbfc26f0eef`
- A 交叉测试指令：`ace2038e-ca4a-499b-8754-77b1d5c4cacb`

**统一拒绝错误（3 处实测一致）：**
```
ToolCallError(send_message): subagent "<id>" belongs to another parent session
```
分别出现在：A→B（sibling）、A→root（上行）、root→G（跨层）。

---

## 6. 结论

1. **A2A messaging channel 已实现，但形态是“树上的定向消息 + 完成回传”，不是全局对等消息总线。**
2. 边界严格由 `parentSession` 指针决定：`send_message` 只到**自己的直接子**。
3. **Parent↔Child**：下行可用且可递归；上行仅有完成回传，无显式 push。
4. **Siblings**：无直接通道、不可见，只能经共同父节点中转。
5. **Out of family tree / 跨层**：被同一条路由规则拒绝，符合“无全局总线”的预判。

---

## 7. 遗留

测试产生的子 agent A、B、G 当前均处于 `ready`（空闲可续），不会再执行任务，除非继续 `send_message`。
- A = `f743dca9-3953-4382-ac45-487a27df9db1`
- B = `06ac8b2c-fb2e-458f-80d6-a0d28e50f193`
- G = `057bd298-d186-4eb4-bb5c-4a6ee2c158cd`

---

# 附录（2026-08-17 追加）：Prime Agent 参照调查 — Finisher 事件实录与通道对比

> 追加背景：用户对本文 §4.2 的"sibling 之间不能直接通讯"提出疑问——Dash 的机制参考自 Prime Agent（当前 conversation 的运行时），而 Prime Agent 在真实工作中发生过一次 sibling 间"感知"事件（Doer 被用户 Escape 中断后 continue，主 Agent 误判其死亡并派了 Finisher，Finisher 却自己发现了 Doer 还在工作）。本附录从 Prime Agent 的会话日志与源码取证，回答四个问题，并给出两个实现的通道对比表。
>
> 术语口径：本附录按"设施（facility）= 运行时/界面直接提供给模型、cell 内可直接调用的能力"计；"读源码找端点 curl"类旁证不算工具。
> 取证来源：主会话日志 `/home/u1/.prime/agent/sessions/01a00967-75d6-755c-827c-562a446786a1.jsonl`（entry 2352/2357/2358 等）、Finisher 自身 session transcript（`sub-ff62e2e1/*.jsonl`）、Prime Agent 源码 `dist/core/agent-messages.js` + `dist/modes/daemon/daemon-mode.js`。

## 8. Finisher 事件实录（Q1–Q4）

### 8.1 Q1：Finisher 是怎么知道 Doer 还活着的？

**不是消息，是观察通道（`agent_observe`）。** Finisher 自身 transcript 的调用统计：

```
agent_observe.get_agent        ×5   （读 sibling 的实时 status）
agent_observe.recent_messages  ×7   （读 sibling 的 transcript 尾部）
```

它读到的事实：`m4b-doer-glm52 status=running、isStreaming=true`，transcript 末尾是"刚修完 tsc 类型错误、刚跑完孤儿检查"。辅助旁证是文件系统（mtime 4 秒前刚变、debug 文件被删、新文件出现）——但**主通道是直接读 sibling 的 transcript**。在 Prime Agent 里这不是猜测，是读取。

**术语澄清（用户追问，2026-08-17）**：`agent_observe` 不是"读源码 + 找端点 + curl"式的 API 调用。它和 `agent_message`、`websearch`、`edit` 一样，是运行时**预注入 kernel 命名空间的 Python 模块**——模型在 run_cell 里直接 `await agent_observe.get_agent('m4b-doer-glm52')`，与调用任何其他工具无异；daemon 通信、身份、权限对模型完全透明。按用户的设施定义（"界面和运行时直接提供给模型、可直接 interact 的东西"），这是**设施（facility）**，不是外部 API。本文 §9 表格中的"观察 API"字样应按"观察设施"理解——措辞已在下文统一修正。

### 8.2 Q2：Prime Agent 的 channel 能看到 sibling 吗？

**能，且是设计内的一等公民。** 源码（`dist/core/agent-messages.js`）：

```js
agentFamilyRelationship(current, target) {
  if (isAgentFamilyParent(target, current)) return "parent";
  if (isAgentFamilyParent(current, target)) return "child";
  if (current.depth === target.depth && sameAgentFamilyParent(current, target, ...))
    return "sibling";          // 同 depth + 同 parentSessionId/Path = sibling
  return undefined;            // 核家庭之外 → 拒绝
}
```

`buildAgentFamilyRoster()` 把 **parent + siblings + children（含各自 status）** 全部列给当前 agent——sibling 的存在、名字、状态对每个 agent 可见。daemon 侧（`daemon-mode.js`）的 target 解析对消息与观察统一走同一守卫：`assertAgentFamilyReach`（parent/siblings/children 之外一律拒绝，错误文案 `"Agent reach is limited to parent, siblings, and children"`）。

### 8.3 Q3：sibling 之间究竟能不能通讯？

- **Prime Agent：能。** `agent_message.send(..., receiver_role='sibling')` 合法，`send("all")` 家庭广播也覆盖 sibling。
- **但那次冲突的 resolve 走的是父，不是 sibling 直连。** 实录消息流（主会话 entry 2352/2357/2358）：
  1. Finisher → 父：报告"Doer 未死" + 自己的计划，并明说"需要你先停掉/删除 m4b-doer-glm52，避免对写。**请指示**"；
  2. 父 → Finisher：`receiver_role='child'` 角色变更指令"**它在写，你只看**"，`deliveryStatus: queued`（steering 投递——busy 中的目标在运行中也能收到）；
  3. Finisher 此后持续 `agent_observe` 盯 Doer，Doer idle 后做只读验收；Doer 全程未被直接打扰。
- 原因：Finisher 正确判断了**生命周期归属**——停/删 Doer 是父的权限（`delete_subagent` 是 parent-owned），冲突裁决权在父。**能力存在，编排走父**。这是权限模型（谁有权裁决）与能力模型（谁可以直达）的区别。

### 8.4 Q4：冲突 resolve 时消息是怎么传的？

三步，全部经父中转（见 8.3）；Finisher 与 Doer 之间没有直接消息，只有 Finisher → Doer 的**单向只读观察**（status + transcript 预览）。这与 Dash 实测的"唯一通路：经共同 parent 中转"表面相同，但 Dash 的中转是**因为没有其他通道**，Prime Agent 的中转是**编排选择**（存在 sibling 直连与观察通道）。

## 9. Prime Agent vs Dash：A2A Messaging Channel 对比表

| 维度 | Prime Agent | Dash（本文 §3–§5 实测 + 上游 continuation.ts） |
|---|---|---|
| 拓扑模型 | **核家庭（nuclear family）**：parent + siblings + direct children 双向；根互为 sibling | **严格树**：只认 `parentSession` 指针 |
| 可达性判定 | `agentFamilyRelationship`（同 parent 边即 sibling） | `target.parentSession == caller.sessionId`（**只能是直接子**） |
| Sibling 可见性 | ✅ 家庭名单显式列出 siblings + status | ❌ 不可见（`list_agents` 只有自己的 descendants） |
| Sibling 消息 | ✅ `receiver_role='sibling'` | ❌ `subagent "<id>" belongs to another parent session` |
| Sibling 观察（设施） | ✅ 预注入 kernel 模块 `agent_observe`：cell 内直接调用 `get_agent` / `recent_messages` / `list_agents`——status + 有界 transcript 预览，只读 | ❌ 无观察设施：cell 内没有任何可调用的观察函数；只能靠非设施旁证（读文件 mtime、自己翻 session 日志文件——按用户定义"不算工具"） |
| 上行 | ✅ 显式消息（双向对等） | ❌ 显式 push 被拒，只有完成回传 |
| 下行 | ✅ 可递归 | ✅ 可递归（实测 A→G） |
| 群发 | ✅ `send("all")` 家庭广播（逐条 receipt） | ❌ |
| 投递语义 | steering delivery：busy 目标运行中可收（`deliveryStatus: queued`）；idle 目标直接进上下文 | 完成回传 + 显式下行（busy 中的投递语义未实测） |
| 身份 | daemon 推导 sender，不可伪造；无 `from` 参数 | 父身份不暴露在 env / list_agents，只在子 session 日志头部 |
| 生命周期 | 父拥有 `delete_subagent`；child 仅在父会话存续期可用 | 父拥有（continuation 同源规则） |
| 观察/消息分权 | 观察只读（无 mutate 命令），与消息分离 | 无观察层 |

**一句话总结**：Dash 实现的是"树上的一条下行边 + 完成回传"的最小树消息；Prime Agent 把可达域从"父子边"扩展成**核家庭**——多出的是 sibling 可达（消息）、sibling 观察（status/transcript 只读）、家庭名单可见性、显式上行与群发。8.1 的 Finisher 事件恰好命中了 Dash 缺失的那一块：在 Dash 运行时上重演同一场景，Finisher 会完全失明——看不到 Doer 的 status、读不到 transcript，冲突的发现大概率迟到到"两个 agent 开始对写同一批文件"之后。

## 10. 对 Dash 的启示（遗留待办候选）

1. **补 sibling 观察（设施口径）**：只读的 status + 最近消息预览（有界），是上面场景的充分条件——即使不开放 sibling 直接消息，观察通道也能让冲突在写入前被发现。实现形态应与 Prime Agent 同级：**预注入 kernel 的 Python 模块**（Dash 侧即 tools.* binding 或 `_dashr_*` 注入 helper），模型 cell 内直接调用；而不是"自己去读 session 日志文件"——后者按用户定义不算工具，只能算碰巧存在的旁证。
2. **补家庭名单可见性**：`list_agents` 至少向每个 agent 暴露同父 sibling 的存在与状态（当前只显示 descendants，父身份还要读自己日志）。
3. **sibling 消息是否开放**是设计取舍：Prime Agent 有直连但编排惯例走父（生命周期在父）。Dash 若只补观察，可保持"消息走父、观察可横"的分权。
4. **上行显式 push**：Prime Agent 双向对等；Dash 只有完成回传，子 agent 无法主动给父发"我需要裁决"类消息（Finisher 事件里那条"请指示"在 Dash 上发不出去）。

---

## 11. Delegation 三层模型：通道与"返回结果"的关系（2026-08-17 追加）

> 用户追问："PA 的 A2A Messaging Channel 是不是独立于 delegation 返回 result 的东西？"——答案：方向对了一半，有一个关键修正：**结果本身恰恰就是骑在这个通道上传的**。

### 11.1 Prime Agent 的三层结构

```
① 委派准入（spawn/admission）
   rlm('task', name=...) → 立即返回 handle（rlm_child_id / session_dir / model）
   ← 独立于通道，纯簿记。rlm() 永远不返回子 agent 的答案

② 结果传输
   子 agent 的最终答复 = await agent_message.send(message, receiver_role='parent')
   ← 结果就是一条父向消息，骑在 messaging channel 上（"写文件给父读"是旁路）

③ 存活/完成状态面
   status（idle/running）、repliedSinceTask、"completed without sending a reply" 通知、
   agent_observe 的 status + transcript 预览
   ← 独立于通道，是监测机制，不是结果传输
```

- 说"通道独立于 delegation 的返回"**对一半**：`rlm()` 的准入返回与通道无关（只给 handle、立刻返回、绝不等结果）。
- 但 delegation 的 **result 没有独立管道**：子 agent 的最终答案就是一条父向消息。Finisher 事件里那条 "[from child:m4b-finisher-glm52] …请指示" 与它的正式交付报告形态完全相同——**结果交付只是通道的一种用途，不是另一套机制**。

### 11.2 两实现的对照（DSH 实测 §4.1 的"不对称"之根源）

| | 结果传输 | 显式消息 |
|---|---|---|
| **Dash** | 完成回传：内置 delegation 机制，final message 自动回根 | `send_message` 显式下行——**两套东西** |
| **Prime Agent** | 子 agent 显式 `agent_message.send(receiver_role='parent')`——**结果也是一条消息** | 同一通道，双向 + sibling + 群发——**一套东西** |

Dash 把"交结果"做成了 delegation 的内置特权路径（上行 push 被拒无妨，结果有专线）；Prime Agent 把"交结果"统一成了消息（上行 push 天然存在，因为结果本身就是上行消息的一种）。

### 11.3 一个由此产生的行为差异

Finisher 事件里，父 agent 被 "completed without sending a reply" 误导——因为 Prime Agent 里**"完成"与"回传结果"是解耦的**：③ 层的完成状态通知先到（子 agent 因 interrupt 被误报 completed），② 层的结果消息还没发。Dash 里这两件事绑在一起（完成回传 = 结果到达），反而没有这个坑。**两解耦各有代价**：解耦 = 结果通道可复用（sibling 消息、steering、角色变更都走同一设施），但完成≠有结果；绑定 = 语义简单，但通道只剩"显式下行"这一条窄边。
