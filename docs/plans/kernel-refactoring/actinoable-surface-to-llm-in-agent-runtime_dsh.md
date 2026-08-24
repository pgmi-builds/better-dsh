# Self Survey of `dsh` (DeepSeek Harness Agent) and Prime Agent - Actionable Surface to LLM in Agent runtime


- Actionables: tools, toolset(s), skills, bash, executable code scripts (e.g. python ...)
- Surface to LLM: the text/prompts exposed to LLM during agent runtime





## `dsh` Native

### 地基 — 我"调用工具"的 wire 形态（function calling）

- 我要执行动作时，模型输出一个 **JSON function**，里面只有两个 element：
  - `name` —— 我暴露的工具枚举清单里的某个工具名（**平级、flat**，没有 `tools.` 之类的前缀命名空间）
  - `arguments` —— 这个工具自己声明的 tool-call 参数 schema 的 JSON 对象（键值对）
- 客户端拿到这个 JSON，用 `name` 定位工具、用 `arguments` 做校验，然后硬编码执行。**除此之外没有别的字段。**

示例 —— `Function: { name, arguments }`，直接写字段值：

1. 网络请求：`Function: { name: "bash", arguments: {"command": "curl -s http://example.com/api"} }`
2. 代码执行（脚本同样经 `bash` 跑）：`Function: { name: "bash", arguments: {"command": "python3 /path/to/script.py"} }`

### Actionables — 平级工具枚举清单（29 个，全同级，无前缀）

分类只是归类，运行时它们全在同一个 flat 清单里：

- shell / 后台任务：`bash` `job_output` `job_list` `job_kill`
- 文件系统：`read` `write` `edit` `glob` `grep` `read_image`
- 委派与编排：`subagent` `subagent_fork` `send_message` `list_agents` `interrupt_agent` `workflow` `ralph`
- goal：`create_goal` `get_goal` `update_goal`
- memory：`memory_add` `memory_search` `memory_list` `memory_flush`
- 其他：`todo_write` `web_search` `ask_user_question` `skill` `exit_plan_mode`

- `skill` 就是上面清单里的一个平级工具：`arguments.name` 传技能名，把 SKILL.md 指令文本注入上下文（不是独立命名空间）。
- 可执行代码脚本：走 `bash`（一次性子进程，python / node / shell / CLI 皆可）。

### Surface to LLM — 我暴露给模型的文本

- 系统提示（每 step 组装，排序分段）：harness identity → persona → 各工具包的 cross-call 指引 → plan-mode 段（仅计划模式）→ 变量 `{{model}}` `{{cwd}}`
- 工具 schema：上面 29 个平级工具各自的 JSON schema（`name` + `parameters`），模型可见子集，按配置或字典序排列
- skills catalog：`available_skills` 块（技能名 + 一句话摘要）
- 运行时上下文快照（sourced user-role 消息）：沙箱策略、审批策略、workspace、时间、委派范围
- AGENTS.md 指令链：`~/.dsh/AGENTS.md` + 项目 `AGENTS.md` + 嵌套作用域，以 `<system-reminder>` 注入
- memory（Corti）召回：每次回复前注入
- 对话历史 + 压缩（tool-result pruner：threshold 8192 / head 4096 / tail 1024 字符）



