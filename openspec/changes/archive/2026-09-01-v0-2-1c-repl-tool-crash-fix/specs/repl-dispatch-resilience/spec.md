# repl-dispatch-resilience Specification

## Purpose

REPL（`eval` cell）子分派的韧性契约：分派层的任何错误——调度器缺失、工具体抛错、取消——都必须 settle 为 cell 可见的 `ToolCallError` 结果，绝不外泄为 unhandled rejection 或使宿主进程崩溃。生产组合必须把带 `TOOL_RUNTIME_SCHEDULER` symbol 的原生 `ToolRuntime` 实例解析给插件，测试组合与生产组合之间不得存在环境差异导致的静默行为分裂。

## ADDED Requirements

### Requirement: Dispatch errors settle as visible ToolCallError
The system SHALL resolve the plugin's tools service to the native `ToolRuntime` instance carrying the `TOOL_RUNTIME_SCHEDULER` symbol in the production composition (harness plugin-tree / preset-realm mount), so REPL sub-dispatches execute through the same staged scheduler as the agent loop. A mount whose tools service lacks the symbol SHALL be treated as a loud, diagnosable configuration failure rather than a silent runtime crash.

#### Scenario: Production mount carries the scheduler symbol
- **WHEN** the DASHR plugin mounts in the production preset-realm composition and a cell dispatches a real tool call
- **THEN** the dispatch executes through `registry[TOOL_RUNTIME_SCHEDULER]` and returns the tool result to the cell without crashing the daemon

#### Scenario: Regression probes pass after the fix
- **WHEN** the four probe cells from the diagnosis matrix (`tool.subagent` background:false, `tool.subagent` background:true, `tool.bash` background:true, `tool.read`) run in a live session after the fix
- **THEN** all four return a real result (or a visible `ToolCallError` where the call is legitimately invalid) instead of truncating, and the journal contains no new daemon crash
