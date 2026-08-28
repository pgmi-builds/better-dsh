# tool-surface Specification

## Purpose
DASHR 的模型表面（model surface）契约：哪些工具出现在 registry 投影（LLM-client 协议 tools 数组、目录文本、REPL 绑定）里。核心原则——掩码作用于 tool registry（被替代了呈现面的原生工具全部 visible=false）；REPL 绑定对 registry 可见集做机械/透明的自动桥接（零名单维护）；被掩工具的能力保留靠三桥 service 层直调（`agent` spawn/fork、`agent_message` 消息+中断、`agent_workflow` 编排），不靠 registry 豁免。

## Requirements

### Requirement: Registry masking of replaced-presentation native tools
The system SHALL remove the native tools whose presentation surface DASHR replaces (`skill`, upstream `send_message`, `report`, `list_agents`, and the delegation family `subagent`/`subagent_fork`/`interrupt_agent`/`workflow`/`ralph`) from the agent's tool registry projection via an agent-scope registry restriction — the wire tools array, tool catalog, and REPL bindings all derive from the same projection, so the removal is uniform. The restriction MUST NOT touch the registered tool definitions themselves; DASHR preserves each masked tool's native capability at the tool-bridge level (not by registry exemption): `agent` spawns/forks subagents and `agent_message` passes child-downlink/parent-uplink/interrupt through the host-plane service layer, while `agent_workflow` passes script/rfc through to the CAPTURED native workflow/ralph definitions (the workflowEngine service is entry-local to the preset's delegation realm, invisible to any outside ctx — the native execute closures resolve it from inside); `agent://` replaces `list_agents`, `read skill://` replaces `skill`.

#### Scenario: Masked tool absent from every model-facing surface
- **WHEN** an agent session starts under DASHR
- **THEN** the wire tools array, the tool catalog section, and the REPL bindings contain none of the masked names, and a call naming a masked tool returns `UNKNOWN_TOOL`

#### Scenario: Masked capability preserved through the bridge
- **WHEN** the model sends a child-downlink, parent-uplink, or interrupt through the `agent_message` bridge
- **THEN** the service layer executes it with native delivery semantics (user-role next-turn delivery, `messageId` confirmation) and native authorization (direct-child-only lineage, ancestor authority for interrupt)

#### Scenario: DASHR's own wrappers unaffected
- **WHEN** the agent-scope restriction denies a native name that a DASHR wrapper shadows on the agent's own layer
- **THEN** the wrapper (`read`/`write`/`grep`/`glob`, `agent`/`agent_message`/`agent_workflow`) remains visible and callable on every surface

### Requirement: REPL bindings bridge the visible registry mechanically
The system SHALL install REPL bindings by automatic, transparent conversion of every flat-bindable name in the registry's visible set at session start — no manual allowlist or denylist; masked names are naturally absent because the binding source and the masking act on the same projection. Non-flat names (hyphens, `__`-scoped MCP names) SHALL be skipped and the bridge instructions SHALL state the name-shape limitation without enumerating affected tools.

#### Scenario: A newly registered host tool appears in the REPL without list edits
- **WHEN** the host registers a new flat-named tool after a DASHR upgrade
- **THEN** the next agent session exposes it as `tool.<name>` with no DASHR source change

#### Scenario: Non-flat MCP names documented, not listed
- **WHEN** an MCP tool named `mcp__server__tool-name` is registered
- **THEN** no binding is created for it, and the bridge instructions explain the name-shape limitation

### Requirement: Catalog section presents REPL bridge instructions
The system SHALL present the catalog section as REPL bridge instructions for the scripting pad (session-persistent, currently Python): a statement that every tool declared on the wire is callable from the pad as `await tool.<name>(argsObject)` with the same parameters, plus the non-flat-name exception — without explaining the registry-to-binding correspondence (it is a structural guarantee, not model knowledge) and without the word "kernel". The section SHALL retain per-tool output contracts (which the wire does not carry), render every entry — delegation bridges included — from the single registry source (no separately-maintained bridge schema list), and keep its per-tool input form as compact one-line signatures (field A/B resolved to B).

#### Scenario: Input schemas compacted to one line per tool, single source
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, the pad's session-persistent nature is stated without "kernel" wording, and the delegation bridges' entries derive from their registry schemas — no parallel hand-written declaration exists in the codebase

#### Scenario: Input schemas not duplicated (option A) or compacted to one line per tool (option B)
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, and the pad's session-persistent nature is stated without "kernel" wording

### Requirement: Delegation bridges are registry tools
The system SHALL register the delegation bridges (`agent`, `agent_message`, `agent_workflow`) as real tools in the tool registry (same host registration layer as the `eval` transport), with runtime argument validation inside their execute and structured `{ error }` return values (no exceptions for bad input). The registry projection is then the single source for all three model-facing surfaces: the wire tools array, the tool catalog, and the REPL `tool.*` bindings (via the mechanical auto-bridge). The three surfaces SHALL be name-by-name equal for every session; the only permitted exception is `eval` itself excluded from the binding and catalog sets (self-call prevention).

#### Scenario: Bridge callable directly on the wire
- **WHEN** the model sends a direct tool call `agent` with `{ description, prompt }` (no cell)
- **THEN** the call dispatches through the normal kernel pipeline and returns the same result shape the REPL binding returns, with the same audit events as any registry tool

#### Scenario: Three-surface name equality
- **WHEN** a DASHR session starts
- **THEN** the wire tools array, the catalog entries, and the REPL binding names are equal as sets, excepting only `eval`

#### Scenario: No dual-source drift
- **WHEN** a bridge's parameter surface changes
- **THEN** the wire schema, catalog line, and REPL binding all change together, because all three derive from the one registered schema

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
