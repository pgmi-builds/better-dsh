# tool-surface Specification

## Purpose
DASHR 的模型表面（model surface）契约：哪些工具出现在 registry 投影（LLM-client 协议 tools 数组、目录文本、REPL 绑定）里。核心原则——掩码作用于 tool registry（被替代了呈现面的原生工具全部 visible=false）；REPL 绑定对 registry 可见集做机械/透明的自动桥接（零名单维护）；被掩工具的能力保留靠三桥 service 层直调（`agent` spawn/fork、`agent_message` 消息+中断、`agent_workflow` 编排），不靠 registry 豁免。

## Requirements

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
