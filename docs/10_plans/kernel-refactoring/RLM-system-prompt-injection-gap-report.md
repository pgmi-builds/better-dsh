# Dash RLM 插件「system prompt 注入缺口」实测报告

> 实测日期（UTC）：2026-08-18T06:02:38Z
> 观测主体：Dash Agent 运行时自身（`agent-preset/selected = rlm-mode`）
> 对照对象：上游 Prime Agent（`upstream/prime-agent` + 已安装实例 `~/.prime/agent`）
> 方式：读自身 session 日志 + 读上游源码，所有结论均来自真实文件与真实工具返回。
>
> 版本说明：v2 —— 新增「三大缺口」明确清单；A2A 消息缺口按用户判定降级为「非致命，暂缓」。

---

## 1. 问题缘起

用户观察到：本 agent 会话刚开始时，对 `run_cell`（Python kernel cell）机制显得陌生，第一反应是把 `bash` / `todo_write` / `list_agents` 当普通函数工具直接调用，而不是放进 `run_cell` 执行。

核心判断：**插件已经把「工具调用界面」和「互动界面」全部归一化成了一个 `run_cell`，却没有提供足够的上下文告诉运行时该如何使用。** 这才是致命问题（相较之下，A2A 消息缺口顶多像 one-shot calling，非致命）。

---

## 2. 观测一：我自身的行为（两次直接调用工具失败）

会话历史里，本 agent 至少有两次把工具当"原生函数调用"直接发起，均被运行时拒绝：

1. **第 1 轮**：直接调用 `todo_write` / `bash` / `list_agents` → 报错
   `Error: only run_cell is callable directly — call <tool> from inside a run_cell program instead`
2. **本轮（形成本报告时）**：再次直接调用 `todo_write` → 同样报错。

结论：模型默认心智是"工具 = 原生函数调用"，而运行时唯一的原生工具是 `run_cell`。二者不一致，且没有 system prompt 在纠偏。

---

## 3. 观测二：Dash 侧 system prompt 的缺口

### 3.1 system prompt 从哪注入

本 session 日志 `session-d11e193f-....jsonl.zstd` 首部：

- `type=agent-preset/selected` → `{"agentPreset": "rlm-mode"}`
- `type=request/header` → `data.header.system` 为完整 system prompt

### 3.2 规模与结构

- system prompt 全长 **45,578 字符 / 684 行**。
- 结构（字符偏移）：
  - `0` — "You are an AI agent powered by DeepSeek Harness"（DSH 基础层）
  - `1393` — "You are a DASHR agent powered by the deepseek-v4-pro model"（DASHR/RLM 层）
  - `8817` — `## Writing cells for run_cell`（run_cell 用法说明）
  - `10748` — `The available tools:`（约 20KB 的 Python 代码块，`class Tools(Protocol)` + 30 个工具 TypedDict）
  - `29589` — `class Tools(Protocol)`
  - `29918` — `async def bash`（第一个工具方法）

### 3.3 缺失的指令（检索证据）

全文关键词检索，以下纠偏型指令 **全部 0 命中**：

| 检索短语 | 命中 |
|---|---|
| `run_cell is the only` | 0 |
| `cannot call ... directly` | 0 |
| `callable directly` | 0 |
| `must be called from inside` | 0 |
| `do not call` | 0 |
| `must go inside` | 0 |

唯一接近的一句（`1393` 处）：

> "You have a persistent Python kernel as your **primary** tool interface … The full tool catalog is callable from inside the kernel as `tools.<name>(...)` bindings."

措辞是 **"primary"（主要）而非 "only"（唯一）**，且紧接着用 `The available tools:` 把 30 个工具列得像**可直接调用的原生函数工具**，与"只有 run_cell 能直接调"的运行时事实相矛盾。

---

## 4. 三大缺口（明确清单）

### 缺口 1：框架描述的缺失 —— 缺少「唯一界面」的框架定位

- **现状**：Dash 插件只有极简短的一句提醒（`persistent Python kernel as your primary tool interface`），其余工具仍沿用 DSH（DeepSeek Harness）原生 schema 描述。整个 prompt 没有把「这是一个 Python kernel、且是**唯一**界面」讲清楚，也没有给出清晰的示例。
- **对照 Prime Agent**：`buildRlmPrompt()` 明确 `You are a general purpose agent that uses code to solve tasks`，并用一整段 `IPYTHON_CONTROL_PROMPT` 讲清 IPython 是 long-lived notebook、`%%bash` cell、状态跨 cell 持久化、工具调用是 cell 内的 `await` 表达式，同时给出具体示例（`await rlm('sub-task')`、`await agent_message.send(...)`、`await edit(...)`）。
- **建议**：明确指出「这是 Python kernel，作为唯一界面」，并给出清晰示例。

### 缺口 2：工具 schema 的呈现 —— 工具目录 vs 范式

- **现状**：Dash 的 system prompt 用 `The available tools:` 列了一份约 20KB 的 `Tools(Protocol)`，30 个工具以 DSH 原生 schema 呈现（TypedDict 参数 + `async def` 方法），读起来像可直接调用的原生函数工具——与实际「唯一工具是 run_cell」的事实冲突。
- **对照 Prime Agent**：整个框架按 Python kernel 编写，tool calling 的 catalog 按「在 cell 内直接可用的 schema」呈现（`await <module>.<fn>(...)` 形态），且工具 schema 放在 prompt body 之外（`system-prompt.ts` 第 12 行注释：*Tool schemas carry tool descriptions outside the prompt body*）。
- **待确认**：是否也应采用 Prime Agent 的标准——工具目录按「cell 内可直接调用」的形态呈现，而非 DSH 原生函数 schema。

### 缺口 3：原生 tool schema 的转译 —— 无法硬编码归一化

- **现实约束**：DASH 核心会按自身机制加载工具，从而产生**原生可执行的 schema**。这些工具描述是语义层 + 文本层的，很难做硬编码的转译或归一化。
- **倾向方案（用户）**：不做插件侧硬编码转译，而是在 System Prompt 中强调——
  1. 你现在面对的是**唯一界面**；
  2. 工具**已经过转译处理**；
  3. 如果看到原生工具的 schema，运行时需**自行将其转化为 run_cell 可接受的格式**；
  4. **只要格式不差太远，放进 run_cell 里执行即可**。

---

## 5. 对比：上游 Prime Agent 怎么做

### 5.1 system prompt 是"范式驱动"的散文，而非"工具目录"

`upstream/prime-agent/packages/coding-agent/src/core/prompts/rlm.ts` 的 `buildRlmPrompt()` 开篇：

> "You are a general purpose agent that uses code to solve tasks."
> "You solve tasks by breaking down problems into sub-tasks, writing and executing code, observing results, and iterating one step at a time."
> "When you are done, stop calling tools and state your final answer."

随后用一长段 `IPYTHON_CONTROL_PROMPT` 明确 IPython 是"long-lived notebook / persistent control environment"，并显式约定：

- shell 用 `%%bash` cell（必须是 cell 第一行）；
- Python 状态跨 cell 持久化；工具调用是 cell 里的 `await` 表达式，返回值可绑定变量；
- "**Do not invent non-native wrappers such as `call_skill(...)` or `run_subagent(...)`**"。

### 5.2 工具 schema 与 prompt 分离

`core/system-prompt.ts` 第 12 行注释：

> "Active tools. **Tool schemas carry tool descriptions outside the prompt body.**"

工具能力描述放在 function-calling 的 schema 里，**不在 prompt 正文里重复列一份工具目录**；prompt 正文只讲范式。

### 5.3 system prompt 不落盘、按请求动态构建

Prime Agent 的 session 文件（`~/.prime/agent/sessions/*.jsonl`）里**没有 system message**，只存 `user` / `assistant` / `toolResult`；system prompt 由 `buildSystemPrompt()` 每次请求动态拼装。反观 Dash 是把 45KB system prompt 固化进 `request/header`。

---

## 6. A2A 消息拓扑（非致命，暂缓）

> 用户判定：A2A 消息缺口不是致命的，顶多像 one-shot calling。本节仅存档，不阻塞主线。

1. 上游明确写了消息拓扑（`rlm.ts`）：
   > "Agent messaging is restricted to your **parent, siblings, and direct children**; roots are siblings, and deeper communication relays through the intermediate child."
2. 上游 `agent_message` 支持三向（`skills/agent-message/SKILL.md`）：`receiver_role="parent" | "sibling" | "child"`。
3. Dash 实测更严格：`send_message` 只允许「父 → 直接子」，sibling/向上/跨层被拒（`subagent "<id>" belongs to another parent session`）。

---

## 7. 结论与建议

1. **致命问题确认**：插件把工具调用界面与互动界面归一化成单一 `run_cell`，却未注入足够上下文。模型开局两次直接调用工具失败即是证据。
2. **三大缺口**对应处理：
   - **框架描述**：明确「Python kernel = 唯一界面」+ 清晰示例；
   - **工具 schema 呈现**：待确认是否改按「cell 内可直接调用」形态呈现（对齐 Prime Agent）；
   - **原生 schema 转译**：不硬编码转译，在 System Prompt 中强调「唯一界面 + 已转译 + 运行时自行把原生 schema 转成 run_cell 格式，格式接近即可放进 cell 执行」。
3. **A2A 消息**：非致命，暂缓。
4. **建议注入的最小补丁**（置于 system prompt 靠前）：
   - 「本 session 运行在 RLM 模式：`run_cell` 是**唯一**能直接调用的工具。」
   - 「不要直接调用 `bash`/`write`/`read`/`edit`/`glob`/`grep`/`todo_write`/`list_agents`/`send_message`/`subagent` 等——它们会报 `only run_cell is callable directly`。一律写成 `await tools.<name>(...)` 放进 cell。」
   - 「你是用代码解决问题的 agent：工具调用 = cell 内的 `await` 表达式，返回值可绑定变量、可组合。」
   - 「（转译）若看到原生工具 schema，请自行转化为 run_cell 可接受的格式；格式接近即可放入 cell 执行。」

---

## 8. 证据清单

- 自身 session 日志：`/home/u1/.dsh/sessions/--home-u1-workspaces-dashr--/session-d11e193f-a813-4200-96b1-0465ae8e8063/session.jsonl.zstd`（`request/header.header.system`，45,578 字符）
- 上游 prompt：`upstream/prime-agent/packages/coding-agent/src/core/prompts/rlm.ts`（`buildRlmPrompt`、`IPYTHON_CONTROL_PROMPT`、`buildChildAgentDoctrine`）
- 上游装配：`upstream/prime-agent/packages/coding-agent/src/core/system-prompt.ts`（第 12 行注释：tool schemas 在 prompt body 之外）
- 上游消息 skill：`upstream/prime-agent/packages/coding-agent/skills/agent-message/SKILL.md`
- Prime Agent 实例：`~/.prime/agent/sessions/*.jsonl`（无 system message，仅 user/assistant/toolResult）
