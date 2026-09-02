## MODIFIED Requirements

### Requirement: Dispatch errors settle as visible ToolCallError
The system SHALL resolve the plugin's tools service to the native `ToolRuntime` instance carrying the `TOOL_RUNTIME_SCHEDULER` symbol in the production composition (harness plugin-tree / preset-realm mount), so REPL sub-dispatches execute through the same staged scheduler as the agent loop and return real tool results to the cell. The plugin SHALL obtain that instance through a resolution path that preserves the instance symbol rather than a shadow-unwrapped service view that drops instance fields. A mount whose tools service genuinely lacks the symbol SHALL still be treated as a loud, diagnosable configuration failure rather than a silent runtime crash — that loud failure SHALL be the abnormal fallback, not the normal production state.

#### Scenario: Production mount carries the scheduler symbol
- **WHEN** the DASHR plugin mounts in the production preset-realm composition and a cell dispatches a real tool call
- **THEN** the dispatch executes through `registry[TOOL_RUNTIME_SCHEDULER]` and returns the tool result to the cell without crashing the daemon

#### Scenario: Legitimate cell tool call returns its real result
- **WHEN** a cell dispatches a legitimate tool call (e.g. `tool.read({ path })`) in a live session after the fix
- **THEN** the cell receives the tool's actual result, not the `TOOL_RUNTIME_SCHEDULER` loud error

#### Scenario: Regression probes pass after the fix
- **WHEN** the four probe cells from the diagnosis matrix (`tool.subagent` background:false, `tool.subagent` background:true, `tool.bash` background:true, `tool.read`) run in a live session after the fix
- **THEN** all four return a real result (or a visible `ToolCallError` where the call is legitimately invalid) instead of truncating, and the journal contains no new daemon crash
