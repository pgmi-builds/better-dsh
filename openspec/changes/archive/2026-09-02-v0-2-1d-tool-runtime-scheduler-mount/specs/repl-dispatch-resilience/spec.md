## MODIFIED Requirements

### Requirement: Dispatch errors settle as visible ToolCallError
The system SHALL resolve the plugin's tools service to the native `ToolRuntime` instance carrying the `TOOL_RUNTIME_SCHEDULER` symbol in the production composition, so REPL sub-dispatches execute through the same staged scheduler as the agent loop and return real tool results to the cell. The symbol this plugin imports SHALL be identical (`===`) to the one keying the mounted instance — a second dsh-tools module copy reachable from the deployed plugin (e.g. stray nested `@deepseek-ai` symlinks) breaks that identity and is a deployment defect (2026-09-02 corrected root cause; the plain `runtimeCtx.tools` read is the sanctioned resolution path). A mount whose tools service genuinely lacks the symbol SHALL be treated as a loud, diagnosable configuration failure — the error names the plugin's own `dsh-tools` resolution path — rather than a silent runtime crash, and that loud failure SHALL be the abnormal fallback, not the normal production state.

#### Scenario: Production mount carries the scheduler symbol
- **WHEN** the DASHR plugin mounts in the production composition and a cell dispatches a real tool call
- **THEN** the dispatch executes through `registry[TOOL_RUNTIME_SCHEDULER]` and returns the tool result to the cell without crashing the daemon

#### Scenario: Legitimate cell tool call returns its real result
- **WHEN** a cell dispatches a legitimate tool call (e.g. `tool.read({ path })`) in a live session after the fix
- **THEN** the cell receives the tool's actual result, not the `TOOL_RUNTIME_SCHEDULER` loud error

#### Scenario: Regression probes pass after the fix
- **WHEN** the four probe cells from the diagnosis matrix (`tool.subagent` background:false, `tool.subagent` background:true, `tool.bash` background:true, `tool.read`) run in a live session after the fix
- **THEN** all four return a real result (or a visible `ToolCallError` where the call is legitimately invalid) instead of truncating, and the journal contains no new daemon crash
