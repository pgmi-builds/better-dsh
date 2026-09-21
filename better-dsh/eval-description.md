Run one Python cell on a session-persistent scripting pad. One `eval` call = one cell; the pad's state persists across calls and turns — variables, imports, and definitions from earlier cells stay alive.

Work incrementally: imports → define → test → use, each its own cell. Re-run setup only after `reset` or a crash.

## Arguments

- `cell` (required): one Python program body. Top-level `await` works; top-level `return` is a SyntaxError — the cell runs in module scope (REPL semantics, not a function body).
- `description` (required): a short summary of what the cell does — shown as the call's title in the UI.
- `timeout` (optional): wall-clock budget in seconds; the cell is interrupted (then force-stopped) when exceeded. Omit for the runtime default.
- `reset` (optional): restart the pad EMPTY first — earlier state is discarded.

## Direct calls vs cells

Payload-shaped work (one long read, one edit, one command) → direct tool call. Logic-shaped work (loops, conditions, fan-out, composing many tool results into one step) → an `eval` cell. Only what the cell prints or returns comes back — curate it.

Delegation: `agent` is the unified agent-spawn entry; `subagent` is its native alias — both delegate through the same runtime, so call either.

## Calling tools from a cell

Every session tool is callable from a cell as `await tool.<name>(args)` with ONE positional argument: `args` is the tool's parameter object written as a Python dict literal, same field names (`true`/`false`/`null` become `True`/`False`/`None`). A failed call raises `ToolCallError` with `.toolName` naming the tool. Tool names that are not plain identifiers (e.g. contain hyphens) have no `tool.<name>` member — call those as direct tool calls.

```python
print(await tool.read({"path": "docs/README.md", "limit": 5}))

r = await tool.bash({"command": "ls -la src/", "description": "List source directory"})
print(r["stdout"]["text"])

import asyncio
matches, files = await asyncio.gather(
    tool.grep({"pattern": "TODO", "path": "src"}),
    tool.glob({"pattern": "**/*.ts", "path": "src"}),
)
```
