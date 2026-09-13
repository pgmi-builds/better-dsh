# tool-surface Delta

## MODIFIED Requirements

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

### Requirement: Masking failures surface loudly

The system SHALL surface a structured error, not a silent skip, when restricting any masked tool name fails at session start；application 完成后 mask SHALL verify 每个 masked 名在 **the wire tools array 与 the REPL bindings** 中均不存在。

#### Scenario: A masked name's restriction errors and the session reports it

- **WHEN** applying the mask, a single masked name's registry restriction throws
- **THEN** the session surfaces the failure as a structured error naming the masked tool, and the name does not silently remain on any model-facing surface

#### Scenario: Masked names absent after successful application

- **WHEN** an agent session starts under DASHR with a healthy registry
- **THEN** the wire tools array 与 the REPL bindings contain none of the masked names（`skill`、`send_message`、`report`、`list_agents`、`subagent_fork`、`interrupt_agent`、`workflow`、`ralph`），and a call naming a masked tool returns `UNKNOWN_TOOL`

## REMOVED Requirements

### Requirement: Catalog section presents REPL bridge instructions

**Reason**：`dashr:tool-catalog` section 是 wire 目录之外的第二份手写渲染（输入结构与 wire JSON Schema 重复、覆盖不全、provenance 分叉），与"工具知识单源"的 OMP 口径相悖，且占提示面预算约 4,793 chars。原生工具目录的唯一形态是运行时从注册 description + JSON Schema 组装的 wire `tools` 数组。
**Migration**：桥接指引（调用形、非 flat 名例外、别名注记）整体迁入 `eval` 工具的 wire description（见 ADDED「eval description is the single REPL guidance source」）；声明块独有的 per-tool output contracts **有意放弃**（OMP 同构：运行期实际返回值可见，不静态保证形状）。

### Requirement: Control prompt annotates subagent as an alias of agent

**Reason**：`dashr:control-prompt` section 随本 change 撤销，独立要求失去载体。
**Migration**：别名注记迁入 `eval` 工具 description，由 ADDED「eval description is the single REPL guidance source」的 scenario 覆盖。

### Requirement: Control prompt states the non-flat-name exception

**Reason**：`dashr:control-prompt` section 随本 change 撤销，独立要求失去载体。
**Migration**：非 flat 名例外迁入 `eval` 工具 description，由 ADDED「eval description is the single REPL guidance source」的 scenario 覆盖。

## ADDED Requirements

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
