<!--
source: https://omp.sh/docs/vibe
fetched: 2026-09-06
-->

# Vibe mode

> Turn one omp session into a director that coordinates persistent fast and strong coding workers, checks their work, and keeps each workstream moving.

## Direct several workers from one conversation

Vibe mode is for work that benefits from delegation: a feature with independent frontend and backend changes, a migration plus review, or a large cleanup that can be split into file-disjoint workstreams. Your main omp session becomes a **director**. It reads and verifies the repository, while persistent workers search, edit, run commands, and build.

Start with the task in the same command:

```text
/vibe Split this release into independent workstreams. Have a fast worker update the mechanical call sites and a good worker review the migration and compatibility risks. Verify both before reporting done.
```

Or enter first and describe the work next:

```text
/vibe
```

The status line shows **Vibe** while the mode is active. Run `/vibe` again when you are ready to leave; omp stops the remaining workers and restores the tools that were enabled before you entered.

Vibe mode adds coordination, model usage, and supervision overhead. For a small sequential edit, an ordinary omp prompt is usually simpler.

## Choose `fast` or `good`

You do not launch a separate terminal or provide a machine-readable request. Tell the director which kind of worker you want in ordinary language:

| Worker | Best for | Typical instruction |
| --- | --- | --- |
| `fast` | Mechanical, well-specified, high-volume work: renames, straightforward tests, boilerplate, data collection, and applying an already-decided pattern. | “Use a fast worker to update every caller in `packages/ui`; do not change the public API.” |
| `good` | Design, debugging, review, risky changes, multi-file refactors, and work where judgment matters more than latency. | “Use a good worker to trace the race, propose the smallest source fix, and verify it with the existing reproduction.” |

A fast worker is not merely a lower-priority job: it normally uses your small, low-latency model role. A good worker normally uses your task/strong model path. If a fast worker stalls or encounters an architectural decision, ask the director to hand the decision or review to a good worker rather than repeatedly restarting the same work.

Each worker has its own conversation and remembers follow-up instructions. Keep one worker on one workstream so that context remains useful. Workers start without the director conversation, so the director must give each one a self-contained brief.

## Give workstreams that can succeed independently

A useful first prompt names ownership, boundaries, and proof:

```text
Coordinate these in parallel:

1. Fast worker: own `packages/parser/src/` and update the mechanical API call sites. Preserve behavior and run the parser's focused tests.
2. Good worker: own `packages/server/src/` and design the compatibility change. Do not edit parser files. Exercise the failing request after the fix.
3. When both finish, read their changed files, check that the contracts agree, and have the good worker review the integration.

Do not let both workers edit the same file. Stop and ask me if the shared interface must change.
```

Include these details whenever they matter:

- the files or subsystem the worker owns;
- the outcome and observable acceptance criteria;
- APIs, formats, or behavior that must not change;
- commands or scenarios that prove the result;
- explicit non-goals and safety boundaries;
- the contract another workstream will consume.

Parallel workers share the same working tree unless the director selects another supported isolation strategy. Two workers editing the same file can overwrite or conflict with one another. Prefer file-disjoint ownership, decide shared interfaces before dispatch, and designate one worker to integrate any unavoidable shared file.

## Supervise the work

You can continue talking to the director while workers run. Dispatch is asynchronous: the director can start another independent workstream instead of waiting for the first one.

Useful prompts include:

```text
Show me every Vibe worker, its fast/good tier, current state, model, queued follow-ups, and latest activity.
```

```text
Steer the parser worker now: preserve the legacy error code and add a boundary case before continuing.
```

```text
When the server worker becomes idle, ask it to review the parser worker's final diff. Keep it in the same worker session.
```

```text
Stop the docs worker; that workstream is no longer needed.
```

A correction sent during active work is steered into the running turn when possible. If the worker cannot accept it immediately, omp queues it as the next turn. An idle worker starts a new turn with the follow-up. You do not need to decide which delivery case applies.

Worker results return to the director conversation automatically. The visible worker view distinguishes workers that are starting, running, idle, or dead and includes their tier, turn count, queued work, resolved model, and recent activity. Completed turns also show activity and timing. Ask for the roster again whenever worker names or states are unclear.

Do not treat “worker finished” as “task verified.” Ask the director to:

1. read the files the worker says it changed;
2. compare the result with your original constraints;
3. resolve cross-workstream assumptions;
4. send corrections back to the same worker;
5. run or delegate the acceptance scenario before reporting completion.

The director deliberately has a read-oriented toolset in Vibe mode. It verifies and coordinates; workers perform mutations and command execution.

## Stop work and leave safely

There are three different controls:

- **Steer one worker:** describe the correction and identify the worker or workstream. Its persistent conversation is retained.
- **Stop one worker:** say “stop the `<name>` worker.” Its active turn and queued follow-ups are cancelled, but other workers continue.
- **Exit the mode:** run `/vibe`. omp aborts the director's active turn if necessary, stops every remaining Vibe worker, records them as terminal, removes Vibe-only controls, and restores the exact pre-Vibe toolset.

Exiting is the safe completion boundary. Do not simply assume idle workers are gone: idle means ready for another turn, not terminated. Conversely, an intentional `/vibe` exit is final for that worker scope; re-entering starts new workers rather than reviving workers that were killed on exit.

If you interrupt the current director response, Vibe mode itself remains on. Check the **Vibe** status indicator, ask for the worker roster, then either continue supervision or run `/vibe` to perform the full teardown.

## Persistence, resume, and session changes

Vibe mode and worker lifecycle records are stored with the parent session. When you reopen a saved session whose current mode is Vibe:

- completed worker conversations return as idle/parked workers with their child transcripts;
- the director can continue those workers with another natural-language instruction;
- work that was actively running when the process stopped is marked as interrupted and is **not** restarted automatically;
- workers explicitly stopped, or stopped by an intentional Vibe exit, remain terminal.

After a restart, begin with:

```text
List the restored Vibe workers. Summarize their last completed work, identify any turn interrupted by the restart, and wait for my approval before continuing it.
```

Session switching quiesces the current session's Vibe workers and restores the destination session's recorded mode and worker scope when applicable. However, operations that create or structurally relocate a session are blocked while Vibe is active: starting a new session, forking, moving, and handing off require you to run `/vibe` first. This prevents workers from becoming detached from the parent session that owns them.

Plan mode and Goal mode are mutually exclusive with Vibe mode, including when Plan or Goal is paused. Exit the existing mode before `/vibe`; exit Vibe before entering `/plan` or `/goal`. Reset-style loops are also unavailable while Vibe is active.

## Models and cost

Fast and good workers make independent model requests, so concurrent workers can spend tokens at the same time. Their costs are additional to the director's model usage. Use fewer persistent workers for tightly coupled work, stop finished workers, and reserve good workers for design or review when a fast worker is sufficient.

The defaults follow omp's normal worker routing:

- `fast` uses the bundled `sonic` worker and normally resolves through the small-model role;
- `good` uses the bundled `task` worker and normally resolves through the task role or the active/default model fallback.

Set concrete selectors in roles and route the two worker definitions to them in [`~/.omp/agent/config.yml`](/docs/settings):

```yaml
modelRoles:
  fast_worker: openai/gpt-5-mini
  good_worker: anthropic/claude-sonnet-4-5:high

task:
  agentModelOverrides:
    sonic: "@fast_worker"
    task: "@good_worker"
```

This keeps the user-facing `fast` and `good` choices stable while allowing you to change providers or models in one place. Normal retry and fallback settings apply to worker requests. Ask the director to show the resolved model when routing is surprising. Use `/stats` to inspect session and worker costs after or during a run; `/usage` reports provider account limits rather than the cost of an individual Vibe workstream.

## Safety and permissions

Workers are full coding agents: they may read and write files, run commands, and use other enabled capabilities needed by their brief. The director's read-only posture does not make the workers read-only.

A worker runs headlessly after dispatch, so do not rely on an interactive confirmation appearing for every command it executes. Your configured per-tool policies still apply. Use explicit `deny` policies for capabilities a worker must never use, keep credentials and sensitive paths outside its scope, and give the prompt its own boundaries. See [Settings](/docs/settings) for `tools.approval` and approval modes.

Before using Vibe on sensitive code:

- choose models and providers approved to receive the repository content;
- split access by workstream and avoid unnecessary secrets in prompts;
- deny dangerous tools or command classes in configuration rather than relying only on prose;
- require focused verification and a final director read-through;
- stop a worker immediately if its activity or output no longer matches the brief.

Starting several workers increases both the number of actors that can mutate the tree and the chance of overlapping edits. Commit or otherwise preserve important work before a high-concurrency run, but do not ask multiple workers to manipulate the same Git state concurrently.

## Troubleshooting

- **`/vibe` says to exit Plan or Goal first** — this includes paused modes. Exit that mode completely, then run `/vibe` again.
- **The Vibe indicator is on, but no work starts** — give the director an explicit workstream, tier, files, constraints, and acceptance check. If dispatch needs authorization under your approval mode, approve or deny the visible request.
- **A worker uses the wrong model** — ask for the resolved worker models. Check `task.agentModelOverrides.sonic` for fast and `.task` for good, then confirm every referenced `modelRoles` selector exists, its provider is enabled, and authentication is available. New workers pick up the corrected routing.
- **A worker is idle** — idle is healthy and persistent; it completed its last turn and is waiting. Send the next instruction to the same worker or stop it if the workstream is finished.
- **A correction did not change the current step** — it may have been queued because the turn could not be steered at that instant. Ask for the worker's queued follow-ups and let the current turn settle, or stop it if continuing is unsafe.
- **A worker is dead or cannot be found** — ask the director for the current session's roster. Worker ownership is tied to its parent session; an intentionally stopped worker cannot be resumed. Start a new worker with a fresh self-contained brief when needed.
- **omp restarted during a turn** — reopen the parent session and ask for restored workers. Review the interrupted worker's transcript and repository state before explicitly continuing; omp does not replay the interrupted turn.
- **Two workers changed the same file** — stop further overlapping work, choose one integration owner, inspect the actual file, and ask that owner to reconcile the changes against both workstream contracts. Do not launch additional overlapping edits.
- **A worker appears stuck** — ask for its latest activity and steer it toward a smaller next step. If it still makes no progress, stop it and reassign the remaining work to a good worker with the evidence collected so far.
- **You cannot start, fork, move, or hand off the session** — run `/vibe` to exit and stop its worker scope, then retry the session operation.
- **You interrupted omp and are unsure what survived** — the **Vibe** badge means the mode is still active. Ask for the roster before continuing, or run `/vibe` for deterministic teardown.
