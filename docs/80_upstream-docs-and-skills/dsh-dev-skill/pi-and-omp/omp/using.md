<!--
source: https://omp.sh/docs/using
fetched: 2026-09-06
-->

# Using omp

> Run a complete interactive session: write a request, follow the work, answer decisions, steer or stop it, review changes, and resume safely.

Bare `omp` opens the interactive terminal UI. This is the normal place to do day-to-day work: describe an outcome in ordinary language, let omp inspect and change the project, review what it did, then refine the result in the same conversation.

If you have just finished [Quickstart](/docs/quickstart), start in a project and send one bounded request:

```sh
cd my-project
omp
```

```text
Find the refresh-token race, fix only the implementation and its focused tests, show me the diff, and run those tests. Do not commit.
```

Press <kbd>Enter</kbd>. You do not need a slash command or special prompt format for normal work.

## A complete task, turn by turn

A reliable interactive task usually follows this loop:

1. **State the outcome and boundaries.** Name the bug or feature, important paths, anything that must not change, and the check that should pass.
2. **Let omp investigate.** It will narrate progress and show each read, command, or change as a card in the transcript.
3. **Intervene when needed.** Send a steering message while it works, answer a question, or reject an unsafe action.
4. **Review evidence.** Expand tool cards and diffs. Check the changed paths, command exit status, test result, and final explanation.
5. **Refine in the same session.** Say what is wrong or what remains: “Keep the public signature,” “Add the missing boundary case,” or “Revert the change to `cache.ts`.”

File changes are applied to your working tree as omp works. They are not committed unless you ask for a commit. Your editor, `git diff`, and the transcript remain the final review surfaces.

## Read the screen

The exact colors and status-line layout depend on your theme and settings, but the interactive screen has three working regions:

**Transcript**

Your messages, assistant text and thinking, notices, questions, and tool cards. New activity appears at the bottom. A tool card shows what is pending, succeeded, failed, or was cancelled; edit cards include the affected path and a diff summary.

**Composer**

The bordered editor where you write the next prompt. Autocomplete, attachment chips, queued-message hints, and temporary dialogs appear around it. The hint line at the bottom of a picker or question shows the keys that apply to that focused surface.

**Status line**

The default layout shows the active model and thinking level, work mode, path, Git state, context use, cost, and session name. Narrow terminals omit or shorten segments. Plan, Goal, Vibe, Loop, Fast, collaboration, and related state appear here when relevant.

The status line is not decoration: check it before assuming omp is in the wrong directory, using the wrong model, allowed to write, or out of context. Its presets and segments can be changed in `/settings`; see [Settings](/docs/settings) for the complete reference.

## Compose, attach, and submit

| You want to… | Do this |
| --- | --- |
| Send a prompt | Press <kbd>Enter</kbd>. |
| Insert a newline | Press <kbd>Shift</kbd>+<kbd>Enter</kbd>, <kbd>Ctrl</kbd>+<kbd>J</kbd>, or <kbd>Alt</kbd>+<kbd>Enter</kbd>. Windows Terminal users should prefer <kbd>Alt</kbd>+<kbd>Enter</kbd>. |
| Mention a project file | Type `@`, continue typing to fuzzy-search, then select the path. omp reads an `@path` mention into the turn automatically. |
| Complete a path | Type part of a relative, parent, home, or absolute path and use the completion list. <kbd>Tab</kbd> accepts the highlighted completion. |
| Attach an image | Paste with <kbd>Ctrl</kbd>+<kbd>V</kbd>, or drag or paste an image path. A chip in the composer confirms a pasted attachment. You can also mention `@path/to/image.png`; omp reads that file with the turn. |
| Attach pasted text | Paste it normally. Multi-line or large pastes can collapse into a numbered paste chip so the editor stays readable; deleting the chip removes that attachment. |
| Edit a long draft externally | Press <kbd>Ctrl</kbd>+<kbd>G</kbd> to open `$VISUAL`, falling back to `$EDITOR`, then save and close it to return the text to omp. |
| Recover an earlier prompt | Press <kbd>Ctrl</kbd>+<kbd>R</kbd> to search prompt history. |

You can combine prose, `@file` mentions, pasted text, and images in one prompt. Say what each attachment is for; a path by itself supplies context but not intent. For example:

```text
Compare @src/auth/refresh.ts with @test/auth/refresh.test.ts. The attached screenshot is the production error. Fix the race without changing the token format, then run the focused test.
```

Image input is normalized and resized by default. When the active model cannot accept images directly, omp normally asks a configured vision-capable model for a description instead. Image behavior is configurable under **Model → Vision** and **Appearance → Images** in `/settings`.

## Follow the work and review cards

Tool cards are the audit trail between your prompt and the final answer. Read the title first: it identifies the action, command, path, or remote resource. Then check its state and result.

- Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to expand or collapse tool output. Use it for a truncated command transcript or the complete visible diff.
- Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> to hide or show tool activity when you want a prose-only view.
- A successful card means that action completed, not that the whole task is correct. Check the final test or verification card separately.
- A failed or cancelled card remains useful evidence. Read the error, then tell omp whether to retry, use another approach, or stop.
- For edits, inspect the path and additions/removals. Ask for a correction immediately if the scope or behavior is wrong.

For a deeper file-change workflow and safety settings, see [Working with files](/docs/files).

## Answer approvals and questions

If your approval mode or a per-tool policy requires confirmation, omp pauses before the action and shows what it wants to do. Read the command, target, diff preview, and reason rather than approving from the title alone. Select the offered allow or reject choice with the picker keys shown on screen. <kbd>Escape</kbd> cancels the prompt; no approval is inferred from dismissal.

When omp needs product input, it may show a question dialog:

- Use <kbd>Up</kbd>/<kbd>Down</kbd> to move and <kbd>Enter</kbd> to choose a single answer.
- For a multi-select question, press <kbd>Space</kbd> to toggle choices, then <kbd>Enter</kbd> to advance.
- Use the **Other** row to type a custom answer. Press `n` on a row when the dialog offers an explanatory note.
- For several questions, <kbd>Tab</kbd>, <kbd>Shift</kbd>+<kbd>Tab</kbd>, or <kbd>Left</kbd>/<kbd>Right</kbd> changes tabs; review and submit on the final tab.
- Press <kbd>Escape</kbd> to cancel rather than guess. You can then explain the missing constraint in the composer.

The default **Yolo** approval mode permits normal read, write, and execution actions, so you may not see approval prompts. Choose **Always ask** in `/settings` under **Interaction → Approvals**, or launch with `omp --approval-mode always-ask`, when you want confirmation before writes and commands.

## Steer, queue, stop, and continue

You can type while omp is working. The submit key decides whether the message should affect the current turn or wait for the next one.

| Action | Default key | Use it when… |
| --- | --- | --- |
| Steer the active turn | <kbd>Enter</kbd> | The current approach needs a correction: “Do not change the schema,” “Use the existing helper,” or “Stop after investigation.” |
| Queue a follow-up | <kbd>Ctrl</kbd>+<kbd>Q</kbd> or <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | The current task should finish first: “After that, explain the migration risk.” |
| Return queued input to the composer | <kbd>Alt</kbd>+<kbd>Up</kbd> or <kbd>Shift</kbd>+<kbd>Up</kbd> | You queued the wrong text or want to edit pending messages. |
| Interrupt the active operation | <kbd>Escape</kbd> | A turn, local shell/Python escape, retry, or other active operation should stop. |
| Continue the prior intent | Send `.` or `c` | You interrupted at the right point and want omp to carry on without restating the task. |
| Retry the last failed assistant turn | <kbd>Alt</kbd>+<kbd>R</kbd> | A provider or turn failed and the same request should be attempted again. |

A steering message is for **now**; a follow-up is for **after the agent yields**. The pending-message strip shows what is queued. The `steeringMode`, `followUpMode`, and `interruptMode` settings control whether queued messages drain together or one at a time and whether steering interrupts immediately or waits.

<kbd>Escape</kbd> is focus-sensitive. If autocomplete or a picker is open, the first press dismisses that surface. In the main composer it interrupts active work. It does not exit omp. In Loop mode it stops the current iteration while leaving Loop enabled; run `/loop` again to disable Loop. See [Run modes](/docs/modes) for the exact mode behavior.

## Choose the model and thinking level

Use the defaults until a task gives you a reason to change them. The active selection is always visible in the status line.

| Control | Result |
| --- | --- |
| `/model` or <kbd>Alt</kbd>+<kbd>M</kbd> | Open the model hub and inspect or change persistent model-role assignments. |
| `/switch` or <kbd>Alt</kbd>+<kbd>P</kbd> | Choose a temporary model for the current session without changing the saved role assignment. |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Cycle forward or backward through the configured role-model order. |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Cycle the thinking effort supported by the active model, including Auto when configured. |
| <kbd>Ctrl</kbd>+<kbd>T</kbd> | Show or hide thinking blocks in the transcript. This changes visibility, not the reasoning effort. |

A higher thinking level can improve difficult reasoning but usually increases latency and token use. A model that does not support configurable thinking will say so instead of changing. When Auto is selected, the status line shows the resolved effort once the turn is classified.

See [Model roles](/docs/roles) for persistent assignments, the quick-cycle order, and per-session overrides.

Interactive work modes change how a turn behaves, not how you talk to omp. The status line tells you when one is active:

- **Plan** explores and proposes without changing the working tree until you approve it. See [Plan mode](/docs/plan).
- **Goal**, **Vibe**, **Prewalk**, **Loop**, **Fast**, and related controls are specialized workflows. Start with ordinary interactive turns and choose them deliberately from [Run modes](/docs/modes).
- If omp unexpectedly refuses to edit or keeps going after a turn, check the mode segment first. Leave or disable that mode with its slash command rather than fighting it with repeated prompts.

## Run a local command yourself

A leading escape runs directly from the composer without asking the model to choose or invoke anything:

```text
! git status
!! git diff --stat
$ print(2 + 2)
$$ import os; print(os.getcwd())
```

| Prefix | Behavior |
| --- | --- |
| `! command` | Run the command in your user shell, stream the result in the TUI, and include it in conversation context. |
| `!! command` | Run and display it, but exclude its output from model context. |
| `$ code` | Run Python in the session's shared Python kernel and include the result in context. A space after `$` is required, so prose such as `$HOME` remains prose. |
| `$$ code` | Run Python and display it without adding the output to model context. |

Press <kbd>Escape</kbd> to cancel a running shell or Python escape. A successful `! cd path` also moves omp's interactive working directory. These commands run with your local user permissions and can change files immediately; `!!` and `$$` exclude output from model context but are not a security sandbox.

## Move around sessions without losing work

You do not need to exit to change conversation state:

| Command | What it is for |
| --- | --- |
| `/tree` | Move to an earlier message or another branch in the current session. Use it when a turn went sideways. |
| `/branch` | Start an alternative thread from an earlier message in the same session file. |
| `/fork` | Clone the conversation into a new session file before trying a separate approach. |
| `/resume` | Open the session picker for this project. |
| `/new` | Start a fresh session while keeping the current one on disk. |
| `/session info` | Show the current session id, path, lineage, and statistics. |
| `/compact` | Summarize older active context when the context meter is high while retaining navigable history. |

The tree and session pickers display their own navigation hints. <kbd>Escape</kbd> clears an active search first, then closes the picker. Full branching, resume, export, and handoff behavior lives on [Sessions](/docs/sessions).

## Exit and recover

Use `/exit`, `/quit`, `/q`, or <kbd>Ctrl</kbd>+<kbd>D</kbd> for an orderly exit. <kbd>Ctrl</kbd>+<kbd>D</kbd> saves a non-empty unsent composer draft; resuming that session restores it once. <kbd>Ctrl</kbd>+<kbd>C</kbd> clears the composer, and a second press within half a second exits, so prefer <kbd>Ctrl</kbd>+<kbd>D</kbd> when you mean “leave and keep my draft.”

From the same project directory, restart the most recent session with:

```sh
omp -c
```

Use `omp -r` for the project session picker. This is also the recovery path after SSH or terminal disconnects; the persisted transcript is replayed, including an in-flight tail when one is still being written.

### Common stuck states

| What you see | Recovery |
| --- | --- |
| Keystrokes move a list instead of editing the prompt | A picker, autocomplete menu, or question has focus. Read its footer or press <kbd>Escape</kbd> to close it. |
| A queued message is wrong | Press <kbd>Alt</kbd>+<kbd>Up</kbd> or <kbd>Shift</kbd>+<kbd>Up</kbd>, edit the restored text, and submit again. |
| The agent is taking the wrong path | Send a concrete steering message with <kbd>Enter</kbd>. If continuing would be harmful, press <kbd>Escape</kbd>, review what already changed, then give the correction. |
| You stopped a good turn by accident | Send `.` or `c` to continue the previous intent. |
| A response failed | Read the error card, then press <kbd>Alt</kbd>+<kbd>R</kbd> to retry or change the model with `/model`. |
| Tool output or a diff looks incomplete | Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to expand it. |
| The terminal display is garbled after resize or reconnect | Press <kbd>Alt</kbd>+<kbd>L</kbd> to reset and repaint the display. |
| omp will inspect but not edit | Check for Plan mode and the approval prompt or policy shown on screen. Approve the action, leave Plan, or adjust **Interaction → Approvals** deliberately. |
| Context use is near its limit | Finish the current thought, then run `/compact`. See [Memory and compaction](/docs/memory). |
| The terminal disconnected or omp exited | Return to the project directory and run `omp -c`; use `omp -r` if it was not the most recent project session. |
| You cannot remember a shortcut | Run `/hotkeys`, then see [Keybindings](/docs/keybindings) for every action and remapping syntax. |

## Keep the reference pages nearby

This page covers the everyday journey. Use these for exhaustive details:

- [Slash commands](/docs/slash) — every built-in command and alias.
- [Keybindings](/docs/keybindings) — every default chord, focused-surface behavior, platform notes, and remapping.
- [Settings](/docs/settings) — configuration locations, precedence, and every interactive option.
- [Sessions](/docs/sessions) — resume, tree navigation, branching, forking, export, and sharing.
- [Run modes](/docs/modes) — launch modes and interactive work controls.
- [Working with files](/docs/files) — file, diff, approval, and verification workflows.
