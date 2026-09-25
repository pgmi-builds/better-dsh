<!--
source: https://omp.sh/docs/sessions
fetched: 2026-09-06
-->

# Sessions

> Your work is saved automatically. Resume it by project, split off an experiment, or share a copy without losing the original conversation.

## Your work saves automatically

Start omp normally and work:

```sh
cd ~/work/api
omp
```

There is no Save command. omp records completed messages and tool activity in a session associated with the working directory. Quit and come back later with:

```sh
cd ~/work/api
omp -c
```

`-c` continues this terminal's last session in the current directory. If that terminal breadcrumb is unavailable, omp uses the most recently modified session for the directory; if none exists, it starts a new one.

Saving happens as entries complete. Text that is still streaming is not committed until the response finishes, so a hard crash can lose the partial response at the end while preserving the completed work before it. See [Crash recovery](#crash-recovery) for the safe way to continue.

If you never want a local session record, launch with `omp --no-session`. That run cannot be resumed, deleted, or forked as a saved session. An explicit export or share still creates or uploads a separate copy.

## Start, continue, or choose a session

Use the action that matches what you know:

| What you want | Action |
| --- | --- |
| Start unrelated work | `omp`, or `/new` inside omp |
| Continue this terminal's latest work in the current directory | `omp -c` |
| Choose from saved work | `omp -r`, or `/resume` inside omp |
| Resume a known session | `omp -r <id-or-path>`, or `/resume <id>` |
| Always continue the latest session on startup | Enable **Auto Resume** in `/settings`, or run `omp config set autoResume true` |

`/new` starts a new saved session and leaves the current one available in the picker. It is different from `/clear`, which only resets the model's current conversation context while keeping the same session.

### Use the session picker

Run `omp -r` before startup, or enter `/resume` while omp is open. The picker begins with sessions for the current folder.

- Type to search by title, session ID, project path, or conversation text. Search also finds prompts from deep in long sessions.
- Press <kbd>↑</kbd>/<kbd>↓</kbd> and <kbd>Enter</kbd> to select.
- Press <kbd>Tab</kbd> to switch between **current folder** and **all projects**. The all-projects view shows each session's working directory.
- Pinned sessions appear first. Status text such as **interrupted**, **aborted**, or **error** helps identify an unfinished run.
- Press <kbd>Delete</kbd>, or <kbd>Backspace</kbd> with an empty search box, to delete the highlighted session after confirmation.

When you resume a session from another existing project, omp switches to the working directory recorded by that session. If the recorded directory no longer exists, an interactive launch offers to move the session into your current directory instead.

Use `/session info` to see the current session's ID and file path. A short unique ID prefix is usually enough for `-r`, `/resume`, `/pin`, and `--fork`.

## Make saved work easy to find

### Name and pin

Give important work a stable title instead of relying on its first-message preview:

```text
/rename Streaming importer investigation
/pin
```

`/pin` toggles the current session at the top of resume lists. `/pin <session-id>` toggles another saved session without opening it. Pins follow a session if you move it to another project directory.

### Move a session to another project

If the conversation now belongs with a different checkout or worktree, move it rather than relying on the all-projects picker:

```text
/move ../api-v2
```

The target must be a directory. omp moves the saved session and its artifacts, updates its working directory, and makes it discoverable from the target project's resume list.

### Delete

Choose the command by what should happen next:

| Action | Result |
| --- | --- |
| Delete in the resume picker | Deletes the highlighted session and its artifacts |
| `/session delete` | Deletes the current session and returns to the picker |
| `/drop` | Deletes the current session and immediately starts a new one |
| `/new` | Keeps the current session and starts a new one |

Deletion is destructive. Export or copy the JSONL file shown by `/session info` first if you might need it later.

## Branch or fork?

Both preserve the conversation you already have, but they organize the alternative differently.

|  | Branch | Fork |
| --- | --- | --- |
| Command | `/branch` | `/fork` |
| Saved as | Another path in the same session | A new saved session with a new ID |
| What you choose | An earlier user message to revise and resend | The current state; no message picker |
| Best for | Exploring alternatives that belong in one canonical history | A risky, disposable, or separately shareable line of work |
| Return to the original | `/tree` within the session | `/resume` and select the parent session |

`/branch` opens a user-message selector. Pick the prompt where the new direction should begin; omp rewinds to just before it and puts that prompt back in the editor so you can revise it. The abandoned continuation remains in the same session and can be revisited with `/tree`.

`/fork` copies the current saved session and its artifacts into a new session, then continues in the copy. The parent remains unchanged and appears separately in the resume picker. To fork from an older point, first navigate or branch to that point, then run `/fork`.

From the shell, fork a known saved session directly into the current project:

```sh
omp --fork <session-id>
omp --fork ./received-session.jsonl
```

Use `/tree` to switch among paths kept inside one session. [Session tree](/docs/session-tree) explains navigation, labels, active paths, and exactly what branch and fork retain.

## Export, share, and import

### Export a local review copy

`/export` writes a self-contained HTML view and opens it in your browser:

```text
/export
/export ./review/importer-session.html
```

Export an existing JSONL file without opening an interactive session:

```sh
omp --export ./session.jsonl ./session.html
```

HTML is for reading, not for resuming. It can include conversation text, tool output, paths, and model context, so treat it as sensitive.

### Share an encrypted link

Run `/share` in the session, or share an existing saved session from the shell:

```sh
omp share <session-id-or-path>
```

The default flow encrypts the session snapshot in your client and uploads the encrypted blob. The decryption key is in the URL fragment and is not sent to the storage server. Secret redaction is enabled by default for configured secrets, but it is not a substitute for reviewing what you send: anyone with the complete link can read the snapshot. Large shares may be trimmed to fit the service limit, and a configured custom share handler may use a different destination and privacy model.

Use `/handoff [focus]` before sharing when another person needs a concise statement of current state and next steps.

### Continue an editable copy

A share link or HTML export cannot be imported back into a live session. For an editable handoff, send the JSONL path reported by `/session info`; the receiver should fork it into their current project:

```sh
cd ~/work/api
omp --fork ./received-session.jsonl
```

This creates a new local session and leaves the received file unchanged. `omp -r ./received-session.jsonl` instead opens that exact file and adopts its recorded working directory when it still exists.

omp can also import local Claude Code or Codex history into a fresh omp session:

```sh
omp --from-claude
omp --from-codex
```

Each command opens a source-specific picker. From an existing omp session, `/resume @claude` and `/resume @codex` open the same import choices.

For tools that need the public JSONL structure rather than the product workflow, see [Session format](/docs/session-format).

## Profiles, locations, and privacy

Sessions are scoped in two layers:

1. **Profile.**`omp --profile work` uses isolated settings, authentication, caches, and sessions. A resume picker only sees the active profile.
2. **Working directory.** Inside a profile, omp groups sessions by project. The picker starts in the current-folder group; <kbd>Tab</kbd> reveals the profile's other projects.

The usual default-profile location is `~/.omp/agent/sessions/`. A named profile normally uses `~/.omp/profiles/<name>/agent/sessions/`. XDG configuration and directory overrides can change those paths, so `/session info` is the authoritative location for the active session.

Use `--session-dir <path>` when one launch must save and look up sessions in a specific directory. Reuse the same flag when resuming from that custom location. Prefer profiles when you want durable separation between clients, identities, or work contexts; prefer `/move` when only one conversation belongs to a different project.

Saved JSONL files and artifacts are local, but they may contain prompts, source excerpts, tool results, file paths, and secrets printed by commands. Protect the session directory like source code and credentials. `--no-session` prevents the session record, but does not undo files changed by tools or copies you explicitly export or share.

## Crash recovery

After a terminal disconnect, process crash, or forced restart:

1. Return to the same project and run `omp -c`.
2. If that is not the right conversation, run `omp -r`, type a distinctive phrase, and check sessions marked **interrupted**.
3. Read the last completed messages and any pending-tool warning before sending another prompt.
4. Verify external side effects before asking omp to repeat a command. The transcript can show that a tool result was never recorded even when the command changed something outside omp.

omp preserves completed entries before the crash and ignores an incomplete trailing record. It does not invent the missing result of an interrupted tool call or the unsaved tail of a streaming response.

## Troubleshooting

### The picker says there are no sessions

- Press <kbd>Tab</kbd>; you may be viewing only the current folder.
- Check that you launched with the same `--profile` as before.
- If the session used `--session-dir`, pass that directory again.
- Use `/session info` before leaving a session to capture its exact path.

### `-c` opened the wrong work

`-c` favors the last session associated with the current terminal, then the latest session for the directory. Use `omp -r` to choose explicitly, or `/rename` and `/pin` the session you return to often.

### A known ID is not found

Open `omp -r`, press <kbd>Tab</kbd>, and search the all-projects view. Use a longer ID prefix if several sessions begin alike. Profiles and custom session directories are separate search scopes; switch to the original profile or pass the original `--session-dir`.

### Fork or delete is unavailable

Forking requires persistence, so relaunch without `--no-session`. Deleting requires an actual saved file; a brand-new empty session may have nothing to delete yet. Wait for a streaming response to finish or abort it before moving, deleting, or forking.

### The project directory was renamed or removed

Resume by ID from an interactive terminal. omp offers to re-root a session whose recorded directory no longer exists into the current directory. For an existing but different project, resume it normally and use `/move <path>` when you intentionally want to reassign it.

Command-line flags are listed in [CLI reference](/docs/cli), and all interactive commands are listed in [Slash commands](/docs/slash).
