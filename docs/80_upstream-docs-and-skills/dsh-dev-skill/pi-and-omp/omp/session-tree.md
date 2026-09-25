<!--
source: https://omp.sh/docs/session-tree
fetched: 2026-09-06
-->

# Session tree

> Revisit an earlier turn, try a different direction, and keep the original conversation available.

A conversation becomes a tree as soon as you revisit an earlier point and continue differently. omp keeps the path you already took and adds the new path beside it, so experimenting does not require deleting useful work.

The smallest action is:

```text
/tree
```

Use the navigator to choose where you want to continue.

## Read the tree

`/tree` opens a full-session map. Rows are connected by tree lines, and sibling lines are alternative continuations from the same point.

- An accent bullet marks every row on the **currently active path**.
- The highlighted row is the point you are considering; it is not active until you press <kbd>Enter</kbd>.
- User and assistant text identifies turns. Tool activity and session events can also appear, depending on the filter.
- A label appears before its row and works like a durable bookmark.
- Very deep indentation is compressed with an ellipsis so the message text remains readable.

The default filter favors conversational entries. If a session looks unexpectedly sparse, press <kbd>Alt</kbd>+<kbd>A</kbd> to show everything. Type any part of a message, label, role, or tool snippet to narrow the map.

```text
• You: Investigate the failing build
  • Assistant: The failure starts in authentication
    ├─ • You: Patch the token refresh path
    │    • Assistant: Tests now pass
    └─ You: First check whether the cache is stale
         Assistant: The cache is healthy
```

Here, the bullets show the active token-refresh path. The cache check is still present as another branch.

## Continue from an earlier turn

To revise a previous request without losing its original result:

1. Run `/tree`.
2. Highlight the earlier **user message**.
3. Press <kbd>Enter</kbd>.
4. omp moves to the point just before that message and restores the message—including its image attachments—as an editable draft.
5. Change the draft and submit it.

Submitting creates a new continuation beside the old one. The original message, its answer, and everything after it remain reachable in `/tree`.

Selecting an assistant response instead lands immediately after that response and leaves the editor empty. Your next prompt continues from there. Selecting the current endpoint simply closes the navigator with an “Already at this point” status.

Past interactive questions are recoverable too: selecting an earlier `ask` answer reopens the question UI, and a new answer becomes a sibling of the old answer.

### Keep useful context from the path you leave

When `branchSummary.enabled` is enabled, <kbd>Enter</kbd> offers three choices:

- **No summary** — continue with only the context on the selected path.
- **Summarize** — carry a generated recap of the path you are leaving into the new path.
- **Summarize with custom prompt** — tell omp what the recap should preserve.

Press <kbd>Shift</kbd>+<kbd>Enter</kbd> to summarize and switch without opening that choice. The recap belongs to the new path; it does not replace or delete the abandoned path. Press <kbd>Esc</kbd> while summarization is running to cancel and return to the tree.

## `/tree`, `/branch`, or `/fork`?

These controls preserve different amounts of history:

| Control | Result | Best for |
| --- | --- | --- |
| `/tree` | Moves within the current session file. Your next submission adds an in-file alternative while every existing path remains in the same tree. | Exploring alternatives while keeping one navigable record. |
| `/branch` | Follows **Double-Escape Action**. With the default **Tree** setting it opens the same in-file navigator as `/tree`. Set that action to **Branch** to choose an earlier user message and create a separate session containing only the path before it; the chosen message returns as a draft. | Choosing whether the branch command means in-file navigation or a clean session from an earlier decision point. |
| `/fork` | Immediately clones the current session—including its current tree and artifacts—into a new session, then switches to the clone. It does not ask for an earlier turn. | Taking a full checkpoint before broad or risky experimentation. |

A practical rule: use `/tree` when you want to compare paths in one map. To make `/branch` create a separate prefix session, open `/settings`, go to **Interaction → Input**, and set **Double-Escape Action** to **Branch**. Use `/fork` when you want a complete independent copy of everything as it stands now.

That setting also controls what pressing <kbd>Esc</kbd> twice in an empty editor does: open the tree, open the branch picker, or do nothing.

`/fork` requires a persisted session and cannot run while a response is streaming. It is unavailable for sessions started with `--no-session`.

## Navigation controls

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move one visible row; wraps at the ends |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd> | Jump to the previous or next user/assistant turn |
| <kbd>Page Up</kbd> / <kbd>Page Down</kbd> or <kbd>←</kbd> / <kbd>→</kbd> | Move one page |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the first or last visible row |
| Type | Search the visible tree; <kbd>Backspace</kbd> removes search characters |
| <kbd>Enter</kbd> | Switch to the highlighted point |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | Summarize the path being left, then switch |
| <kbd>Shift</kbd>+<kbd>L</kbd> | Add, edit, or clear a label when search is empty |
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | Cycle filters forward |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> | Cycle filters backward |
| <kbd>Alt</kbd>+<kbd>D</kbd>/<kbd>T</kbd>/<kbd>U</kbd>/<kbd>L</kbd>/<kbd>A</kbd> | Show default, no-tools, user-only, labeled-only, or all entries |
| <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>C</kbd> | Clear an active search first; otherwise close the navigator |

Use labels before a long experiment if you expect to return to a particular checkpoint. Later, <kbd>Alt</kbd>+<kbd>L</kbd> shows only labeled entries.

## Persistence and compaction

Completed turns and all branches are stored in the session journal. Normal tree navigation does not rewrite or erase earlier paths.

The selected point becomes the active endpoint immediately. Your next submission, a branch summary, or the normal session-exit record stores an entry on that path, so resume follows it. If omp is killed before anything can be written after a navigation-only move, resume may return to the last endpoint already represented by the journal; reopen `/tree` and select the intended path again.

[Compaction](/docs/compaction) changes what context is sent to the model on a path; it does not flatten the tree or delete the turns that produced the summary. A path through a compaction point uses that compacted context. Navigating to a point before it lets you continue from the earlier context, and other branches remain visible.

Branch summaries and compaction summaries solve different problems:

- A **branch summary** carries useful information across a deliberate switch to another path.
- A **compaction summary** shortens an active path so the conversation can continue within the model's context window.

## Recover from the wrong choice

If you moved to the wrong point, do not recreate the conversation:

1. Run `/tree` again.
2. Search for distinctive text or press <kbd>Alt</kbd>+<kbd>L</kbd> to find a bookmark.
3. Follow the tree lines to the endpoint of the original path.
4. Select that endpoint with <kbd>Enter</kbd>.

The original path becomes active again. If you already submitted on the wrong path, that new work also remains as a sibling; returning does not delete either side.

For a stronger boundary before experimentation, use `/fork` first. You can then resume the original session independently through `/resume` if the experiment goes badly.

## Related

- [Sessions](/docs/sessions) — find, resume, branch, fork, and share sessions.
- [Compaction](/docs/compaction) — how long active paths are summarized.
- [Session format](/docs/session-format) — the public on-disk format for integrations.
- [Handoff](/docs/handoff) — pass a structured session recap to a teammate.
