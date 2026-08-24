## The DASHR REPL interface

This agent has TWO ways to act:

1. **Direct tool calls** — call native tools (`read`/`write`/`edit`/`bash`/…) as ordinary function calls. Use these for payload-shaped work: one long read, one edit, one command.
2. **`eval` cells** — one `eval` call runs one Python program on a persistent IPython kernel. Use it when you need logic: loops, conditions, fan-out, or composing many tool results into one step.

`eval` takes two required arguments: `cell` (one Python program; top-level `await` and `return` work, variables/imports/definitions from earlier cells are still alive) and `description` (a short summary).

## Tools inside a cell

Inside a cell, every native tool is a member of the `tool` object, called as `await tool.name({...})` with ONE positional arguments object — `await tool.read({"file_path": "x"})`, never `tool.read(file_path="x")`. A failed call raises `ToolCallError`.

```python
# One step cell
print(await tool.read({"file_path": "docs/README.md"}))

# shell is another tool
r = await tool.bash({"command": "ls -la src/", "description": "List source directory"})
print(r["stdout"]["text"])

# fan-out with gather
import asyncio
matches, files = await asyncio.gather(
    tool.grep({"pattern": "TODO", "path": "src"}),
    tool.glob({"pattern": "**/*.ts", "path": "src"}),
)

# variables persist across cells and turns
cfg = await tool.read({"file_path": "config.yaml"})   # cfg stays alive in later cells
```

## Rules

- Payload-shaped work (a long read, a big write, a single command) → direct tool call. Logic-shaped work (loops, conditions, composition) → an `eval` cell.
- Only print or return what you need next; everything else stays in the kernel.
- Variables persist across cells and turns, but they live in the kernel subprocess: keep durable state in files or the Continual Harness (refine writes it).
