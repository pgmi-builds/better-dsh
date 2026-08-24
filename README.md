# Dashr: persistent-kernel REPL for `dsh`

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/plugin%20for-dsh-blueviolet.svg?style=flat-square" alt="dsh plugin" /></a>
  <a href="https://npmjs.com/package/@pgmi-builds/dashr"><img src="https://img.shields.io/badge/npm-%40pgmi--builds%2Fdashr-CB3837.svg?style=flat-square&logo=npm" alt="npm package" /></a>
  <a href="https://github.com/pgmi-builds/dashr"><img src="https://img.shields.io/badge/github-pgmi--builds%2Fdashr-black.svg?style=flat-square&logo=github" alt="Repository" /></a>
  <a href="https://github.com/pgmi-builds/dashr/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
</p>

---

## ⚡ Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/pgmi-builds/dashr/main/install.sh | bash
```

The installer:

1. ensures the DeepSeek Harness (`dsh`) is present;
2. installs the `@pgmi-builds/dashr` plugin into the profile (the runtime
   OWNS its kernel environment — a managed venv with `ipykernel` + `dill` is
   provisioned on first use, no symlinks, no blind trust in a host `python3`);
3. writes the `dashr` agent preset (shipped `standard` preset + tuned passive
   compaction) and makes it the new-session default;
4. restarts the running instance.

> After installation, new sessions are created on the **DASHR** preset
> automatically; `eval` is available in every preset regardless.

---

## 📖 Overview

**Dashr** is an open-source plugin for the [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) agent
runtime. It gives the agent a **stateful, persistent Python kernel（持久化内核）**: instead of paying token costs
round-tripping tool output through the chat, the agent runs self-contained Python cells whose variables, imports, and
definitions **survive across turns** — *Context as Variables*（上下文即变量）.

Inside a cell, every native tool is a direct binding: `await tool.read({...})`, `await tool.bash({...})` — one flat
`tool.*` surface, the same tools the host ships, driven from Python. Loops, conditions, and fan-out become ordinary
Python instead of many sequential model round-trips.

---

## ✨ Features

- 🐍 **Persistent IPython kernel** — one kernel per session; variables, imports, and definitions persist across cells
  and turns. Top-level `await` works; the last expression's value is the cell's result.
- 🔌 **Unified `tool.*` bindings** — every registry tool (files, shell, sub-agents, workflows…) is bound as
  `await tool.name({...})` inside a cell, dispatched through the host's native tool pipeline (approval, sandbox,
  concurrency policy included).
- 🧩 **Direct delegation** — `subagent`, `subagent_fork`, `list_agents`, `interrupt_agent`, `workflow`, `ralph` are
  exposed **natively, exactly as upstream ships them**. Only two names are displaced: upstream `send_message`
  (parent→child) and the child-scoped `report` (child→parent) collapse into one dual-direction
  `send_message({"receiver": "child"|"parent", ...})` bridge.
- 🗜️ **Tuned passive compaction** — the upstream compaction engine, configured per deployment through the
  `dashr-compaction` settings section (defaults: trigger `0.5` × model window, retain `0.05`, DeepSeek V4 Flash
  summarizer). Compaction is the host's business, not the REPL's — there is no model-facing compact tool.
- 💾 **State snapshot & revival** — full-namespace `dill` snapshots save and restore kernel state across restarts.
- 🛡️ **Self-managed kernel environment** — the runtime provisions its own CPython 3.11 venv (`ipykernel` + `dill`)
  under the package; an explicit `DASHR_KERNEL_PYTHON` is honored instead.

Removed in v0.1.8b: the `refine` Continual Harness and the model-facing `compact` bridge (see
`docs/v0.1.8b-实测报告.md` for the decision record).

---

## 📊 Dashr vs. Code Mode (`dsh` built-in)

| Dimension | Dashr | Code Mode (`dsh` built-in) |
|---|---|---|
| Execution language | **Python** (IPython) | TypeScript / JavaScript |
| Kernel layer | **Persistent** — one kernel per session, variables survive across turns | Ephemeral one-shot runner |
| Tool surface | Flat `await tool.name({...})` from Python | Generated TS SDK (`tools.name(...)`) |
| Snapshot & restore | Full-namespace `dill` snapshots | Stateless between runs |
| Delegation | Native upstream tools, directly bound | Native upstream tools |

---

## 🔒 Security Model

- **Tool Governance**: calls to `tool.*` run through `dsh`'s host tool pipeline, where approval and sandbox policies
  apply normally.
- **Kernel Code Execution**: Python code inside cells executes with the permissions of the local user running `dsh`.
  Run Dashr in environments where you trust the agent's code execution against your user account (or run `dsh` within
  a container).

---

## 📚 Inspiration & Attribution

Dashr is built as an open-source plugin for [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness).

While Dashr's codebase was developed independently from scratch for the `dsh` plugin ecosystem, the core design is
inspired by the pioneering work of **[Prime Agent](https://github.com/primeintellect-ai/prime)** by Prime Intellect —
their **Context as Variables（上下文即变量）** paradigm in particular — and by the recursive-execution research line
(*Recursive Language Models*, [arXiv:2512.24601](https://arxiv.org/abs/2512.24601)).

### ⚖️ License & Compatibility

Both **Dashr** and upstream inspiration **Prime Agent** are licensed under the permissive
**[MIT License](https://opensource.org/licenses/MIT)**. Dashr is fully open-source and license-compliant.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
