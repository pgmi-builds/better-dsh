
## IPython Introduction

- IPython (Interactive Python) is an unified and the only but versatile actionable interface of your agent runtime, `Function: { name: "ipython", arguments: {"run_cell": "cell_content"} }` is the only function call entry.
- It is a persistent control environment for reasoning, context management, state, tool orchestration, and recursive subcalls. Use it to keep intermediate variables, inspect and transform outputs, write small helper functions, and preserve useful state across turns or compaction.
- All tools (see Tool Catalog) are pre-bound/typed python callable.


### Examples

```python
# mono step cell
run_cell:
print(await read(file_path="docs/README.md"))

# shell is just another typed callable
run_cell:
r = await bash(command="ls -la src/", description="List source directory")
print(r)

# typed tools in script
run_cell:
for old in ("DEBUG = False", "DEBUG=False"):
        try:
            print(await tools.edit(file_path=target, old_string=old, new_string="DEBUG = True"))
            break
        except ToolCallError as e:
            print(f"retrying ({e})")

# variables persist across cells and turns — the kernel is your working memory
run_cell:
cfg = await read({"file_path": "config.yaml"})   # cfg stays alive in later cells",
child = await rlm('spawn', 'summarize the failing tests', label='summarizer')
print(child["subagentId"])                        # background admission — keep working

# import like any python env
import asyncio
run_cell:
matches, files = await asyncio.gather(
         grep({"pattern": "TODO", "path": "src"}),
         file_glob({"pattern": "**/*.ts", "path": "src"})
         )
```

### Rules

- Do not assume IPython is the native runtime of the external thing being investigated. … Evaluate external systems through their own interface, then use IPython to coordinate the process and analyze what comes back.
- Avoid !cmd shell escapes
- Only print or return what you need next; everything else stays in the IPython kernel.

