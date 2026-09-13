# tool-surface Specification

## Purpose
DASHR 的模型表面（model surface）契约：哪些工具出现在 registry 投影（LLM-client 协议 tools 数组、REPL 绑定）里。核心原则——掩码作用于 tool registry（被替代了呈现面的原生工具全部 visible=false）；REPL 绑定对 registry 可见集做机械/透明的自动桥接（零名单维护）；被掩工具的能力保留靠三桥 service 层直调（`agent` spawn/fork、`agent_message` 消息+中断、`agent_workflow` 编排），不靠 registry 豁免。全部 REPL 指引（cell 语义、调用形、非 flat 名例外、`subagent` 别名注记）只经由 `eval` 工具的 wire description 承载——system prompt 中不存在任何 DASHR 渲染的工具目录或 control-prompt section。

## Requirements

### Requirement: Registry masking of replaced-presentation native tools

The system SHALL remove the native tools whose presentation surface DASHR replaces（`skill`、上游 `send_message`、`report`、`list_agents`、delegation 家族 `subagent_fork`/`interrupt_agent`/`workflow`/`ralph`）from the agent's tool registry projection via an agent-scope registry restriction —— wire tools array 与 REPL bindings 同源于该 projection，移除因此均匀生效。`subagent` is deliberately NOT masked：它在每个表面保持可见，且 **`eval` 工具的 description** 注记它是 `agent` delegation tool（统一 agent-spawn 入口）的别名。The restriction MUST NOT touch the registered tool definitions themselves；DASHR preserves each masked tool's native capability at the tool-bridge level（not by registry exemption）：`agent` spawns/forks subagents、`agent_message` 经 host-plane service 层传递 child-downlink/parent-uplink/interrupt、`agent_workflow` 把 script/rfc 透传给 CAPTURED native workflow/ralph definitions（workflowEngine service 是 preset delegation realm 的 entry-local 服务，任何外部 ctx 不可见——native execute closures 从内部解析）；`agent://` 取代 `list_agents`、`read skill://` 取代 `skill`。

#### Scenario: Masked tool absent from every model-facing surface

- **WHEN** an agent session starts under DASHR
- **THEN** the wire tools array 与 the REPL bindings 均不含 masked 名，对 masked 名的调用返回 `UNKNOWN_TOOL`

#### Scenario: subagent stays visible as an annotated alias

- **WHEN** an agent session starts under DASHR
- **THEN** `subagent` remains present on the wire tools array 与 the REPL bindings，且 `eval` 工具 description 注明它是 `agent` delegation tool 的别名

#### Scenario: Masked capability preserved through the bridge

- **WHEN** the model sends a child-downlink, parent-uplink, or interrupt through the `agent_message` bridge
- **THEN** the service layer executes it with native delivery semantics (user-role next-turn delivery, `messageId` confirmation) and native authorization (direct-child-only lineage, ancestor authority for interrupt)

#### Scenario: DASHR's own wrappers unaffected

- **WHEN** the agent-scope restriction denies a native name that a DASHR wrapper shadows on the agent's own layer
- **THEN** the wrapper (`read`/`write`/`grep`/`glob`, `agent`/`agent_message`/`agent_workflow`) remains visible and callable on every surface

### Requirement: Delegation bridges are registry tools

The system SHALL register the delegation bridges（`agent`、`agent_message`、`agent_workflow`）as real tools in the tool registry（与 `eval` transport 同一 host registration 层），runtime argument validation inside their execute、structured `{ error }` return values（bad input 不抛异常）。Registry projection 是**两个**模型表面的 single source：wire tools array 与 REPL `tool.*` bindings（经 mechanical auto-bridge）。两个表面 SHALL 每个 session name-by-name 相等（以 mechanical binding rule 的 flat-name 限定为界）；唯一允许的例外是 `eval` 本身排除在 binding set 之外（self-call prevention）。

#### Scenario: Bridge callable directly on the wire

- **WHEN** the model sends a direct tool call `agent` with `{ description, prompt }` (no cell)
- **THEN** the call dispatches through the normal kernel pipeline and returns the same result shape the REPL binding returns, with the same audit events as any registry tool

#### Scenario: Three-surface name equality

- **WHEN** a DASHR session starts
- **THEN** 目录表面已随「Catalog section presents REPL bridge instructions」的 REMOVED 撤销，原三表面等式收敛为两表面：the wire tools array 与 the REPL binding names 在 flat-name 规则内 equal as sets，excepting only `eval`

#### Scenario: No dual-source drift

- **WHEN** a bridge's parameter surface changes
- **THEN** the wire schema 与 REPL binding 一起变化，因为两者都派生自同一注册 schema

### Requirement: eval transport description matches runtime semantics

The system SHALL state the eval transport's top-level semantics truthfully in **the `eval` tool's model-facing description（唯一的 REPL 指引载体）**：top-level `await` works —— kernel 以 `PyCF_ALLOW_TOP_LEVEL_AWAIT` 编译 cell 并运行 module coroutine；top-level `return` is a SyntaxError（cell 运行于 module scope，globals = locals）。The description SHALL NOT claim top-level `return` is accepted.

#### Scenario: Description promises only what the kernel does

- **WHEN** the model reads the `eval` tool description
- **THEN** the text states that top-level `await` works，states that top-level `return` is a SyntaxError（module-scope cell），and contains no claim that top-level `return` is accepted

#### Scenario: Top-level return stays rejected

- **WHEN** a cell contains a top-level `return`
- **THEN** the kernel rejects it with a SyntaxError, matching the description

### Requirement: eval description is the single REPL guidance source

The system SHALL carry ALL REPL guidance in the `eval` tool's wire description —— cell 语义、直调 vs 进 cell 的判据、非 flat 名例外、`subagent` 别名注记、**置于 description 末尾**的 mechanical bridge 调用形 —— 内容从**插件源码中的 Markdown 文件**加载、注册工具时作为 `description` 生效；system prompt 中 SHALL NOT 存在任何 DASHR 渲染的工具目录或 control-prompt section。桥接指引 SHALL 只陈述**一个**统一调用形、一句话说清：`await tool.<name>(argsObject)`，argsObject = 该工具 wire JSON-Schema 参数对象写成的 Python dict 字面量（同字段名、单个位置参数、不用 kwargs），唯一系统性语法差异为 `true`/`false`/`null` → `True`/`False`/`None`；SHALL NOT 渲染 per-tool 签名表，且 SHALL NOT 对桥接调用的返回值形态作任何陈述（不写"不保证形状/需试错"类措辞）。描述中的桥接示例 SHALL 使用与被引工具 wire schema 一致的参数名。

#### Scenario: System prompt carries no DASHR catalog or control section

- **WHEN** an agent session renders its system prompt
- **THEN** 没有 DASHR 来源的 section 枚举 per-tool 签名，也没有独立的 control-prompt section 教 cell 范式；全部 REPL 指引只经由 `eval` description 到达模型

#### Scenario: Description loads from the source Markdown

- **WHEN** the plugin registers the `eval` tool
- **THEN** 其 wire description 等于包内 Markdown 指引文件的内容——编辑该文件即改变模型可见的 description

#### Scenario: One bridge call form, one syntax delta

- **WHEN** the model reads the bridge instructions in the `eval` description
- **THEN** it sees the single positional-args-object call form 与 `True`/`False`/`None` 大小写映射，and no per-tool signature table or output-shape caveat（无任何"不保证形态/试错"措辞）

#### Scenario: Examples match wire parameter names

- **WHEN** the description shows a bridge example for `read`
- **THEN** 参数键与 `read` 的 wire schema 一致（如 `path`），而非其它工具的键名

#### Scenario: Guidance lives and dies with the tool

- **WHEN** a session's scope excludes the `eval` tool
- **THEN** 任何地方都不渲染 REPL 指引（指引即工具自身的 description）；`eval` 在场时指引必然在场

#### Scenario: Alias annotation present

- **WHEN** the model reads the `eval` description
- **THEN** it states that `subagent` is an alias of the `agent` delegation tool，两者经同一 runtime delegate

#### Scenario: Non-flat exception present

- **WHEN** the model reads the `eval` description
- **THEN** it states that 含非标识符字符（如连字符）的工具名没有 `tool.<name>` member，必须以 direct tool call 调用

### Requirement: Masking failures surface loudly

The system SHALL surface a structured error, not a silent skip, when restricting any masked tool name fails at session start；application 完成后 mask SHALL verify 每个 masked 名在 **the wire tools array 与 the REPL bindings** 中均不存在。

#### Scenario: A masked name's restriction errors and the session reports it

- **WHEN** applying the mask, a single masked name's registry restriction throws
- **THEN** the session surfaces the failure as a structured error naming the masked tool, and the name does not silently remain on any model-facing surface

#### Scenario: Masked names absent after successful application

- **WHEN** an agent session starts under DASHR with a healthy registry
- **THEN** the wire tools array 与 the REPL bindings contain none of the masked names（`skill`、`send_message`、`report`、`list_agents`、`subagent_fork`、`interrupt_agent`、`workflow`、`ralph`），and a call naming a masked tool returns `UNKNOWN_TOOL`

### Requirement: REPL bindings bridge the visible registry mechanically
The system SHALL install REPL bindings by automatic, transparent conversion of every flat-bindable name in the registry's visible set at session start — no manual allowlist or denylist; masked names are naturally absent because the binding source and the masking act on the same projection. Non-flat names SHALL be skipped — a name is non-flat when it contains characters outside `[A-Za-z0-9_]` (e.g. hyphens); a `__` infix alone is a legal identifier and does not by itself make a name non-flat — and the bridge instructions SHALL state the name-shape limitation without enumerating affected tools.

#### Scenario: A newly registered host tool appears in the REPL without list edits
- **WHEN** the host registers a new flat-named tool after a DASHR upgrade
- **THEN** the next agent session exposes it as `tool.<name>` with no DASHR source change

#### Scenario: Non-flat MCP names documented, not listed
- **WHEN** an MCP tool named `mcp__server__tool-name` is registered
- **THEN** no binding is created for it, and the bridge instructions explain the name-shape limitation

#### Scenario: Double-underscore infix alone stays bindable
- **WHEN** a tool named `mcp__server__tool` (identifier characters only, no hyphen) is registered
- **THEN** the name is flat-bindable (`'mcp__server__tool'.isidentifier()` is true) and appears as `tool.<name>` unless separately masked

### Requirement: llm_completion tool
The system SHALL provide an `llm_completion` tool: a one-shot, stateless LLM call — no tools, no conversation history, no agent creation. Inputs: `{ prompt, system?, maxTokens? }`; output: the model's text. The call SHALL be attributed to the calling agent's session through the normal tool-call audit (the host's auxiliary-purpose enum is closed and carries no completion class), SHALL honor the caller's abort signal, and SHALL resolve its model route from the calling agent's current model selection, and SHALL answer a structured error value — never a silent fallback route — when no selection is available. A finish other than a clean stop, or any tool-call block in the output, SHALL produce a structured error value, not a thrown exception.

#### Scenario: Zero-spawn judge step inside a cell
- **WHEN** a cell calls `await tool.llm_completion({ prompt: "<judge prompt>", system: "<rubric>" })`
- **THEN** the value returned is the model's text; no subagent is spawned, no session besides the caller's is created, and the call is auditable under its own purpose

#### Scenario: Model route follows the caller
- **WHEN** the calling agent's selected model differs from the host default
- **THEN** the completion runs on the caller's selection

#### Scenario: Degraded finish is a structured error
- **WHEN** the completion hits maxTokens or aborts
- **THEN** the tool returns `{ error: <description> }` rather than throwing

### Requirement: REPL tool namespace introspection
The system SHALL make the REPL `tool` namespace introspectable: `dir(tool)` returns the sorted list of bound tool names — exactly the names callable as `tool.<name>(argsObject)`. The underlying injected mapping (e.g. `__dashr_injected__`) remains unchanged for compatibility; `dir()` is the documented introspection surface.

#### Scenario: dir(tool) lists the binding set
- **WHEN** a cell runs `dir(tool)`
- **THEN** the returned list equals the sorted set of names bound in the `tool` namespace for that run (dunder members aside), including the delegation bridges and `llm_completion`

### Requirement: Hashline edit family registered on the agent's own layer

The system SHALL register the vendored hashline edit family on each agent's own scope layer at session start — `edit` (hash-anchored ordered edit tuples, shadowing the preset's built-in edit by nearest-layer resolution, no mask entry needed) and `undo_last_edit` (revert of the most recent hashline edit) — alongside the URL-aware read/write/grep/glob wrappers, unwinding with the agent. The write tool SHALL remain the upstream full-file write with its native confirmation envelope: no hook SHALL append a hashline preview to write results, and the hashline guidance SHALL NOT promise post-write anchors (the model MAY edit directly using anchors derived from the content it just wrote, or read first). The hashline guidance sections SHALL shadow the preset's built-in tool guidance on the same layer (compiled defaults when no agentPresets service or a failing override — never a failed install).

#### Scenario: A hash-anchored edit lands and is reversible

- **WHEN** the model calls `edit` with anchored edit tuples on a file whose current content matches the anchors
- **THEN** the edit applies atomically (drift-checked against current content), and a subsequent `undo_last_edit` reverts it

#### Scenario: A write result stays upstream-native

- **WHEN** the model calls `write` and it succeeds
- **THEN** the result content is the upstream confirmation envelope with no auto-read/anchor section appended, and no read is required before the next anchored `edit` on that file

#### Scenario: The shadow replaces the built-in edit without masking

- **WHEN** an agent session starts under DASHR
- **THEN** the `edit` the model sees is the hashline tool (own-layer shadow), the preset's built-in edit is unreachable for that agent, and no deny-list entry names `edit`

### Requirement: Lsp feedback rides edit results
The system SHALL attach the same write-feedback diagnostics contract to successful edits: after a landed `edit` with an explicit path, the result content carries the diagnostics summary computed from the exact landed content (didSave freshness, timeout degradation, span guard — the `dvc` write-feedback requirement's terms apply verbatim). Anchor-only edits (path inferred from anchors) and non-edit tools pass through untouched; the write tool's feedback stays with its wrapper (no double pull).

#### Scenario: An edit that introduces a type error reports it
- **WHEN** an edit lands content introducing a type error in a file with a language server and its check completes within the budget
- **THEN** the edit result text carries the diagnostics summary for the exact landed content

### Requirement: Hashline edit verification is content-anchored

The system SHALL verify each edit tuple's anchors against the CURRENT file content before consulting any ledger: an anchor SHALL be accepted when its hash locates a unique, consistently pairable position in the current canonical line hashes; the served ledger SHALL be advisory (echo/undo attribution) and keyed by canonical absolute path with no session identity, so anchors survive session-tree forks and continuation without a re-read. Genuine drift SHALL still fail closed with nothing written, batch atomicity SHALL be unchanged, and a multi-tuple batch failure SHALL instruct reading the file once and resubmitting the whole batch.

#### Scenario: An edit across a forked session lands without a re-read

- **WHEN** a file is written or read in one session node, the conversation continues in a forked node (new session identity), and the model submits anchored edit tuples derived from that earlier content
- **THEN** the edit applies without any intervening `read`, because verification matched current content

#### Scenario: A drifted line still fails closed

- **WHEN** an anchor's hash no longer exists in the current file (content changed or line removed externally)
- **THEN** the tuple is rejected with a drift error stating the content changed and a read is needed, and nothing is written

#### Scenario: An ambiguous anchor falls back before failing

- **WHEN** an anchor's hash occurs at multiple current positions and the served ledger cannot disambiguate the span
- **THEN** the tuple is rejected with nothing written, and the error names the ambiguity

#### Scenario: Multi-tuple failure copy is actionable

- **WHEN** any tuple in a multi-tuple batch fails verification
- **THEN** the batch aborts with zero writes and the error instructs reading the file once, then resubmitting the whole batch

### Requirement: Hashline store centralized under DSH_HOME

The hashline store SHALL live at a single location — `$DSH_HOME/storages/dsh-better-edit/hash-store.sqlite` — for tool calls, previews, and tests alike, resolved through the harness home resolver so `DSH_HOME` isolates deployments; no per-workspace dot-directory SHALL be created. The served table SHALL be keyed by canonical absolute path (no session column), the 7-day TTL prune SHALL be retained, and the store schema version SHALL bump with a rebuild-on-mismatch gate that drops and recreates legacy session-keyed served tables.

#### Scenario: No dot-directory is created

- **WHEN** hashline tools run inside any workspace
- **THEN** state lands in the centralized store and no `<workspace>/.dsh_better_edit/` directory is created

#### Scenario: DSH_HOME isolates deployments

- **WHEN** the harness runs with a test `DSH_HOME` (e.g. the 4999 line)
- **THEN** its hashline store is a separate file under that home and never touches the production store

#### Scenario: Legacy session-keyed served tables rebuild

- **WHEN** the store opens with a schema version below the current one, or a served table still carrying a `session_id` column
- **THEN** the served table is dropped and recreated with the path-keyed schema, and the version marker is updated
