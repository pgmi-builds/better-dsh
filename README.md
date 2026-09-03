# Better Dsh — Dashr

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/plugin%20for-dsh-blueviolet.svg?style=flat-square" alt="dsh plugin" /></a>
  <a href="https://npmjs.com/package/better-dsh"><img src="https://img.shields.io/npm/v/better-dsh?style=flat-square&logo=npm" alt="npm package" /></a>
  <a href="https://github.com/pgmi-builds/better-dsh"><img src="https://img.shields.io/badge/github-pgmi--builds%2Fbetter--dsh-black.svg?style=flat-square&logo=github" alt="Repository" /></a>
  <a href="https://github.com/pgmi-builds/better-dsh/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
</p>

**Dashr** (*/ˈdæʃ.ɚ/*) makes your native [`dsh`](https://github.com/deepseek-ai/deepseek-harness) ready for serious coding.

---

## Why

- **$(\text{Tools} \times \text{URL schemas})^{\text{REPL}}$** - a concise, cognitively frictionless setup delivering maximal capacity.
- Universal **Tools** - `read`, `write`, `grep`, `glob`.
- **URL schemas** - `skill://`, `ctx://`, `agent://`, `dvc://`, `dsh://`, an intuitive, unified interface for runtime resources.
- **Persistent REPL Kernel** - IPython (compared with the native ephemeral TS REPL).
- (30+ tools × 5 schemas) ^ REPL free composition = <∞>
- **Context as Variables** - full session transcripts are accessible as variables, even cross compactions.
- **Full Context Revive** — full-namespace `dill` snapshots save and restore kernel state across restarts.

One `eval` call — the formula made concrete:

```json
{ "cell": "
  scout = await agent('agent://ralph', 'graph-analyze this codebase; scout the breaking points to add tests')
  ui    = await read('dvc://browser/127.0.0.1:3080')   # the live web UI as a device
  me    = await read('ctx://transcript')               # this session, as a variable
", "description": "one cell: agents × devices × session" }
```

---

## ✨ Other Features

- **Agent swarm as resources** — sub-agents, workflows, and Ralph loops are first-class calls (`subagent`, `workflow`, `ralph`, `message`).
- **KeepRecency context compactions** - preserve recent relevancy. Resets the default 80% compaction threshold to 50% as "usable" context max.
- A simplistic global LLM-endpoint failover, absent in the native build (a safeguard for long-range, unattended tasks).
- keeps the system prompt to ~3–4K tokens.
- **`dvc://browser`** - browser use ready.
- All `host plane` wired — you do not even see any difference from your `dsh` UI; it just silently fuels up the `dsh` base.
- **iOS PWA Ready** - minor UI twists that make it a decent PWA for iOS `Add to Home Screen`.

## Recommended Companion Plugin(s)

- [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar)
- [`corti`](https://github.com/pgmi-builds/corti) multi-agent memory plugin

---

## ⚡ Quick Install


```bash
dsh plugin --profile web add --config.auto-install-peers=false better-dsh@latest
```

---

## 📚 Inspiration & Attribution

`better-dsh` is an open-source plugin for [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness) (MIT). It stands on the shoulders of earlier open-source work:

- **[BetterEdit](https://github.com/Rianico/dsh-better-edit)** (`dsh-better-edit`, by Rianico) — the hash-anchored `read` → `edit` → `undo_last_edit` editing model. Dashr adopts this toolchain (itself a lineage of `pi-hashline-edit` → `pi-hashline-edit-lsz` → `dsh-better-edit`) with attribution, and re-wires it natively.
- **[omp-agent](https://github.com/can1357/oh-my-pi)** (oh-my-pi, by Can Bölük) — the `dvc://` device framework and its `ast_edit` / `ast_grep` / `browser` / `lsp` devices, adopted under its MIT license.
- **[Prime Agent](https://github.com/primeintellect-ai/prime)** (Prime Intellect) — the *Context as Variables* paradigm that shapes the persistent-kernel model.

All upstream dependencies carry their original MIT licenses, recorded in the source tree.

---

## 📄 License

MIT. See [LICENSE](./LICENSE).
