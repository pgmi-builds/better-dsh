# Skills catalog snapshot — prompt-text channel(非 functions 通道)

- **采集**: 2026-08-27 10:15 HKT,与 `functions.json` 同会话同批次
- **通道**: 本目录以 system-reminder 注入的 prompt 文本到达模型,**不在** `<functions>` 声明内;执行经 `skill` 工具(该工具在 functions.json 中,仅 1 个 `name` 参数)
- **所见即所录**: 逐字转写,包括 `a2a-communication` 摘要在 "(3) Priorities — co..." 处的截断——目录渲染对超长摘要存在长度截断,这是文本通道自身的呈现预算,如实保留

---

A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>
- `a2a-communication`: The sole entry point for agent-to-agent communication. Talking to another agent is session-based: open a NEW session (omit the session id → auto-new) or RESUME an existing one (look up the agent's storage → session id → resume). Every call reduces to four metadata dimensions about the callee: (1) Invocation — the interface (CLI / HTTP / SSH / ACP) plus its blocking prerequisites (auth, network reachability); (2) Resumability — whether it can hold a multi-turn conversation; (3) Priorities — co...
- `diagram-design`: Create branded architecture, IT current-state, flowchart, sequence, state machine, ER/data model, timeline, swimlane, quadrant, radar/spider, loop/flywheel, nested, tree, org chart, layer stack, Venn, pyramid/funnel, bar, line, Gantt and scatter charts, high-level, process, medallion, data flow, DP integration, or DP security matrix diagrams as standalone HTML/SVG/PNG. Redraw .drawio/.drawio.png/.drawio.svg or Mermaid .mmd sources at a chosen size/detail; onboard brand tokens from a website; ...
- `domain-modeling`: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editing an ADR.
- `gemini-deep-research`: Invoke Gemini Deep Research via Google's Interactions API. Requires an HTTP forward proxy to bypass geo-fencing. Use when the user asks to run Gemini Deep Research, use Google's Interactions API, or conduct automated web research through Gemini.
- `grilling`: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
- `herdr`: Control Herdr, a terminal multiplexer for coding agents. Use only when the user explicitly mentions Herdr or asks to use Herdr to inspect or control panes, tabs, workspaces, commands, or another agent. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work. Requires HERDR_ENV=1.
- `markitdown`: Convert heterogeneous documents and selected URIs to Markdown with Microsoft MarkItDown for text analysis, search, and LLM/RAG ingestion. Covers safe local conversion, streams, Office/PDF/data formats, batch workflows, plugins, vision OCR, Azure extraction, and the official MCP server.
</available_skills>

If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until they have been loaded.

A user may also invoke a skill directly; their `<skill_content>` block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.

---

## 观察备注

1. **双通道结构**: 目录(名字+摘要)= prompt 文本;正文 = `skill` 工具执行后以 `<skill_content>` 注入。这是本运行时中仅存的"目录≠执行面"分层,与 DASHR 报告 §10 讨论的 wire/SDK 双产物同构但更弱(目录与执行没有独立性可言——目录外技能照样可调,只要知道确切名字)。
2. **截断即证据**: `a2a-communication` 摘要截断于 "co...",说明文本通道有呈现预算;functions 通道的 description 无此截断(`bash`/`workflow` 的超长描述完整到达)。两通道预算策略不同。
