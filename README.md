# Better Dsh — Dashr

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/plugin%20for-dsh-blueviolet.svg?style=flat-square" alt="dsh plugin" /></a>
  <a href="https://npmjs.com/package/@pgmi-builds/better-dsh"><img src="https://img.shields.io/badge/npm-%40pgmi--builds%2Fbetter--dsh-CB3837.svg?style=flat-square&logo=npm" alt="npm package" /></a>
  <a href="https://github.com/pgmi-builds/better-dsh"><img src="https://img.shields.io/badge/github-pgmi--builds%2Fbetter--dsh-black.svg?style=flat-square&logo=github" alt="Repository" /></a>
  <a href="https://github.com/pgmi-builds/better-dsh/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
</p>

**Dashr** (*/ˈdæʃ.ɚ/*) makes your native [`dsh`](https://github.com/deepseek-ai/deepseek-harness) ready for serious coding. It's a plugin — not a fork — so you keep the official runtime and marketplace, and gain a lighter, higher-capacity way to work.

---

## Why

1. **Make your native `dsh` ready for serious coding** — keep the official DeepSeek Harness, add the pieces that turn it into a real development environment.
2. **Light context injection, maximal capacity** — state lives in the kernel instead of the chat window, so long tasks stop paying token costs to re-derive what already exists. *A cognition-frictionless setup.*

---

## ✨ Features

- 🐍 **Session-persistent IPython kernel** — better than the native one-shot REPL engine: one kernel per session, where variables, imports, and definitions survive across turns. *Context as variables.*
- 🔗 **Unified `scheme://` addressing** — one intuitive interface to runtime resources: `skill://`, `ctx://`, `agent://`, `dvc://`, `dsh://` (plus `http(s)://`).
- 🧰 **Wired-in IDE** — LSP diagnostics on write/edit, AST codemods (`ast_edit` / `ast_grep`), and hash-anchored `edit` / `undo_last_edit` with write previews.
- 🤝 **Agent swarm as resources** — sub-agents, workflows, and Ralph loops are first-class calls inside a cell (`subagent`, `workflow`, `ralph`, `send_message`).
- 💾 **Snapshots** — full-namespace `dill` snapshots save and restore kernel state across restarts.
- 🛡️ **Self-managed kernel environment** — the runtime provisions its own CPython 3.11 venv (`ipykernel` + `dill`); no blind trust in a host `python3`.

---

## ⚡ Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/pgmi-builds/better-dsh/main/install.sh | bash
```

Or via npm:

```bash
dsh plugin --profile web add --config.auto-install-peers=false @pgmi-builds/better-dsh@latest
```

> Code inside a cell runs with the permissions of the local user running `dsh` — run Dashr where you trust the agent's code execution (or inside a container).

---

## 📚 Inspiration & Attribution

Dashr is an open-source plugin for [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) (MIT). It stands on the shoulders of earlier open-source work:

- **[BetaEdit](https://github.com/Rianico/dsh-better-edit)** (`dsh-better-edit`, by Rianico) — the hash-anchored `read` → `edit` → `undo_last_edit` editing model. Dashr adopts this toolchain (itself a lineage of `pi-hashline-edit` → `pi-hashline-edit-lsz` → `dsh-better-edit`) with attribution, and re-wires it natively.
- **[omp-agent](https://github.com/can1357/oh-my-pi)** (oh-my-pi, by Can Bölük) — the `dvc://` device framework and its `ast_edit` / `ast_grep` / `browser` / `lsp` devices, adopted under its MIT license.
- **[Prime Agent](https://github.com/primeintellect-ai/prime)** (Prime Intellect) — the *Context as Variables* paradigm that shapes the persistent-kernel model.

All upstream dependencies carry their original MIT licenses, recorded in the source tree.

---

## 📄 License

MIT. See [LICENSE](./LICENSE).
