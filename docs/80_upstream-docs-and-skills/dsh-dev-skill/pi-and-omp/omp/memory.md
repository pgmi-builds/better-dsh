<!--
source: https://omp.sh/docs/memory
fetched: 2026-09-06
-->

# Memory

> Carry durable preferences, decisions, and project knowledge into later sessions. Memory is off by default; choose a local or remote backend, control its scope, and inspect or clear what it contributes.

Memory helps omp continue work without making you restate durable facts such as repository conventions, architectural decisions, and review preferences. It is separate from [compaction](/docs/compaction): compaction shortens one session, while memory can affect future sessions.

Memory is **off by default**. If you want it, open `/settings`, select the **Memory** tab, and choose one backend. Start with `mnemopi` for searchable memory stored on this machine, `local` for automatic project summaries, or `hindsight` when you already operate a Hindsight service.

## Choose a backend

| Backend | Use it when | Storage and default scope | Important trade-off |
| --- | --- | --- | --- |
| `off` (default) | You do not want cross-session knowledge. | No memory store. | Existing session transcripts are unaffected; turning memory off does not delete them. |
| `local` | You want omp to periodically distill past persisted sessions into project guidance. | Generated files on this machine, isolated by working directory. | It is a batch summary pipeline, not a searchable store. You cannot review or forget one structured fact. |
| `mnemopi` | You want prompt-driven remember, recall, and forget behavior without a memory server. | Local SQLite databases; `per-project` by default. | The database is local, but the default `smol` LLM mode can send extraction work to your configured model provider. |
| `hindsight` | You want a remote bank, shared infrastructure, or Hindsight's synthesis and mental models. | Your Hindsight server; `per-project-tagged` by default. | Automatic retention is on by default, so conversation text leaves the machine. |

The smallest persistent setup from a shell is:

```bash
# Pick exactly one
omp config set memory.backend local
omp config set memory.backend mnemopi
omp config set memory.backend hindsight

# Confirm the effective setting
omp config get memory.backend
```

`/settings` writes the global config and switches the active backend when you save it. Shell or YAML changes apply to new omp processes. For one repository only, put the same keys in `<repo>/.omp/config.yml`; project settings override the global file. See [Settings](/docs/settings) for paths and precedence.

## Privacy, scope, and defaults

Enabling memory changes what persists and, depending on the backend, what may cross a network boundary.

- **Off means no memory processing.** It does not disable ordinary session persistence. Memory commands also do not erase files under `~/.omp/agent/sessions/`; manage those separately through [Sessions](/docs/sessions).
- **Local stores generated artifacts locally**, under `~/.omp/agent/memories/<encoded-project>/` by default. Its extraction and consolidation passes use your configured model roles, so past session text can still be sent to that model provider. Generated outputs are filtered for common token and secret patterns, but do not intentionally ask omp to remember secrets.
- **Mnemopi stores its SQLite banks locally**, under `~/.omp/agent/memories/mnemopi/` by default. Local embeddings may download and run an embedding model. Its default `llmMode: smol` uses your configured online `tiny`/`smol` model for LLM-backed extraction; use `llmMode: none` when you want no LLM-backed memory processing.
- **Hindsight stores durable memory on the configured server.** With `autoRetain: true` (the default), omp sends user and assistant text every three user turns and at session boundaries. It omits tool calls, tool results, and thinking blocks. Recall and synthesis queries also go to that server.
- **Turning a backend off does not delete its store.** This makes switching reversible, but you must clear or delete data separately when removal is the goal.

Choose scope before accumulating sensitive data:

| Scope | Mnemopi | Hindsight |
| --- | --- | --- |
| `global` | One local bank is visible in every project. | One remote bank is visible in every project. |
| `per-project` | One isolated bank derived from the absolute working directory. This is the default. | One isolated bank per repository name (or cwd name outside Git). Linked worktrees of one repository share the primary checkout's name. |
| `per-project-tagged` | Writes to the project bank; recall combines it with the shared global bank. | Writes project-tagged data to one shared bank; recall combines that project's tagged memories with untagged global memories. This is the default. |

For client work or other hard boundaries, prefer `per-project`. `per-project-tagged` is convenient, but intentionally makes untagged global knowledge visible alongside project knowledge.

## Use memory in conversation

With Mnemopi or Hindsight enabled, use ordinary prompts. You do not need to know how omp performs the memory operation.

```text
Remember that this repository uses pnpm and Node 22.
```

```text
Before changing authentication, recall why we rejected session cookies.
```

```text
What durable preferences have you learned about how I review pull requests?
```

Mnemopi can also edit, forget, or invalidate an editable memory:

```text
Forget the memory that says releases happen on Fridays; that policy was retired.
```

```text
Update the stored release convention to say that releases happen after CI is green.
```

Ask omp to show the candidate memory before changing it when the description could match more than one entry. Mnemopi's extracted fact-table rows are read-only; the prompt should identify an editable memory, or you can clear the scoped bank when complete removal is required. Hindsight does not expose individual record editing through omp; use the Hindsight service's UI for record-level review or deletion.

The local backend works differently. It automatically summarizes eligible persisted sessions and injects a static **Memory Guidance** block at startup. A request such as “remember this” is not a guaranteed individual write. Its best use is allowing recurring project knowledge to emerge from completed work.

Recalled or summarized memory is background context, not an instruction. Current prompts and current repository state take precedence when they conflict with it.

## What you can inspect and control

Run these slash commands in a session:

| Command | Visible result |
| --- | --- |
| `/memory` or `/memory view` | Opens the current memory injection payload. An empty warning means the backend is off, unavailable, or has not recalled/generated anything yet. |
| `/memory stats` | Shows backend statistics when the active backend supports them. |
| `/memory diagnose` | Shows backend-specific diagnostics when supported. |
| `/memory enqueue` | Requests the active backend's stronger maintenance/retention action; details differ by backend below. |
| `/memory clear` | Clears what the active backend can clear. Hindsight is an important exception: the remote bank is not deleted. |

`/memory reset` is an alias for `clear`; `/memory rebuild` is an alias for `enqueue`.

### What enqueue and clear mean

| Backend | `/memory enqueue` | `/memory clear` |
| --- | --- | --- |
| Local | Marks consolidation work for the next startup. It does not rebuild the guidance panel immediately. | Removes this project's generated artifacts and resets the local pipeline's shared extraction/consolidation index. It does not delete session transcripts. |
| Mnemopi | Forces current-session retention, drains pending extraction, and consolidates eligible working memories. Fresh rows are not promoted until they pass Mnemopi's age gate (12 hours with the default 24-hour working-memory lifetime). | Deletes the SQLite databases and WAL/SHM sidecars for the active scope, then starts an empty backend again. |
| Hindsight | Flushes queued writes and forces retention of the current session. | Flushes pending writes, then clears the local recall state for this session only. It does **not** delete server-side memories or the bank; use the Hindsight UI to do that. |

### Review local generated files

The local backend keeps readable generated artifacts below `~/.omp/agent/memories/<encoded-project>/`:

- `memory_summary.md` — compact guidance shown by `/memory view` and injected at startup
- `MEMORY.md` — the longer consolidated project memory
- `learned.md` — explicitly captured lessons when optional auto-learn is enabled
- `skills/` — generated procedural playbooks

These are generated files, not the source session history. Editing them is not a durable workflow because later consolidation can replace them. Clear stale output and enqueue a rebuild instead.

### Manage Hindsight mental models

Hindsight mental models are curated summaries such as user preferences, project conventions, and project decisions. They are enabled and automatically seeded by default. In the interactive TUI, use:

| Command | Effect |
| --- | --- |
| `/memory mm list` | List models in the active bank. |
| `/memory mm show <id>` | Show one model. |
| `/memory mm refresh [id]` | Refresh one model, or all auto-refresh models when no id is supplied. |
| `/memory mm history <id>` | Show that model's revision history as a diff. |
| `/memory mm seed` | Create any missing built-in models. |
| `/memory mm delete <id>` | Delete one mental model. This does not delete its source memories. |
| `/memory mm reload` | Reload the mental-model block used by the current session. |

Mental-model commands are TUI-only and require an active Hindsight backend. They are not Mnemopi controls.

## Configure the local backend

Minimal global YAML in `~/.omp/agent/config.yml`:

```yaml
memory:
  backend: local
```

The pipeline starts in the background when omp starts. It skips subagents and sessions that were not persisted. By default, it ignores sessions still active within the last 12 hours and sessions older than 30 days, so a newly enabled backend may initially show an empty payload. Per-session extraction uses the `default` model role; consolidation uses `smol` with fallbacks.

| Setting | Default | Purpose |
| --- | --- | --- |
| `memories.maxRolloutAgeDays` | `30` | Ignore sessions older than this. |
| `memories.minRolloutIdleHours` | `12` | Ignore sessions active more recently than this. |
| `memories.maxRolloutsPerStartup` | `64` | Maximum sessions processed at one startup. |
| `memories.threadScanLimit` | `300` | Maximum recent session records scanned. |
| `memories.maxRawMemoriesForGlobal` | `200` | Maximum extracted session memories passed to consolidation. |
| `memories.stage1Concurrency` | `8` | Concurrent per-session extraction jobs. |
| `memories.stage1LeaseSeconds` | `120` | Extraction job lease. |
| `memories.stage1RetryDelaySeconds` | `120` | Delay before retrying failed extraction. |
| `memories.phase2LeaseSeconds` | `180` | Consolidation job lease. |
| `memories.phase2RetryDelaySeconds` | `180` | Delay before retrying failed consolidation. |
| `memories.phase2HeartbeatSeconds` | `30` | Consolidation lease heartbeat. |
| `memories.rolloutPayloadPercent` | `0.7` | Fraction of the model context budget available to session payloads. |
| `memories.phase1InputTokenLimit` | `4000` | Per-session extraction input cap. |
| `memories.fallbackTokenLimit` | `16000` | Fallback budget when a model has no finite declared context window. |
| `memories.summaryInjectionTokenLimit` | `5000` | Shared approximate cap for summary and captured lessons injected at startup. |

Optional `autolearn.enabled: true` lets omp capture explicit lessons into `learned.md`; it is experimental and off by default. `autolearn.autoContinue` is also false by default and controls whether omp runs a private capture turn after stopping.

## Configure Mnemopi

The defaults are enough for a project-isolated local bank:

```yaml
memory:
  backend: mnemopi
```

A privacy-oriented FTS-only setup that avoids LLM-backed extraction is:

```yaml
memory:
  backend: mnemopi
mnemopi:
  scoping: per-project
  noEmbeddings: true
  llmMode: none
```

### Storage, scope, and automation

| Setting | Default | Purpose |
| --- | --- | --- |
| `mnemopi.dbPath` | Agent memories directory | Optional SQLite path. |
| `mnemopi.bank` | Unset (`default`) | Shared bank base name; project scopes derive a project bank from it. |
| `mnemopi.scoping` | `per-project` | `global`, `per-project`, or `per-project-tagged`. |
| `mnemopi.autoRecall` | `true` | Recall into the first turn of a session. |
| `mnemopi.autoRetain` | `true` | Retain completed conversation turns automatically. |
| `mnemopi.retainEveryNTurns` | `4` | Minimum user turns between automatic writes. |
| `mnemopi.recallLimit` | `8` | Maximum memories included in recalled context. |
| `mnemopi.recallContextTurns` | `3` | Prior user-bounded turns included in a recall query. |
| `mnemopi.recallMaxQueryChars` | `4000` | Maximum composed recall query length. |
| `mnemopi.injectionTokenLimit` | `5000` | Approximate memory context budget. |

### Retrieval, embeddings, and LLM processing

| Setting | Default | Purpose |
| --- | --- | --- |
| `mnemopi.polyphonicRecall` | `false` | Combine vector, graph, fact, and temporal recall. |
| `mnemopi.enhancedRecall` | `false` | Cache repeated and similar recall queries. |
| `mnemopi.proactiveLinking` | `false` | Link new memories to related graph entities and memories. |
| `mnemopi.noEmbeddings` | `false` | Use deterministic full-text search only. |
| `mnemopi.embeddingVariant` | `en` | Local model family: `en` or `multilingual`. Changing it rebuilds embeddings on the next writable start. |
| `mnemopi.embeddingModel` | Variant default | Explicit embedding model id; overrides the variant. |
| `mnemopi.embeddingApiUrl` | Environment/default | Optional OpenAI-compatible embedding endpoint. |
| `mnemopi.embeddingApiKey` | Environment/default | Credential for that embedding endpoint. |
| `mnemopi.llmMode` | `smol` | `smol` uses the configured `tiny`/`smol` role, `remote` uses the endpoint below, and `none` disables LLM calls. |
| `mnemopi.llmBaseUrl` | Environment/default | OpenAI-compatible LLM endpoint for `remote` mode. |
| `mnemopi.llmApiKey` | Environment/default | Credential for the remote LLM. |
| `mnemopi.llmModel` | Environment/default | Remote LLM model id. |
| `mnemopi.debug` | `false` | Enable backend debug logging. |

## Configure Hindsight

Run a reachable [Hindsight](https://hindsight.vectorize.io/) server first. The built-in URL is `http://localhost:8888`, so a local unauthenticated server needs only:

```yaml
memory:
  backend: hindsight
```

For Hindsight Cloud or an authenticated deployment:

```yaml
memory:
  backend: hindsight
hindsight:
  apiUrl: https://api.hindsight.vectorize.io
  scoping: per-project
```

Keep the token outside the file when possible:

```bash
export HINDSIGHT_API_TOKEN='replace-me'
omp
```

`HINDSIGHT_*` environment variables override matching `hindsight.*` settings. See [Environment variables](/docs/env) for the override names and parsing rules.

### Connection, banks, and retention

| Setting | Default | Purpose |
| --- | --- | --- |
| `hindsight.apiUrl` | `http://localhost:8888` | Cloud or self-hosted server URL. |
| `hindsight.apiToken` | Unset | Bearer token for authenticated servers. |
| `hindsight.bankId` | `omp` | Base bank id. In `per-project` mode the project name is appended. |
| `hindsight.bankIdPrefix` | Unset | Optional prefix added before the base bank id. |
| `hindsight.scoping` | `per-project-tagged` | `global`, `per-project`, or `per-project-tagged`. |
| `hindsight.bankMission` | Unset | Optional mission applied when omp creates the bank. |
| `hindsight.retainMission` | Unset | Optional instruction for retention. |
| `hindsight.autoRecall` | `true` | Recall before the first model turn. |
| `hindsight.autoRetain` | `true` | Retain transcript text on cadence and at session boundaries. Set false for prompt-driven writes only. |
| `hindsight.retainMode` | `full-session` | `full-session` upserts one session document; `last-turn` stores turn-bounded chunks. |
| `hindsight.retainEveryNTurns` | `3` | User turns between automatic retention. |
| `hindsight.retainOverlapTurns` | `2` | Overlap between retained chunks in `last-turn` mode. |
| `hindsight.retainContext` | `omp` | Context label sent with retained data. |

### Recall, mental models, and timeouts

| Setting | Default | Purpose |
| --- | --- | --- |
| `hindsight.recallBudget` | `mid` | Recall effort: `low`, `mid`, or `high`. |
| `hindsight.recallMaxTokens` | `1024` | Maximum recalled tokens. |
| `hindsight.recallContextTurns` | `1` | Prior user-bounded turns included in recall queries. |
| `hindsight.recallMaxQueryChars` | `800` | Maximum recall query length. |
| `hindsight.recallTypes` | `["world", "experience"]` | Hindsight memory types eligible for recall. |
| `hindsight.mentalModelsEnabled` | `true` | Load curated mental models into new sessions. |
| `hindsight.mentalModelAutoSeed` | `true` | Create missing built-in user-preference, project-convention, and project-decision models at startup. |
| `hindsight.mentalModelRefreshIntervalMs` | `300000` | Refresh interval for eligible mental models. |
| `hindsight.mentalModelMaxRenderChars` | `16000` | Maximum rendered mental-model text. |
| `hindsight.requestTimeoutMs` | `30000` | Default request deadline. |
| `hindsight.recallTimeoutMs` | `30000` | Recall deadline. |
| `hindsight.retainTimeoutMs` | `60000` | Retention deadline. |
| `hindsight.reflectTimeoutMs` | `120000` | Synthesis deadline. |
| `hindsight.debug` | `false` | Enable request and backend debug logging. |

## Troubleshooting

**`/memory view` is empty after enabling local memory.** Local memory only processes persisted primary sessions, skips sessions active within the last 12 hours by default, and performs maintenance at startup. Run `/memory enqueue`, exit normally, and start omp again after eligible sessions exist. Also make sure the `default` and `smol` model roles have usable credentials.

**Mnemopi is enabled but does not remember or recall.** Run `/memory diagnose` and `/memory stats`. Startup is best-effort: a database, embedding-model, or LLM initialization failure leaves the coding session usable but memory inert. Try `mnemopi.noEmbeddings: true` to isolate embedding problems, and use `mnemopi.llmMode: none` to isolate LLM configuration.

**Hindsight is enabled but nothing appears.** Confirm the effective backend and endpoint:

```bash
omp config get memory.backend
omp config get hindsight.apiUrl
```

Then run `/memory diagnose`. Check that the server is reachable and that `HINDSIGHT_API_TOKEN` or `hindsight.apiToken` is valid. Request failures do not stop the coding session; enable `hindsight.debug` when you need backend logs.

**One project sees knowledge from another.** Check `mnemopi.scoping` or `hindsight.scoping`. Switch to `per-project` for isolation, then clear the old local banks or remove the old Hindsight bank/data separately; changing scope does not erase previously stored knowledge.

**Memory is stale.** Ask omp to verify it against the current repository. For one Mnemopi fact, ask to update or forget it. For local summaries, use `/memory clear` followed by `/memory enqueue` and a later restart. For Hindsight, remove or correct the remote record in Hindsight; `/memory clear` only clears the current session's local recall state.

See [Compaction](/docs/compaction) for in-session context management and [Settings](/docs/settings) for config locations, project overrides, and precedence.
