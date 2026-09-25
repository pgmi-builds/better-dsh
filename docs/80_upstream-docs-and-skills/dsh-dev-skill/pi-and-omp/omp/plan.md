<!--
source: https://omp.sh/docs/plan
fetched: 2026-09-06
-->

# Plan mode

> Explore a change without modifying the project, review the proposed approach, then choose exactly how omp should hand it to an implementation model.

## Plan before omp changes anything

Use plan mode when the hard part is deciding **what** to change: a cross-file refactor, an unfamiliar codebase, a migration with ordering constraints, or a design you want to review before implementation. During planning, omp can inspect the project and investigate assumptions, but its planning turn is read-only with respect to your working tree and system. The draft is kept as a session artifact; leaving without approval does not apply it.

Start with the goal and the constraints that would change the design:

```text
/plan Replace the in-memory job queue with Postgres. Preserve the public API, include a rollback path, and call out every migration step.
```

You can also type `/plan` with no prompt, or press the default <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> chord, and then enter your request. The status line shows **Plan**, omp switches to the configured `plan` model, and the next turn explores and drafts rather than implements.

For a tiny, well-understood edit, ordinary mode is faster. Planning adds another model turn and consumes context before execution begins.

## From request to reviewed plan

1. **Describe the outcome.** Include non-negotiable behavior, relevant files or systems, and how you will judge success.
2. **Let omp investigate.** It reads the code and other available sources, checks assumptions, and builds a Markdown plan without changing the project.
3. **Review the draft.** When the plan is ready, omp opens the full-screen **Plan Review** surface. You can also reopen the newest draft at any time with `/plan-review`.
4. **Refine or approve.** Add feedback, remove unwanted sections, or choose how implementation should inherit the planning conversation.

A useful follow-up is concrete rather than general:

```text
Keep the database schema, but revise the rollout so old and new workers can run together for one deploy.
```

## Review and approval choices

The approval choice controls both execution and context. It does not change the contents of the approved plan.

| Choice | What happens | Use it when |
| --- | --- | --- |
| **Approve and execute** | Exits plan mode, starts a fresh session, and gives the approved plan to the implementation model. The earlier transcript, including the planning discussion, is not carried into the new context. | The plan is self-contained, or you want the most context space for implementation. |
| **Approve and compact context** | Exits plan mode, compacts the current conversation into a summary focused on the approved plan, and then implements in the current session. | Some exploration matters, but the full transcript would be expensive or distracting. |
| **Approve and keep context** | Exits plan mode and implements in the current session with the full planning conversation intact. The option displays approximate usage against the execution model's context window. | Decisions depend on nuance that did not make it into the plan. |
| **Refine plan** | Sends your review annotations back as a planning turn. If you did not add annotations, the overlay closes and omp prompts you to enter a follow-up. Nothing executes. | The approach, ordering, or scope still needs work. |
| **Save and quit** | Prompts for a destination, writes the plan there, exits plan mode, and starts a new blank session without executing it. Relative paths resolve from the current working directory. | You want a durable plan for a later session, review, or handoff. |

**Approve and keep context** is unavailable only when usage is already above 95% of the execution model's context window. Choose compact or fresh execution instead. If the session has no usable context estimate, the option remains available without a usage figure.

Approval starts implementation immediately. If the session has no name yet, omp derives one from the plan title; a name you set yourself is preserved.

### Choose the implementation model

When at least two configured role models are available, Plan Review shows a **continue with** selector above the choices. It starts on the `default` role. Use <kbd>Left</kbd>/<kbd>Right</kbd> while the actions region is focused to choose another role before approving. This selection controls implementation, not the planner that produced the draft.

If only one role model resolves, the selector is hidden and omp restores the model that was active before plan mode.

## Work in Plan Review

The footer always shows the controls available in the focused region.

| Control | Result |
| --- | --- |
| <kbd>Up</kbd>/<kbd>Down</kbd>, <kbd>Enter</kbd> | Select and confirm an action. |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move among contents, plan body, and actions. |
| <kbd>Page Up</kbd>/<kbd>Page Down</kbd>, <kbd>g</kbd>/<kbd>G</kbd> | Move through a long plan or jump to its beginning/end. |
| <kbd>a</kbd> | Annotate the focused section or visible plan line; the notes become refinement feedback. |
| <kbd>d</kbd> / <kbd>Delete</kbd> | Remove the selected section in the contents sidebar. |
| <kbd>u</kbd> | Undo the most recent section edit or annotation. |
| <kbd>c</kbd> | Copy the current plan to the clipboard. |
| Your external-editor key | Edit the plan in `$VISUAL` or `$EDITOR`. |
| <kbd>Escape</kbd> | Dismiss review without approving or leaving plan mode. |

The contents sidebar appears only when the terminal is wide enough and the plan has at least two headings. Section delete and section-level annotation controls therefore may not be visible in a narrow terminal; you can still refine with a normal follow-up prompt or use an external editor.

Section deletion, undo, and external-editor changes update the session draft as you work. <kbd>Escape</kbd> dismisses the overlay but does not roll those edits back. Run `/plan-review` to bring back the newest plan draft. See [Keybindings](/docs/keybindings) to inspect or change the plan toggle and external-editor chords.

## Pause, resume, or leave

`/plan` is a stateful toggle:

1. While plan mode is active, run `/plan` again to leave without approval. If a non-empty draft exists, omp asks you to confirm. The status changes to **Plan paused**, normal tools and the pre-plan model are restored, and nothing executes.
2. While paused, run `/plan <follow-up>` to re-enter plan mode and submit that follow-up immediately.
3. While paused, run `/plan` with no prompt once more to turn plan mode fully off and clear the paused state.

Pressing <kbd>Escape</kbd> in Plan Review is different: it only closes the review surface. Plan mode remains active, so you can keep discussing the draft or reopen it with `/plan-review`.

Plan mode cannot run at the same time as goal mode or vibe mode. Exit the active or paused conflicting mode before entering plan mode.

## Planner model and settings

Plan mode is enabled by default and does not start automatically. It temporarily switches the session to the `plan` role on entry, including that role's configured thinking level, and restores the previous model when you leave unless you choose an implementation role in Plan Review.

A minimal persistent setup in [`config.yml`](/docs/settings) is:

```yaml
plan:
  enabled: true
  defaultOnStartup: false

modelRoles:
  plan: anthropic/claude-opus-4-5:high
```

| Setting or override | Purpose | Default |
| --- | --- | --- |
| `plan.enabled` | Makes `/plan` and plan mode available. | `true` |
| `plan.defaultOnStartup` | Opens each fresh interactive session in plan mode. Existing/resumed conversations are not forced into it. | `false` |
| `modelRoles.plan` | Persistent model and optional thinking level used while planning. | Not set; omp keeps the current model |
| `omp --plan <model-id>` | Selects the plan-role model for this launch. It does **not** enter plan mode; use `/plan` after launch. | — |
| `PI_PLAN_MODEL=<model-id>` | Selects the plan-role model for the process. `--plan` takes precedence. | — |
| `cycleOrder` and `modelRoles` | Determine the role models offered by the review-time **continue with** selector. | `smol`, `default`, `slow` |

If you change the `plan` role while plan mode is active, omp applies the new role model at the next safe turn boundary.

## Limitations and troubleshooting

- **`Plan mode is disabled`** — set `plan.enabled: true` in the active settings scope, then run `/plan` again.
- **`Exit goal mode first` or `Exit vibe mode first`** — the modes are mutually exclusive. A paused plan also must be turned fully off before entering goal mode.
- **`No plan to review yet`** — the planning turn has not produced a draft. Ask omp to finish the plan, then use `/plan-review`.
- **Keep-context is dimmed** — the conversation is above 95% of the execution model's context window. Use compact or fresh execution.
- **Compaction was cancelled after approval** — omp leaves the plan approved but does not dispatch implementation. Submit another turn to continue from the approved plan.
- **The external editor does not open** — set `$VISUAL` or `$EDITOR`; otherwise use annotations and follow-up prompts in omp.
- **Startup plan mode does not activate in `--print` or JSON output** — `plan.defaultOnStartup` is interactive-only because headless runs have no review surface. `--plan-yolo` is the separate headless flow; it auto-approves and therefore intentionally skips all human review choices documented above.
- **Planning is read-only for omp, not for you** — shell commands you run yourself can still change files or system state.
