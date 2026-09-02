## MODIFIED Requirements

### Requirement: Registry masking of replaced-presentation native tools
The system SHALL remove the native tools whose presentation surface DASHR replaces (`skill`, upstream `send_message`, `report`, `list_agents`, and the delegation family `subagent_fork`/`interrupt_agent`/`workflow`/`ralph`) from the agent's tool registry projection via an agent-scope registry restriction — the wire tools array, tool catalog, and REPL bindings all derive from the same projection, so the removal is uniform. `subagent` is deliberately NOT masked: it stays visible on every surface and the control-prompt section annotates it as an alias of the `agent` delegation tool (the unified agent-spawn entry). The restriction MUST NOT touch the registered tool definitions themselves; DASHR preserves each masked tool's native capability at the tool-bridge level (not by registry exemption): `agent` spawns/forks subagents and `agent_message` passes child-downlink/parent-uplink/interrupt through the host-plane service layer, while `agent_workflow` passes script/rfc through to the CAPTURED native workflow/ralph definitions (the workflowEngine service is entry-local to the preset's delegation realm, invisible to any outside ctx — the native execute closures resolve it from inside); `agent://` replaces `list_agents`, `read skill://` replaces `skill`.

#### Scenario: Masked tool absent from every model-facing surface
- **WHEN** an agent session starts under DASHR
- **THEN** the wire tools array, the tool catalog section, and the REPL bindings contain none of the masked names, and a call naming a masked tool returns `UNKNOWN_TOOL`

#### Scenario: subagent stays visible as an annotated alias
- **WHEN** an agent session starts under DASHR
- **THEN** `subagent` remains present on the wire tools array, the tool catalog, and the REPL bindings, and the control-prompt section states that it is an alias of the `agent` delegation tool

#### Scenario: Masked capability preserved through the bridge
- **WHEN** the model sends a child-downlink, parent-uplink, or interrupt through the `agent_message` bridge
- **THEN** the service layer executes it with native delivery semantics (user-role next-turn delivery, `messageId` confirmation) and native authorization (direct-child-only lineage, ancestor authority for interrupt)

#### Scenario: DASHR's own wrappers unaffected
- **WHEN** the agent-scope restriction denies a native name that a DASHR wrapper shadows on the agent's own layer
- **THEN** the wrapper (`read`/`write`/`grep`/`glob`, `agent`/`agent_message`/`agent_workflow`) remains visible and callable on every surface

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

### Requirement: Catalog section presents REPL bridge instructions
The system SHALL present the catalog section as REPL bridge instructions for the scripting pad (session-persistent, currently Python): a statement that every tool declared on the wire is callable from the pad as `await tool.<name>(argsObject)` with the same parameters, plus the non-flat-name exception — the exception SHALL name non-identifier characters such as hyphens as the disabler, not `__` infixes — without explaining the registry-to-binding correspondence (it is a structural guarantee, not model knowledge) and without the word "kernel". The section SHALL retain per-tool output contracts (which the wire does not carry), render every entry — delegation bridges included — from the single registry source (no separately-maintained bridge schema list), and keep its per-tool input form as compact one-line signatures (field A/B resolved to B).

#### Scenario: Input schemas compacted to one line per tool, single source
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, the pad's session-persistent nature is stated without "kernel" wording, and the delegation bridges' entries derive from their registry schemas — no parallel hand-written declaration exists in the codebase

#### Scenario: Input schemas not duplicated (option A) or compacted to one line per tool (option B)
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, and the pad's session-persistent nature is stated without "kernel" wording

#### Scenario: Non-flat wording names the disabler precisely
- **WHEN** a session renders the bridge instructions
- **THEN** the non-flat exception text refers to non-identifier characters such as hyphens and does not present `__` infixes alone as forbidden

## ADDED Requirements

### Requirement: Masking failures surface loudly
The system SHALL surface a structured error, not a silent skip, when restricting any masked tool name fails at session start; after application the mask SHALL verify that every masked name is absent from the wire tools array, the tool catalog, and the REPL bindings.

#### Scenario: A masked name's restriction errors and the session reports it
- **WHEN** applying the mask, a single masked name's registry restriction throws
- **THEN** the session surfaces the failure as a structured error naming the masked tool, and the name does not silently remain on any model-facing surface

#### Scenario: Masked names absent after successful application
- **WHEN** an agent session starts under DASHR with a healthy registry
- **THEN** the wire tools array, the tool catalog section, and the REPL bindings contain none of the masked names (`skill`, `send_message`, `report`, `list_agents`, `subagent_fork`, `interrupt_agent`, `workflow`, `ralph`), and a call naming a masked tool returns `UNKNOWN_TOOL`

### Requirement: Control prompt annotates subagent as an alias of agent
The system SHALL state in the control-prompt section's delegation paragraph that `subagent` is an alias of the `agent` delegation tool (the unified agent-spawn entry) and that both delegate through the same runtime, so the model surface stays logically self-consistent despite the duplicate entry.

#### Scenario: Control section carries the alias annotation
- **WHEN** the control-prompt section renders its delegation paragraph
- **THEN** it states that `subagent` is an alias of the `agent` delegation tool and both delegate through the same runtime

### Requirement: eval transport description matches runtime semantics
The system SHALL state the eval transport's top-level semantics truthfully in every model-facing description (the tool description and the control-prompt section): top-level `await` works — the kernel compiles the cell with `PyCF_ALLOW_TOP_LEVEL_AWAIT` and runs the module coroutine — while top-level `return` is a SyntaxError because the cell runs in module scope (globals = locals). The description SHALL NOT claim top-level `return` is accepted.

#### Scenario: Description promises only what the kernel does
- **WHEN** the model reads the eval tool description or the control-prompt cell-paradigm paragraph
- **THEN** the text states that top-level `await` works, states that top-level `return` is a SyntaxError (module-scope cell), and contains no claim that top-level `return` is accepted

#### Scenario: Top-level return stays rejected
- **WHEN** a cell contains a top-level `return`
- **THEN** the kernel rejects it with a SyntaxError, matching the description

### Requirement: Control prompt states the non-flat-name exception
The system SHALL state the non-flat-name exception in the control-prompt section's tool-binding paragraph, consistently with the catalog section, so the exception remains model-visible even if the control section is ever rendered independently of the catalog section.

#### Scenario: Control section carries the exception
- **WHEN** the control-prompt section renders its tool-binding paragraph
- **THEN** it states that tool names which are not plain identifiers (e.g. MCP names with hyphens) have no `tool.<name>` member and must be called as direct tool calls
