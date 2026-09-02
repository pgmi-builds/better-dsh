# Dash RLM vs Prime Agent：System Prompt 与 Toolset Catalog 对比

> 整理日期（UTC）：2026-08-18T06:11:40Z
> 目的：把两边「LLM 实际看到的文本」摆在一起，供拍板调整方向。
> 口径：**System Prompt** = LLM 收到的关于「界面/范式」的说明文本；**Toolset Catalog** = LLM 运行时能看到的工具描述文本（≠ schema，schema 是代码级合约，catalog 是描述文本）。

---

## 1. System Prompt 对比

### 1.1 Dash 现有（RLM 相关的全部文本，共三段）

**① 引言（唯一一句「范式」说明）**

> You are a DASHR agent powered by the deepseek-v4-pro model. Your working directory is /home/u1/workspaces/dashr. You have a persistent Python kernel as your **primary** tool interface: each `run_cell` call executes one Python program on it, and everything you import, define, or assign in one cell stays available in the next. The full tool catalog is callable from inside the kernel as `tools.<name>(...)` bindings. Prefer the kernel for multi-step work.

**② `run_cell` 工具的 description（model 直接看到的唯一工具）**

> Execute one Python cell on the persistent kernel. Takes two required arguments: `code`, the cell (top-level `await` and `return` work; variables, imports, and definitions from earlier cells are still alive), and `description`, a short summary of what the cell does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return comes back — curate it.

**③ `## Writing cells for run_cell`（run_cell 用法 prose）**

> `run_cell` takes two required arguments: `code` — one Python cell — and `description` … The cell runs on a PERSISTENT IPython kernel: variables, imports, and definitions created in any earlier `run_cell` call of this session are still alive in later ones … treat the kernel's namespace as your working memory. Top-level `await` and `return` both work. At run time exactly two of the names declared below are bound: `tools` and `ToolCallError`. Everything else is a STATIC STUB … Inside a cell:
> - Call tools as `await tools.name(args)` …
> - A FAILED tool call raises `ToolCallError` …
> - Independent calls may overlap under `asyncio.gather` …
> - Emit the answer with `print(...)` and/or a top-level `return <value>`. … ONLY what you print and the returned value come back …

> 小结：三段是「接口如何使用」的说明（工具化口吻），**没有一句「这是唯一界面 / 你是用代码解决问题的 agent / code-first 范式」**，也没有示例。

### 1.2 Prime Agent（`buildRlmPrompt` 渲染，root 会话）

**开篇（范式，3 句）**

> You are a general purpose agent that uses code to solve tasks.
> You solve tasks by breaking down problems into sub-tasks, writing and executing code, observing results, and iterating one step at a time.
> When you are done, stop calling tools and state your final answer.
>
> Working directory: <cwd>
> Conversation log: <messagesPath>
> Recursive agent depth: 0
> Pre-installed Python packages: …

**`IPYTHON_CONTROL_PROMPT`（整段，核心）**

> IPython is the agent's long-lived notebook: a persistent control environment for reasoning, context management, state, tool orchestration, and recursive subcalls. Use it to keep intermediate variables, inspect and transform outputs, write small helper functions, and preserve useful state across turns or compaction.
>
> Do not assume IPython is the native runtime of the external thing being investigated. … Evaluate external systems through their own interface, then use IPython to coordinate the process and analyze what comes back.
>
> When running shell commands from IPython, use `%%bash` cells. If you use `%%bash`, it must be the first line of the code cell … Avoid `!cmd` shell escapes …
>
> Important: do not install dependencies into the IPython kernel just to make an external project import or run there. … run it through that project's own environment …
>
> Use Python for reading, searching, and editing files … Always assign read/search results to named variables …
>
> Each `%%bash` cell runs in a throw-away subshell … use `%cd <dir>` … or `os.environ['VAR'] = '...'` …
>
> Python state in the kernel, by contrast, persists across cells … Tool calls are themselves Python `await` expressions, so their return values can be bound to variables and composed into program logic …
>
> Continual harness state is available as `rlm.harness` and `rlm.get_harness_state()` …
>
> RLM-native call contract: installed Python skills are pre-imported modules. Read the matching SKILL.md and call its documented function, such as `await <skill_import>.<function>(...)` … **Do not invent non-native wrappers such as `call_skill(...)` or `run_subagent(...)`.**

**递归 + skill + 消息（节选）**

> A callable `rlm` is already in your global namespace. `await rlm('sub-task')` spawns a child and returns immediately after task admission …
> Children reply explicitly with `await agent_message.send(message, receiver_role='parent')` …
> Agent messaging is restricted to your parent, siblings, and direct children …

> 小结：Prime Agent 是**范式驱动**——先立「code-first」人设，再用一整段 prose 讲清 IPython 是唯一长驻环境、`%%bash`、状态持久化、`await` 工具调用，并给示例 + 明令「不要自造非原生 wrapper」。

### 1.3 差异小结

| 维度 | Dash 现有 | Prime Agent |
|---|---|---|
| 范式定位 | 无（只说 kernel 是 *primary* interface） | 明确「code-first agent」 |
| 「唯一界面」强调 | 无 | IPython 是长驻控制环境，反复强调 |
| 示例 | 无 | 有（`await rlm(...)` / `agent_message.send(...)` / `edit(...)`） |
| 反模式告诫 | 无 | 「Do not invent non-native wrappers」 |
| 口吻 | 工具化（接口说明） | 范式化（人设 + 工作法） |

---

## 2. Toolset Catalog 对比

### 2.1 DASH 原生（约 29 个工具，DSH 原生语义）

模型在 system prompt 的 `The available tools:`（即 `tools:dashr-sdk` 段）里看到的是：把 DSH registry 的原生工具**渲染成 Python SDK**（`class Tools(Protocol)` + 每个工具的 TypedDict 参数 + docstring 描述）。工具名与描述是 **DSH 原生词汇**，未为 kernel 范式重写：

- 文件：`read` `write` `edit` `glob` `grep` `read_image`
- Shell/任务：`bash` `job_output` `job_list` `job_kill`
- Agent 编排：`subagent` `subagent_fork` `send_message` `list_agents` `interrupt_agent` `workflow` `ralph`
- 目标/记忆：`create_goal` `get_goal` `update_goal` `memory_add` `memory_search` `memory_list` `memory_flush`
- 其他：`todo_write` `web_search` `ask_user_question` `skill` `exit_plan_mode`

关键点：**这 29 个工具里，模型能直接调用的只有 `run_cell` 一个**（`system-prompt/assemble` 把 `assembly.tools` filter 到只剩 `run_cell`；直接调其他工具会被 guard 拒绝并提示「only run_cell is callable directly」）。于是出现「catalog 列了 29 个工具 → 实际只能调 run_cell」的错位。

### 2.2 Prime Agent（1 个 core tool + 13 个 skills）

- **core tool 只有 `ipython` 一个**（`allToolNames = Set(["ipython"])`）：
  > Python scratchpad code or `%%bash` shell cells to execute in the agent kernel. Use the target project's own environment for project imports, tests, scripts, CLIs, and dependency checks instead of direct kernel imports.

- **skills（在 cell 内以 `await <skill>.<fn>(...)` 调用）**，每个 skill 的 SKILL.md description 就是它的 catalog 文本：

| skill | description（首行） |
|---|---|
| agent-message | Message an agent's parent, siblings, or direct children through the daemon |
| agent-observe | Read-only observation of an agent's parent, siblings, and direct children |
| edit | Replace an exact, unique string in an existing file |
| attach-image | Load an on-disk image into the model's context |
| compact | Check context usage and compact the conversation from IPython |
| goal | Manage the persistent thread goal from IPython |
| refine | Trigger continual harness refinement from IPython |
| websearch | Search Google via the Serper API |
| rlm-heartbeat | Manage agent-owned RLM heartbeats from IPython |
| skill-creator | Create, validate, and install Prime Agent skills |
| linear / notion / prime-intellect | MCP/CLI 集成（外部服务） |

关键点：catalog 里**没有把「bash/read/write/edit/glob/grep」等底层能力各自做成独立原生工具**——shell 走 `%%bash`、文件编辑走 `edit` skill、读取/搜索走「用 Python」的 prose 指导。工具集是**为 kernel 范式量身定做的**，且每个 skill 的 description 都写明「from IPython」。

### 2.3 差异小结

| 维度 | DASH 原生 | Prime Agent |
|---|---|---|
| 工具数量 | ~29 个原生工具 | 1 core（ipython）+ ~13 skills |
| 工具词汇来源 | DSH 原生（bash/read/write/subagent/…） | 为 kernel 范式重写（ipython + skills） |
| 呈现位置 | 塞在 system prompt 的 Python SDK 文本块 | tool schema 在 prompt body 之外；skill 用 SKILL.md |
| 与「唯一界面」的一致性 | 不一致（列 29 个却只能调 run_cell） | 一致（core=ipython，其余都是 cell 内调用） |

---

## 3. 附：源码位置

- Dash 插件：`dashr/dashr/src/index.ts`（`run_cell` 定义 `RUN_CELL_DESCRIPTION`、`tools:dashr-sdk` section、schema collapse、guard）
- Dash SDK 渲染：`dashr/dashr/src/py-sdk.ts`（`renderToolsSdkPy`）
- Prime Agent prompt：`upstream/prime-agent/packages/coding-agent/src/core/prompts/rlm.ts`（`buildRlmPrompt`、`IPYTHON_CONTROL_PROMPT`）
- Prime Agent tools：`upstream/prime-agent/packages/coding-agent/src/core/tools/index.ts`（`allToolNames`）
- Prime Agent skills：`upstream/prime-agent/packages/coding-agent/skills/*/SKILL.md`
