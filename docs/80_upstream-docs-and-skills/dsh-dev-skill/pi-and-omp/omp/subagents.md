<!--
source: https://omp.sh/docs/subagents
fetched: 2026-09-06
-->

# Subagents & Agent Hub

> Delegate independent work to specialist sessions, watch it happen, and steer or stop each worker without leaving your main conversation.

Subagents let omp split a larger job into focused child sessions. Use them when research, implementation, or review can proceed independently: you get parallel progress and specialist attention while the main session keeps responsibility for integration.

Start by asking in ordinary language. State the outcome, the parts that may run in parallel, and any ownership or safety boundary:

> Parallelize this migration. Give each worker a file-disjoint package, use isolated workspaces for edits, and have the main session integrate and verify the result.

> Use the scout to map every authentication entry point, then use the security-reviewer to check the proposed fix. Do not edit during the research pass.

> Have the designer implement the responsive states while a reviewer checks the existing accessibility behavior. Keep them off the same files.

You do not need to describe omp's internal delegation protocol. The main session chooses the fan-out, gives each worker its assignment, and collects the results.

## When delegation helps

Good candidates have clear boundaries and can make progress without repeatedly asking another worker for unfinished information:

- independent repository research, external API research, or competing investigations;
- file-disjoint implementation across packages or features;
- a specialist pass such as design, code review, or security review;
- mechanical changes that can be divided by directory or generated artifact;
- an independent review after the implementation is complete.

Keep work in the main session when it is a small sequential change, when several steps must continuously modify the same file, or when each decision depends on the previous result. More workers do not make a dependency chain parallel, and overlapping writers create merge risk.

A child session does **not** inherit the main conversation. omp passes the assignment and relevant shared context, while the child can see the allowed workspace and project instructions. When context is easy to miss, say so explicitly:

> Delegate this, but tell every worker that `packages/api/schema.ts` is the source of truth and that generated files must not be edited.

## Choose a specialist

You may name a specialist in your prompt, or let omp choose. The current bundled set is:

| Specialist | Use it for |
| --- | --- |
| `scout` | Fast, read-only repository exploration and compressed findings. |
| `designer` | UI/UX implementation, accessibility, and visual refinement. |
| `reviewer` | Evidence-backed correctness and quality review. |
| `security-reviewer` | Read-only vulnerability discovery and security analysis. |
| `librarian` | Source-verified research into external libraries and APIs. |
| `task` | General multi-step work with the full available capability set. |
| `sonic` | Strictly mechanical edits or data collection that need little reasoning. |

For example: “Use the librarian to verify the upstream retry semantics,” “Ask the reviewer to inspect only the current diff,” or “Use sonic workers to update these file-disjoint fixtures.” Exact custom names are case-sensitive.

Open `/agents` to inspect the available definitions, their source, whether they are enabled, and their model, prewalk, and advisor routing. Use <kbd>Ctrl</kbd>+<kbd>R</kbd> there after changing a definition on disk. To create or customize a specialist, see [Authoring subagents](/docs/subagent-authoring).

If you are unsure whether to change a specialist definition or only the model behind it, see [Agents & model roles](/docs/agents-and-roles).

## What you see while workers run

Background delegation is enabled by default. The main transcript first reports which named workers started, then its task display updates with live activity. Completed results are delivered back into the main conversation; the main agent can summarize them, reconcile disagreements, and continue the job. `/jobs` prints a compact snapshot of background jobs, but Agent Hub is the detailed view.

Press <kbd>Alt</kbd>+<kbd>A</kbd> to open **Agent Hub**. <kbd>Ctrl</kbd>+<kbd>S</kbd> opens the same view through the legacy session-observe binding. From an empty main editor, double-tapping <kbd>←</kbd> also opens it when the session has an agent to show. Run `/hotkeys` to confirm or remap the active chords.

Each roster row shows a worker's status, assignment or current activity, model, age, token and request usage, tool-call count, active time, and cost when that data is available. The inspector adds the current tool, retry state, context-window usage, parent/child lineage, and any isolated-workspace patch or branch information. Press <kbd>t</kbd> to switch between a flat roster and the parent/child tree.

| Control | Action |
| --- | --- |
| <kbd>j</kbd>/<kbd>k</kbd>, arrows, or wheel | Select a worker. |
| <kbd>Enter</kbd> or click | Open its live or persisted transcript. Opening a parked worker revives it when possible. |
| <kbd>Tab</kbd> | Show or hide the inspector on a narrow terminal. |
| <kbd>PageUp</kbd>/<kbd>PageDown</kbd> | Scroll the inspector. |
| <kbd>r</kbd> | Revive the selected parked worker. |
| <kbd>x</kbd> | Abort if necessary, then kill and release the worker. This is immediate. |
| <kbd>Esc</kbd> | Close the inspector, then Agent Hub. |

Statuses have distinct meanings:

- **running** — the worker is in an active turn;
- **idle** — its turn finished, but its live session is still in memory for a follow-up;
- **parked** — its session was saved to disk and can usually be revived;
- **aborted** — it was stopped and is terminal, though its transcript remains available.

Finished workers remain associated with the session. After resuming that session, Agent Hub discovers their persisted transcripts and restores their lineage.

## Read, steer, follow up, or stop

Open a worker from Agent Hub to focus its session. You can read its transcript and current tool activity, then type a normal message and press <kbd>Enter</kbd>:

> Stop changing the API package. Finish only the client tests and report what remains.

> Before you conclude, compare your finding with the generated schema and cite both files.

A message to a running worker is steering and lands at a safe step boundary; a message to an idle worker starts a follow-up; a message to a parked worker revives it first. With an empty editor, press <kbd>Esc</kbd> or double-tap <kbd>←</kbd> to return to the main session. Returning does not interrupt the worker.

Prefer a follow-up to the same worker when it already has the right context. Use <kbd>x</kbd> when its work is unsafe, out of scope, stuck, or no longer useful. Killing releases that worker instance, so start a new worker if more work is needed later.

## Shared checkout or isolated workspace

By default, subagents work in the same checkout as the main session. That is fast and lets everyone see current changes, but concurrent writers can overwrite assumptions or produce interleaved edits. Give non-isolated workers file-disjoint ownership and keep final integration in one place.

For stronger edit separation, open `/settings`, choose the **Tasks → Isolation** group, and set **Isolation Mode** to **Auto**. Then ask for it directly:

> Run the three implementation workers in isolated workspaces. Apply only successful changes and have the main session resolve integration conflicts.

An isolated worker receives a filesystem clone or overlay selected for the platform. omp captures its changes and integrates them with the configured patch or branch strategy. Isolation requires a Git repository. The managed workspace normally lives under `~/.omp/wt`; `worktree.base` changes that location. With the defaults, successful changes are applied to the parent checkout as a patch.

Isolation protects concurrent checkout edits; it is **not** a general security sandbox. A worker may still run commands, use networked tools, or affect external services allowed by its tool set and credentials. Isolated workers also cannot be revived after completion because their temporary workspace has been torn down; their transcript and patch metadata remain inspectable.

Even isolated edits can conflict when integrated, especially when workers touch the same lines. Divide ownership first, review the resulting diff, and ask the main session to verify the combined behavior.

## Cost, safety, and limits

Every worker is a separate model session, so parallelism can multiply token use, provider requests, and cost. Agent Hub shows measured per-worker and aggregate usage. Start with the smallest useful fan-out, use `scout` or `sonic` only for work suited to them, and stop workers whose assignments have become obsolete. Advisor and prewalk routing may add model calls of their own.

Subagents run headlessly and cannot pause for an interactive per-tool approval. Treat each assignment as delegated authority: restrict its scope, choose a read-only specialist where possible, avoid handing unrelated secrets or production operations to a worker, and supervise external side effects. Workspace isolation does not protect remote accounts or services.

The important defaults are:

| Setting | Default | Effect |
| --- | --- | --- |
| `async.enabled` | `true` | Let ordinary workers continue in the background. |
| `task.maxConcurrency` | `32` | Bound concurrently running workers; additional work queues. `0` is unlimited. |
| `task.maxRecursionDepth` | `2` | Limit how deeply workers may delegate again. |
| `task.softRequestBudget` | `200` | Ask a long-running worker to wrap up, then force a partial result at 1.5× the budget. `0` disables it. |
| `task.maxRuntimeMs` | `0` | Hard per-worker wall-clock limit; `0` means no limit. |
| `task.agentIdleTtlMs` | `420000` | Park an idle worker after seven minutes; `0` keeps it live until exit. |
| `task.isolation.mode` | `none` | Enable isolated workspaces with `auto` or a specific backend. |
| `task.isolation.apply` | `true` | Apply successful isolated changes to the parent checkout. |
| `task.isolation.merge` | `patch` | Integrate isolated changes as patches rather than branches. |

Use `/settings` for these controls and `/agents` for per-agent enablement and model routing. See [Settings](/docs/settings) for editing `~/.omp/agent/config.yml` directly.

## Troubleshooting

**omp keeps the work in the main session.** Ask explicitly: “Parallelize this with three file-disjoint workers,” or name the specialist. In `/settings`, **Prefer Task Delegation** can be changed from `default` to `preferred` or `always` when you want more aggressive delegation.

**A named specialist is unknown or unavailable.** Open `/agents`, check the exact case-sensitive name, scope, and enabled state, then press <kbd>Ctrl</kbd>+<kbd>R</kbd> to reload definitions. A project definition takes precedence over a user or bundled definition with the same name.

**A worker stays queued.** Running workers have reached `task.maxConcurrency`, or the model provider is rate-limiting requests. Reduce the fan-out, wait for a slot, or raise the limit cautiously.

**Workers produce conflicting edits.** Stop overlapping writers, give each worker file-disjoint ownership, and retry with isolation enabled. Isolation reduces live-checkout interference but does not make overlapping patches merge cleanly.

**Isolation is unavailable.** Confirm `task.isolation.mode` is not `none` and that omp is running in a Git repository. Isolation is not available in plan mode, which keeps delegated work read-only. If automatic integration fails, inspect the patch or branch information in Agent Hub before applying anything manually.

**A finished worker cannot be revived.** Isolated workers are intentionally non-revivable after teardown, and killed or hard-aborted workers are terminal. Start a new worker with the old result summarized in its prompt. Ordinary parked workers can be revived with <kbd>r</kbd> or by opening and messaging them.

**The result is partial or stopped.** Check the transcript for a soft request-budget notice, wall-clock timeout, provider error, or manual abort. Narrow the remaining assignment and follow up with the same ordinary worker when it is idle or parked; otherwise start a replacement.

**Agent Hub appears empty.** It shows workers belonging to the current session. Resume the session that created them, or start a delegated task here. `/jobs` may still show recent background process records, but it is not a replacement for the worker transcript.
