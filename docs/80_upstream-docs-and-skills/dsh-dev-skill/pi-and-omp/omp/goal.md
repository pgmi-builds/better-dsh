<!--
source: https://omp.sh/docs/goal
fetched: 2026-09-06
-->

# Goal mode

> Give omp one durable objective and let it keep working across turns, with a token budget and controls for supervision.

Goal mode is for work that is too large for one turn but has a clear finish line: a repository-wide migration, a sustained test-and-fix cycle, or a release checklist with several dependent steps. You state the objective once; omp keeps taking the next useful step until it verifies the work as complete, you pause or drop the goal, or its budget stops further work.

Start with a bounded, testable objective:

```text
/goal Migrate the importer to streaming. Update every caller and user-facing documentation, preserve current error behavior, and finish only after the importer tests and typecheck pass.
/goal budget 200000
```

The status line shows that goal mode is active, and omp continues after each productive turn instead of waiting for another prompt. Stay available for risky decisions, review the work as it develops, and use `/goal show` to check status and usage.

> **A token budget is a safety boundary, not a definition of success.** When the budget is exhausted, the goal becomes `budget-limited` and omp wraps up what it knows. The objective is still unfinished unless goal mode explicitly reports completion.

## Choose the right kind of task

Goal mode works well when:

- the desired end state and verification commands are known;
- progress may require many edits, tool runs, or retries;
- omp can make routine decisions without asking after every step; and
- you can express safety boundaries up front.

Use a normal prompt for a focused change that should fit in one turn. Use [Plan mode](/docs/plan) when you want to review an approach before any implementation. Do not leave a goal unattended for production changes, destructive operations, credential work, or ambiguous product decisions; require confirmation for those actions in the objective.

A strong objective names the deliverables, evidence of completion, and prohibited shortcuts. For example:

```text
/goal Remove the legacy session API and migrate all callers. Keep the public behavior compatible, do not change the database schema, run the focused session tests and typecheck, and report any callers that cannot be migrated safely.
```

If the finish line is not yet clear, let omp interview you first:

```text
/guided-goal I need to make authentication safer before launch
```

`/guided-goal [rough objective]` asks clarifying questions in the normal chat, turns your answers into a concrete objective, and then starts goal mode. With plain `/goal`, omit the objective to open a multiline editor.

## Supervise an active goal

In the interactive TUI, an active goal automatically continues after a short idle pause. Typing a prompt, attaching an image, or interrupting gives you control before the next turn begins. You can steer the work with an ordinary message at any time:

```text
Before continuing, keep the existing wire format and add a regression test for malformed frames.
```

Use these commands to inspect and control the current session's goal:

| Command | What it does |
| --- | --- |
| `/goal` | Opens the management menu for the active or paused goal. With no existing goal, opens the objective editor. |
| `/goal show` | Shows the objective, status, tokens used and remaining, and active time. |
| `/goal pause` | Stops automatic continuation but keeps the objective and accounting in the session. |
| `/goal resume` | Resumes a paused goal and schedules its next continuation. |
| `/goal budget <N>` | Sets a positive-integer total token budget. Existing usage is retained. |
| `/goal budget off` | Removes the token cap. Existing usage is retained. |
| `/goal set <objective>` | Starts a goal, or replaces an active goal with a new objective and fresh counters. A replacement also clears the old budget. |
| `/goal drop` | Permanently stops the current goal after confirmation. There is no separate `/goal stop` command. |

Press `Esc` to interrupt the current turn. An interrupted active goal is saved as paused, so inspect the partial work and run `/goal resume` only when it is safe to continue.

A paused goal must be resumed before its budget can be changed. It also cannot be silently overwritten: resume it and use `/goal set …`, or drop it before starting a different objective.

## Set and interpret a budget

Goal mode has **no token cap by default**. For supervised work, set one soon after starting:

```text
/goal budget 100000
```

`N` is the total budget for the current goal, not an amount added to its remaining balance. Changing the budget preserves accumulated usage. The count includes input tokens, output tokens, and cache-write tokens; cache-read tokens are excluded. A turn can cross the exact boundary before accounting catches up, so treat the value as a guardrail rather than a precise hard stop or spending limit.

When used tokens reach the cap:

1. Status changes from `active` to `budget-limited`.
2. omp sends one wrap-up turn asking for progress, remaining work, and blockers rather than starting more substantive work.
3. Automatic continuation stops, but the goal remains attached to the session.

Check the state before deciding what to do:

```text
/goal show
```

If the objective is still worth pursuing, set a new total greater than the displayed usage, or remove the cap:

```text
/goal budget 250000
# or
/goal budget off
```

That returns a budget-limited goal to active work. If you do not want more work, use `/goal pause` to preserve it for later or `/goal drop` to end it. Never interpret `budget-limited`, a wrap-up response, silence, or a provider error as completion.

## What completion means

Goal mode asks omp to complete only after checking every deliverable against the current repository state. On success, you see **Goal mode completed**, automatic continuation ends, and the completion record includes the objective and tracked usage in the session history.

This is stronger than merely reaching the end of a turn, but it is not a substitute for your review. Read the final evidence, inspect important changes, and run any release or production checks that require human authority. If the final response lists remaining work or blockers, the task is not complete even if the response sounds conclusive.

## Persistence and recovery

The objective, status, budget, token usage, and active time are stored with the session as work proceeds. Compaction does not discard the goal. Switching away from and back to the same session in a running TUI preserves an active goal; reopening a persisted session from a cold start restores an active goal as **paused** so it cannot resume unattended. Use `/goal show`, review the working tree, then `/goal resume`.

Explicitly paused goals remain available in the session until resumed or dropped. Dropping removes the live goal record, while accumulated usage remains in the session log. Completion clears the live mode and writes a completion record.

Use this recovery checklist when work stops unexpectedly:

| What you see | What to do |
| --- | --- |
| `paused` after `Esc`, an interrupted turn, or reopening the session | Inspect partial changes and logs, then run `/goal resume`. |
| `budget-limited` | Run `/goal show`; raise the total above tokens used or use `/goal budget off`. |
| `active`, but no automatic next turn | Submit or clear any draft/image waiting in the composer. If the previous continuation made no actionable progress, send a normal message such as “Continue the goal from the last verified step.” |
| Repeated provider or command failure | Pause the goal, fix credentials/environment or refine the objective, then resume. Drop and restart only when you intentionally want fresh counters. |
| “Exit plan mode first” or “Exit vibe mode first” | Finish or exit that mode; plan, vibe, and goal modes are mutually exclusive. |
| “Goal mode is disabled” | Enable `goal.enabled`, then retry `/goal`. |

Automatic continuation is currently an interactive-mode behavior. Loop mode also takes control of automatic submissions, so do not combine `/loop` with a goal when you expect goal-driven continuation.

## Configuration

No configuration is required: goal mode, its footer status, and interactive continuation are enabled by default. Change them in **Settings → Tasks → Modes** or in `~/.omp/agent/config.yml`:

```yaml
goal:
  enabled: true
  statusInFooter: true
  continuationModes:
    - interactive
```

| Setting | Default | Effect |
| --- | --- | --- |
| `goal.enabled` | `true` | Allows `/goal` and `/guided-goal` to create per-session goals. |
| `goal.statusInFooter` | `true` | Shows goal token usage alongside the goal indicator in the status line. |
| `goal.continuationModes` | `["interactive"]` | Enables automatic between-turn continuation in the interactive TUI. Remove `interactive` to require manual prompts. |

Verify the effective values from the shell:

```bash
omp config get goal.enabled
omp config get goal.statusInFooter
omp config get goal.continuationModes
```

See [Settings](/docs/settings) for file precedence and configuration commands, and [Slash commands](/docs/slash) for the complete command index.
