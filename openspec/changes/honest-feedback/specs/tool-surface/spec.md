## ADDED Requirements

### Requirement: REPL tool namespace introspection
The system SHALL make the REPL `tool` namespace introspectable: `dir(tool)` returns the sorted list of bound tool names — exactly the names callable as `tool.<name>(argsObject)`. The underlying injected mapping (e.g. `__dashr_injected__`) remains unchanged for compatibility; `dir()` is the documented introspection surface.

#### Scenario: dir(tool) lists the binding set
- **WHEN** a cell runs `dir(tool)`
- **THEN** the returned list equals the sorted set of names bound in the `tool` namespace for that run (dunder members aside), including the delegation bridges and `llm_completion`
