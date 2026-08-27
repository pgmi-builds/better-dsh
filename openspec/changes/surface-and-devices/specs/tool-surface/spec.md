## Purpose

DASHR 的模型表面（model surface）契约：哪些工具出现在 registry 投影（LLM-client 协议 tools 数组、目录文本、REPL 绑定）里。核心原则——掩码作用于 tool registry（被替代了呈现面的原生工具全部 visible=false）；REPL 绑定对 registry 可见集做机械/透明的自动桥接（零名单维护）；被掩工具的能力保留靠三桥 service 层直调（`agent` spawn/fork、`agent_message` 消息+中断、`agent_workflow` 编排），不靠 registry 豁免。

## ADDED Requirements

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
The system SHALL present the catalog section as REPL bridge instructions for the scripting pad (session-persistent, currently Python): a statement that every tool declared on the wire is callable from the pad as `await tool.<name>(argsObject)` with the same parameters, plus the non-flat-name exception — without explaining the registry-to-binding correspondence (it is a structural guarantee, not model knowledge) and without the word "kernel". The section SHALL retain per-tool output contracts (which the wire does not carry) and its per-tool input form SHALL be decided by field A/B (pure convention vs omp-style one-line signatures).

#### Scenario: Input schemas not duplicated (option A) or compacted to one line per tool (option B)
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, and the pad's session-persistent nature is stated without "kernel" wording
