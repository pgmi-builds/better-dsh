<!--
source: https://omp.sh/docs/handoff
fetched: 2026-09-06
-->

# Handoff

> Turn a long working session into a focused continuation brief without leaving the session.

Handoff gives omp a clean, task-oriented context when a conversation has accumulated too much history. It summarizes the work completed so far, the decisions that matter, and what should happen next, then compacts that summary into the **current session**.

Run it when you want the next turn to continue from a deliberate checkpoint:

```text
/handoff
```

While omp prepares the handoff, the status line shows `Generating handoff… (esc to cancel)`. On success, the conversation is rebuilt around a `handed-off` divider and omp reports `Context handed off and compacted in place`.

> Despite the name, `/handoff` does not create, fork, or switch to another session. Your session ID, name, branch, and saved session stay the same.

## Handoff or compact?

Both commands reduce the model's active context in place and retain a recent tail of the conversation. Choose based on what you want the replacement context to emphasize.

| Choose | When you want | Outcome |
| --- | --- | --- |
| `/handoff` | A work-focused continuation brief: goal, progress, decisions, constraints, and next steps | omp generates that brief, uses it as the summary of older context, and marks the point as `handed-off` |
| [`/compact`](/docs/compaction) | General context reduction, or control over the compaction method such as `soft`, `remote`, or `snapcompact` | omp uses the selected compaction method and marks the corresponding compaction point |
| Neither | The current context is still useful and comfortably within the model's limit | Keep working; automatic context maintenance is enabled by default |

Use `/handoff` before changing work phases, returning after a long pause, or preserving a precise implementation/debugging checkpoint. Use `/compact` when the priority is simply freeing context. If you actually want a separate session, use the session controls described in [Sessions](/docs/sessions).

## Focus the continuation

Add plain-language focus instructions after the command:

```text
/handoff Focus on the migration plan, decisions already made, and callers that still need updating.
```

The focus changes what the brief emphasizes; it does not become a new user task and does not create a new session. Without a focus, omp chooses the important continuation details from the conversation.

Good focus instructions name the work that must survive the reduction:

```text
/handoff Preserve the test failure, hypotheses ruled out, and the next two debugging steps.
```

```text
/handoff Emphasize the approved API shape and unresolved compatibility risk.
```

Wait for the current response to finish before running the command. If you need to stop that response, abort it first, then enter `/handoff`.

## What changes on screen

A successful handoff changes the context used for future model turns:

- Older context is replaced by the generated handoff brief.
- Recent messages remain verbatim. The retained amount is controlled by `compaction.keepRecentTokens`, which defaults to `20000`.
- Todos and other live session UI are refreshed.
- The same session continues; there is no resume or load step.

By default, pre-handoff history is collapsed out of the live transcript and the recent tail appears after a divider similar to:

```text
──────── handed-off · 180K→24K · ctrl+o ────────
```

Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to expand the divider and read the generated brief. Set `display.collapseCompacted: false` if you prefer to keep the full saved transcript inline around compaction dividers. Collapsing affects the display, not the persisted session history.

Your next prompt can immediately continue the work:

```text
Continue with the first remaining migration caller.
```

## Cancel or recover from a failure

Press <kbd>Esc</kbd> while `Generating handoff…` is visible to cancel. omp shows `Handoff cancelled`, leaves the current context unmodified, and keeps you in the same session.

Other preconditions and errors are also non-destructive:

| Message | Meaning and next action |
| --- | --- |
| `Wait for the current response to finish or abort it before handing off.` | Let the response finish, or abort it, then retry. |
| `Nothing to hand off (no messages yet)` | There are fewer than two messages to summarize. Continue the conversation first. |
| `Nothing to hand off (already compacted)` | No older context remains to replace. Continue working before trying again. |
| `Compaction already in progress` | Wait for the active automatic or manual compaction to finish. |
| `Handoff failed: No model selected for handoff` | Select a model, then retry. |
| `Handoff failed: No API key for …` | Authenticate the active provider, then retry. |
| `Handoff failed: …` | The provider or generation failed. The original context remains active; retry after resolving the reported error. |

An empty generated brief is treated as a failure, not as a cancellation. omp automatically retries transient provider failures, but if the final attempt fails it displays the real error and does not commit a partial handoff.

## Automatic handoff

Manual `/handoff` always requests the handoff workflow; it does not depend on automatic compaction being enabled or on `compaction.methodOrder`.

For automatic use, enable compaction and put `handoff` early in the ordered fallback list. The default order is:

```text
remote → snapcompact → handoff → shake → soft
```

That means another available method may run before handoff. If automatic handoff cannot run or fails, omp tries the next configured method. When the input has already overflowed the model's context, omp normally skips starting a new handoff request because the same oversized input could not be summarized; an already-prepared speculative handoff may still be applied.

Open `/settings` and use **Context → Compaction**, or add a global or project override to `config.yml`:

```yaml
compaction:
  enabled: true
  methodOrder: [handoff, remote, snapcompact, shake, soft]
  handoffSaveToDisk: true
```

`handoffSaveToDisk` adds a timestamped `handoff-*.md` file to the persisted session's artifact directory **only for automatic handoffs**. Manual `/handoff` stores the result as the session's compaction summary but does not write the extra Markdown file.

## Relevant settings

| Setting | Default | Effect |
| --- | --- | --- |
| `compaction.enabled` | `true` | Enables automatic context maintenance. It does not disable manual `/handoff`. |
| `compaction.methodOrder` | `[remote, snapcompact, handoff, shake, soft]` | Chooses and orders automatic maintenance methods. Put `handoff` first to prefer it. |
| `compaction.keepRecentTokens` | `20000` | Approximate recent context retained verbatim after handoff or compaction. |
| `compaction.thresholdPercent` | `-1` | Automatic-maintenance threshold as a percentage; `-1` uses the reserve-based default. |
| `compaction.thresholdTokens` | `-1` | Fixed automatic-maintenance token limit; a non-default value overrides the percentage. |
| `compaction.asyncEnabled` | `true` | May prepare an LLM-backed summary, including handoff, shortly before the threshold so it can be applied quickly. |
| `compaction.handoffSaveToDisk` | `false` | Writes an extra Markdown artifact for automatic handoffs in persisted sessions only. |
| `display.collapseCompacted` | `true` | Collapses replaced history in the live TUI; turn it off to keep the full transcript inline. |

See [Settings](/docs/settings) for configuration locations, scopes, and precedence.

## Related

- [Compaction](/docs/compaction) — compaction methods, thresholds, and recovery behavior
- [Sessions](/docs/sessions) — create, fork, resume, and switch sessions
- [Plan mode](/docs/plan) — create an implementation plan before preserving the checkpoint
