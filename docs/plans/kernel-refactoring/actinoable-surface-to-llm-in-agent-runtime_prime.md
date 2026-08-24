# Self Survey of `dsh` (DeepSeek Harness Agent) and Prime Agent - Actionable Surface to LLM in Agent runtime


- Actionables: tools, toolset(s), skills, bash, executable code scripts (e.g. python ...)
- Surface to LLM: the text/prompts exposed to LLM during agent runtime




## Prime Agent(第一人称:Prime Agent 运行时自述)

### 地基 — 我"调用工具"的 wire 形态(function calling)

- 和 dsh 是同一个 function-calling JSON:`Function: { name, arguments }` —— 只有两个 element,`name` 平级、无 `tools.` 之类前缀命名空间。
- **但我的平级工具枚举清单里只有一个名字:`ipython`。** 所以 wire 层固定是:`name` 只有 `"ipython"` 一种取值;`arguments` 只有一个必填键 `code`(字符串)。没有别的字段。

- 我发出的真实 wire 原文(从我自己这个 session 的日志里抄的,一字未改):

```json
{"type": "toolCall", "id": "call_00_wf7zeFy6KRIXEaeC5zZS3896",
 "name": "ipython",
 "arguments": {"code": "%%bash\nls -la /home/u1/workspaces/dashr/dev/kernel-refactoring/"}}
```

- 客户端拿 `name: "ipython"` 定位唯一执行器,把 `arguments.code` 整段交给**常驻 IPython kernel** 执行,把我 print / 显示出来的 stdout 文本塞回 toolResult(原文照抄,stderr 与 kernel 状态另列):

```json
{"role": "toolResult", "toolCallId": "call_00_wf7zeFy6KRIXEaeC5zZS3896",
 "toolName": "ipython",
 "content": [{"type": "text", "text": "<cell 的 stdout>"}],
 "details": {"durationMs": 472, "status": "ok", "stdout": "...", "stderr": "", "kernelRestarted": false},
 "isError": false}
```

- **`await` 不在 wire 层,在 `code` 层**——`await` 是 Python 语法,发生在我写进 `arguments.code` 的那段程序里面。完整的语法链就四步:

  1. 我要做一个动作 → 想好一段 **Python 程序**(一句话也是一个程序);
  2. 把它写进 `arguments.code`(可以是 `await 技能函数(...)`、`%%bash` cell、`rlm(...)`、或任意 Python);
  3. 发出唯一形态的 JSON:`Function: { name: "ipython", arguments: { code: "<那个程序>" } }`;
  4. kernel 跑完,stdout 原样作为 toolResult 回到我的上下文,我再决定下一轮。

- wire 示例(全部是同一个工具名,差别只在 `code` 里):

```json
// 例子1:调用联网技能 —— await 发生在 code 里
Function: { name: "ipython", arguments: {"code": "await websearch('prime agent')"} }

// 例子2:shell —— %%bash 必须是 code 的第一行
Function: { name: "ipython", arguments: {"code": "%%bash\nls -la"} }

// 例子3:子代理 admission —— 返回的是句柄,不是答案
Function: { name: "ipython", arguments: {"code": "h = await rlm('sub-task', name='worker')"} }
```

### Actionables — 全部经 `ipython` 的 `code` 触达(没有第二层工具枚举)

wire 层是平的、只有一个名字;dsh 那 29 个平级工具对应到我这边的全部"动作清单",都是我写进 `code` 里的 Python 对象:

- **内核全局预导入的 9 个 python skill 模块**,调用形态统一是 `await <模块>.<函数>(...)`,返回值可绑定变量、可组合:
  `agent_message`(send / list_agents)、`agent_observe`、`attach_image`、`compact`、`edit`、`goal`、`refine`(run)、`rlm_heartbeat`、`websearch`
- **内核全局 `rlm`**:`await rlm('sub-task')`(非阻塞 admission,返回 rlm_child_id/name/session_dir/model,永不返回答案)、`rlm.list_subagents()`、`rlm.delete_subagent()`、`rlm.find_models()`、`rlm.get_harness_state()`、`rlm.harness.*`(memory / prompt_note / skill / subagent-spec 四类 CRUD,默认 session 本地,`global_=True` 才跨会话)
- **`%%bash` cell**(必须是 `code` 的第一行)——shell、项目命令、CLI 全走这里;**没有独立的 bash 工具名**
- **任意 Python**:stdlib 读/写/搜索文件、编排进程、`uv pip install` 装包、`%cd` / `os.environ` 管内核状态
- **每个 skill 的 shell CLI**:`<skill> ...`(在 %%bash 里跑)
- **markdown skills**(项目 `.agents/skills` 向上收集 + 用户级 + 捆绑 dist):不是 callable 绑定,用 ipython 读它们的 SKILL.md 学 API
- **没有的东西**:read / write / glob / grep / todo_write / subagent / send_message……这些名字在我的 wire 枚举里**不存在**;对应能力 = code 里的 Python 或 skill 函数。这条不是靠运行时报错兜底,是 schema 面根本不暴露。

### Surface to LLM — 我暴露给模型的文本

- 系统提示正文(每次请求动态组装,顺序固定):code-first 人设开篇 → IPYTHON_CONTROL_PROMPT(长驻 notebook、%%bash 纪律、状态持久、await 调用、"do not invent non-native wrappers" 等反模式明令)→ RLM-native call contract → delegation doctrine(子代理 admission/消息/观察拓扑)→ continual harness 状态菜单(prompt/memory/skill/subagent 计数)→ 项目 AGENTS.md 链(Project Context)→ 会话变量:cwd、conversation log 路径、recursive agent depth、预装 Python 包清单
- 工具 schema:只有 `ipython` 一个(`name` + `parameters:{code: string}`,description 写在 schema 里,正文不重复列工具目录)
- skills catalog:`<available_skills>` XML 块拼在正文里(当前 session 26 条:name / type / python_import / description / location,措辞是 kernel 形态)
- SKILL.md 本体:不注入;我用 ipython 读文件学 API
- 对话历史 + 压缩(compact skill;单条 cell 输出截断上限默认 2000 行 / 50KB)
- kernel 事件通知:`<ipython_kernel_reset>` 标记、interrupted cell 的 wait/kill 选择提示


### 组合性 — 预绑定的名字是「Python 类型化的内置工具」,可当一等对象组合(本 session 已实测)

- 术语(建议 Dash prompt 也采用):**Python 类型化的内置工具(typed Python built-in tools)**。它们不是 wire 层的 function call,而是 kernel 全局命名空间里的 typed Python 对象:
  - `edit` = 可调用模块,成员 `run(path, old_str, new_str) -> str` 是 async 函数,抛 `FileNotFoundError` / `ValueError`
  - `rlm` = 可调用模块(`rlm(...)` 即 spawn),成员 run / find_models / list_subagents / delete_subagent / harness / get_harness_state
  - 实现层:`edit` 是进程内 async Python 函数(`Path.read_text/write_text` 直接 syscall),零 shell 零 subprocess
- 实测组合模式(全部真实执行):

| 组合模式 | 写法 | 结果 |
|---|---|---|
| 条件 | `if "x" in Path(p).read_text(): await edit(...)` | ✅ |
| 异常 | `except ValueError` / `except FileNotFoundError` | ✅ 类型化异常 |
| 重试 | for + try/except,失败换更宽 old_str | ✅ |
| 批量 / 并行 | for 收集返回值 / `asyncio.gather(*[edit(...)])` | ✅ |
| 对象化 | 存 dict、当参数传、自写 `safe_edit()` wrapper(加重试/降级策略) | ✅ |

- 对照:平级 function call(DSH/Hermes)里组合只能发生在模型脑内、跨多轮往返、非确定;这里组合发生在确定性 Python 代码里,一个 cell 一轮往返。
- **反面证据(诚实记录)**:本 session 的 system prompt 关于组合只有一句 "composed into program logic just like any other call",无例子、未说明是 typed 对象 → 本 session 模型未自发组合过一次(写文件全用裸 Python)。结论:**不写清楚,模型就不会。**(此为 prompt 缺口,补丁见下节)

### 状态管理 — cell 化之后的「可回查状态机」(本 session 已实测)

三种后台句柄,全部跨 cell 存活于 kernel 命名空间、可回查、可控制:

| 句柄 | 创建 | 回查状态 | 控制 |
|---|---|---|---|
| asyncio Task | `t = asyncio.create_task(coro())` | `t.done()` / `t.result()` | `t.cancel()` |
| 子进程(Hermes job/PID 等价物) | `p = subprocess.Popen(...)` | `p.poll()` / `p.pid` | `p.kill()` / `p.wait()` |
| rlm 子代理 | `h = await rlm('sub-task')` | `rlm.list_subagents()` → `status` 字段 | `rlm.delete_subagent(h)` |

- `await` 是"等"的语法;`asyncio.create_task` / Popen 是"不等"的句柄 —— 本 session 的 prompt 只教了 await,没教 async 句柄,这是第二个 prompt 缺口。
- rlm 实测闭环:admission 立即返回 `RLMSpawnHandle(rlm_child_id, session_dir, model)` → `list_subagents()` 查 `status='completed'` → `delete_subagent` 回收 → 子代理回复经 agent_message **事件驱动送达**(实测:delete 之后消息仍到达,投递队列与句柄注册表解耦)。
- 长命令(`%%bash` curl 等):包进 create_task/Popen,句柄落 kernel 命名空间,下一 cell 回查;kernel 死则句柄丢(进程还活,句柄没了)。

### 建议 prompt 补丁(Prime upstream `IPYTHON_CONTROL_PROMPT` 与 Dash preset 共用)

> Pre-imported skill modules and the global `rlm` are typed Python objects, not wire-level tools: each exposes documented async functions and raises typed exceptions (e.g. `edit` raises `FileNotFoundError`/`ValueError`). Treat them as first-class values: compose them with conditionals, `try/except` on their typed errors, loops, `asyncio.gather` for parallelism, custom wrapper functions for retry/degradation policies, or storage in data structures. For background work, keep pollable handles in the kernel namespace: `asyncio.create_task` → `done()/result()/cancel()`; `subprocess.Popen` → `pid/poll()/kill()`; `rlm()` admission → `rlm.list_subagents()/delete_subagent()`, with results arriving asynchronously via `agent_message`. Prefer composing multiple tool calls inside one cell over issuing them one call per cell.
