## Purpose

DASHR 的模型表面（model surface）契约：哪些工具出现在 LLM-client 协议的 tools 数组与目录文本里，哪些只在运行时可达。核心原则——被 DASHR 替代的原生工具 "wired but not surfaced"（wire 不可见、运行时经捕获定义可达），REPL 绑定自动转换全部平坦名（零名单维护）。

## ADDED Requirements

### Requirement: Wire-level masking of replaced native tools
The system SHALL remove the native tools replaced by DASHR surfaces (`skill`, upstream `send_message`, `report`, and the delegation family `subagent`/`subagent_fork`/`list_agents`/`interrupt_agent`/`workflow`/`ralph`) from the agent's wire tool schema, tool catalog, and SDK section via an agent-scope registry restriction. The restriction MUST NOT touch the registered tool definitions themselves.

#### Scenario: Masked tool absent from every model-facing surface
- **WHEN** an agent session starts under DASHR
- **THEN** the wire tools array, the tool catalog section, and the SDK section contain none of the masked names, and a model-direct call to a masked name returns `UNKNOWN_TOOL`

#### Scenario: Masked tool still executable via captured definition
- **WHEN** the runtime (REPL binding or bridge) invokes a masked tool through its pre-restriction captured definition
- **THEN** the tool executes with its native semantics

#### Scenario: DASHR's own wrappers unaffected
- **WHEN** the agent-scope restriction denies a native name that a DASHR wrapper shadows on the agent's own layer
- **THEN** the wrapper (`read`/`write`/`grep`/`glob`, `agent_message`) remains visible and callable on every surface

### Requirement: REPL bindings auto-map every flat name
The system SHALL install REPL `tool.*` bindings by automatic conversion of every flat-bindable tool name visible at session start, with no manual allowlist or denylist. Non-flat names (hyphens, `__`-scoped MCP names) SHALL be skipped and the bridge instructions SHALL state that such names are not addressable as cell members.

#### Scenario: A newly registered host tool appears in the REPL without list edits
- **WHEN** the host registers a new flat-named tool after a DASHR upgrade
- **THEN** the next agent session exposes it as `tool.<name>` with no DASHR source change

#### Scenario: Masked names absent from the kernel
- **WHEN** a cell or a model-direct call names a masked tool (e.g. `tool.subagent`)
- **THEN** no binding exists and the dispatch returns `UNKNOWN_TOOL`, on every surface alike

#### Scenario: Non-flat MCP names documented, not listed
- **WHEN** an MCP tool named `mcp__server__tool-name` is registered
- **THEN** no binding is created for it, and the bridge instructions explain the name-shape limitation without enumerating affected tools

### Requirement: Catalog section presents REPL bridge instructions
The system SHALL present the catalog section as REPL bridge instructions: a statement that every tool declared on the wire is callable from cells as `await tools.<name>(argsObject)` with the same parameters, plus the non-flat-name exception. The section SHALL retain per-tool output contracts (which the wire does not carry) and SHALL NOT repeat per-tool input parameter declarations already on the wire.

#### Scenario: Input schemas not duplicated
- **WHEN** a session renders the bridge instructions
- **THEN** no per-tool `ToolArgsMap`-style parameter block is present, and output contracts remain
