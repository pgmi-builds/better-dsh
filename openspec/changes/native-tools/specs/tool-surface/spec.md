## MODIFIED Requirements

### Requirement: Catalog section presents REPL bridge instructions
The system SHALL present the catalog section as REPL bridge instructions for the scripting pad (session-persistent, currently Python): a statement that every tool declared on the wire is callable from the pad as `await tool.<name>(argsObject)` with the same parameters, plus the non-flat-name exception — without explaining the registry-to-binding correspondence (it is a structural guarantee, not model knowledge) and without the word "kernel". The section SHALL retain per-tool output contracts (which the wire does not carry), render every entry — delegation bridges included — from the single registry source (no separately-maintained bridge schema list), and keep its per-tool input form as compact one-line signatures (field A/B resolved to B).

#### Scenario: Input schemas compacted to one line per tool, single source
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, the pad's session-persistent nature is stated without "kernel" wording, and the delegation bridges' entries derive from their registry schemas — no parallel hand-written declaration exists in the codebase

#### Scenario: Input schemas not duplicated (option A) or compacted to one line per tool (option B)
- **WHEN** a session renders the bridge instructions
- **THEN** no full per-tool parameter interface block is present, output contracts remain, and the pad's session-persistent nature is stated without "kernel" wording

## ADDED Requirements

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
The system SHALL provide an `llm_completion` tool: a one-shot, stateless LLM call — no tools, no conversation history, no agent creation. Inputs: `{ prompt, system?, maxTokens? }`; output: the model's text. The call SHALL be attributed to the calling agent's session with an audit purpose distinct from agent turns, SHALL honor the caller's abort signal, and SHALL resolve its model route from the calling agent's current model selection (falling back to the host default model when no agent context exists). A finish other than a clean stop, or any tool-call block in the output, SHALL produce a structured error value, not a thrown exception.

#### Scenario: Zero-spawn judge step inside a cell
- **WHEN** a cell calls `await tool.llm_completion({ prompt: "<judge prompt>", system: "<rubric>" })`
- **THEN** the value returned is the model's text; no subagent is spawned, no session besides the caller's is created, and the call is auditable under its own purpose

#### Scenario: Model route follows the caller
- **WHEN** the calling agent's selected model differs from the host default
- **THEN** the completion runs on the caller's selection

#### Scenario: Degraded finish is a structured error
- **WHEN** the completion hits maxTokens or aborts
- **THEN** the tool returns `{ error: <description> }` rather than throwing
