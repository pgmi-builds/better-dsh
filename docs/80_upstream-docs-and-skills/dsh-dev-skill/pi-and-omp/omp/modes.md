<!--
source: https://omp.sh/docs/modes
fetched: 2026-09-06
-->

# Run modes

> Choose the right interactive, one-shot, or protocol mode, then control repeated work, one-tool turns, and priority serving.

omp has two kinds of mode:

1. A **launch mode** decides whether you work in the terminal UI, receive one answer, stream machine-readable events, or connect omp to another application.
2. An **interactive turn control** changes how work runs inside a terminal session: `/loop`, `/force`, or `/fast`.

For normal coding work, start with the terminal UI:

```sh
omp
```

Describe the outcome you want, for example: “Rename `issueToken` to `mintToken` across the project and update every caller.” Use another launch mode only when a script, editor, or application—not a person at the terminal—needs to consume the output.

## Choose a launch mode

| You want to… | Start omp with… | What you see | How it ends |
| --- | --- | --- | --- |
| Work interactively | `omp` or `omp "your first prompt"` | The full terminal UI, transcript, editor, approvals, and status line | `/exit`, `/quit`, `/q`, or `Ctrl+D` |
| Get one plain-text answer | `omp -p "your prompt"` | `Working...` on stderr, then the final assistant text on stdout | Exits after the turn |
| Feed a prompt through a pipe | `git diff | omp -p "Review this diff"` | The same one-shot text output |
| Stream structured events | `omp --mode json "your prompt"` | One JSON object per line on stdout | Exits after the turn |
| Embed omp behind its native RPC API | `omp --mode rpc` | A `ready` frame, then RPC responses and events over stdio | Client shutdown, stdin EOF, or process interruption |
| Embed omp and handle interactive UI requests | `omp --mode rpc-ui` | RPC plus extension/tool UI requests for the host to render | Client shutdown, stdin EOF, or process interruption |
| Run omp inside an ACP-capable editor | Configure the editor to spawn `omp acp` | The editor owns the conversation, changes, terminals, and approvals | The ACP client disconnects or stops the process |

`--mode` accepts exactly `text`, `json`, `rpc`, `rpc-ui`, or `acp`. Any explicit `--mode` selects a headless mode—even `--mode text`. Bare `omp` is interactive only when you have not supplied `--print`, have not selected a mode, and stdin did not provide a prompt.

### Interactive terminal UI

Use this unless you have a specific automation or integration need.

- `Esc` interrupts the current turn. It does not exit omp.
- `Ctrl+C` clears the editor; pressing it again within half a second exits.
- `Ctrl+D` exits and saves an unsent draft so it can be restored when the session resumes.
- `/exit`, `/quit`, and `/q` perform the same orderly shutdown.

The status line is available only in this mode. Its model and mode segments show controls such as Fast, Plan, Goal, Vibe, and Loop when they are active.

### One-shot text

These forms are equivalent ways to request plain text and exit:

```sh
omp -p "Summarize the last commit"
omp --mode text "Summarize the last commit"
printf '%s\n' "Summarize the last commit" | omp
```

Piped stdin automatically selects one-shot text only when neither `--print` nor `--mode` chose something else. omp waits for EOF before starting; if the producer keeps stdin open, omp reports that it is still reading the prompt on stderr. Close the producer or press `Ctrl+C`.

By default, stdout contains only the final assistant text. Add `--print-thoughts` when a script deliberately needs the model's thinking blocks too:

```sh
omp -p --print-thoughts "Explain this stack trace"
```

A fresh one-shot run ignores `plan.defaultOnStartup` because there is no review surface. Use `--plan-yolo` for the supported headless plan-then-execute flow; see [Plan mode](/docs/plan).

### JSON event stream

Use JSON when a script needs progress and lifecycle events rather than a rendered answer:

```sh
omp --mode json "Find every TODO under src" > run.jsonl
```

When the session has a header, it is the first JSON line; session events follow. Stream updates omit repeated full-message snapshots and provider-private replay data, so consume the event stream rather than expecting each line to be a complete transcript.

### RPC, RPC UI, and ACP

These are integration transports, not alternate terminal interfaces:

- **RPC** is omp's native newline-delimited protocol. It owns stdin and stdout and emits `ready` before accepting commands. `@file` launch arguments are rejected because the client must provide prompts and context through the protocol. See [RPC mode](/docs/rpc).
- **RPC UI** is RPC for a host that also renders omp's interactive extension and tool UI requests. It is not a decorated version of `rpc`; do not choose it unless the host implements that UI exchange. It also disables PTY-backed shell execution.
- **ACP** is the standard editor integration. Prefer `omp acp`; `omp --mode acp` is equivalent. The editor launches the process and creates sessions over stdio. Running it by hand prints an explanation on stderr and waits for protocol frames. See [ACP](/docs/acp).

Closing RPC stdin tells omp that the client is gone: it rejects pending UI requests, drains accepted commands, disposes the session, and exits. ACP exits when its peer disconnects. Keep protocol stdout reserved for the protocol; send your application's logs elsewhere.

## Control turns in the terminal UI

These slash controls do not replace the launch mode. They operate inside an interactive session.

### Repeat work with `/loop`

Loop mode captures a prompt and submits it again after each turn. Use it for genuinely repeatable work with an observable stopping condition, such as processing the next file in a queue or fixing the next failing test.

```text
/loop
Fix the next failing test. If the suite is clean, explain that and stop.

/loop 5 Review the next unreviewed migration
/loop 30m Process the next item in the queue
/loop 1h30m Check the next repository and record the result
/loop 10 minutes Re-run the acceptance check
```

The forms mean:

- `/loop` enables an unlimited loop; the next normal prompt becomes the repeated prompt.
- `/loop <prompt>` starts an unlimited loop immediately with that prompt.
- `/loop <positive-integer> [prompt]` allows that many **automatic re-submissions after the first turn**.
- `/loop <duration> [prompt]` stops re-submitting when the wall-clock deadline expires. Accepted units are seconds, minutes, and hours, including `s`, `sec`, `m`, `min`, `h`, `hr`, plurals, compact compounds such as `1h30m`, and spaced forms such as `10 minutes`.

The status line shows `Loop waiting`, `Loop running`, or `Loop paused`, plus the remaining count or time. The slash-command autocomplete also describes the current Loop state.

Loop controls are intentionally distinct:

- Press `Esc` during an iteration to abort that turn. Loop remains enabled.
- Press `Esc` between iterations to pause, discard the captured prompt, and prevent the pending replay. The next normal prompt becomes the new loop prompt and resumes it.
- Run `/loop` again to disable Loop completely.
- A count limit or duration deadline disables Loop automatically and shows why.

By default, `loop.mode` is `prompt`, so each replay continues in the same conversation. The `compact` setting compacts before each replay; `reset` starts a fresh session before each replay. Configure these only when repeated context is the problem—see [Settings](/docs/settings).

### Force one tool call with `/force`

Use Force as a narrow correction when omp repeatedly chooses the wrong active tool. First inspect the available names with `/tools`, then force exactly one call:

```text
/force read Inspect package.json and summarize its scripts
/force:read Inspect package.json and summarize its scripts
```

Both spellings are accepted. With no inline prompt, the force applies to the next prompt you submit:

```text
/force read
```

Force is not a persistent mode. The next model call must invoke that active tool once, then the agent turn ends without another tool call. The following turn is normal again. There is no Force badge because there is no lasting state; omp shows a confirmation when the next turn is pinned.

Force fails rather than guessing when the named tool is inactive or the current model cannot force a named tool. This matters in [Plan mode](/docs/plan), where write-capable tools are intentionally unavailable.

### Request priority serving with `/fast`

Fast mode asks the current model family to use its priority serving path:

```text
/fast on
/fast off
/fast status
/fast
```

Bare `/fast` toggles. Prefer `/fast on` when you need deterministic state because it is idempotent and reports when the current model has no compatible service-tier control.

The setting is session-persisted and scoped independently to the OpenAI, Anthropic, and Google model families. If you enable Fast on an OpenAI-family model, switch to an Anthropic model, and later switch back, the OpenAI-family choice is still on; the Anthropic family keeps its own choice.

When priority is actually active, the model segment shows the Fast icon when the theme provides one. `/fast status` is the direct check for the current model family's configured state; `/fast on` reports when that model has no compatible priority control. If a provider rejects priority serving, omp retries without it, turns Fast off for that family, and shows a warning.

Priority service can cost more and contributes to premium-request accounting. Check `/usage` or `omp stats` rather than assuming lower latency is free.

## How the controls combine

| Combination | Result |
| --- | --- |
| Loop + Fast | Every repeated turn uses Fast when the active model supports the selected family's priority tier. |
| Loop + Force | Only the first forthcoming model call is forced. Later loop re-submissions are unforced. |
| Loop + active Goal | Loop takes precedence over automatic Goal continuation until Loop is disabled. Use [Goal mode](/docs/goal) for objective-driven autonomy instead of stacking both without a reason. |
| Loop + Plan, Prewalk, Goal, or Vibe | The controls may still be active, but the single mode segment shows the higher-priority work state instead of Loop. This is display priority, not proof that Loop is off. |
| `loop.mode: reset` + Vibe | The combination is rejected: omp disables Loop and tells you to exit Vibe before using reset loops. |
| Force + Plan | Force can select only tools active in Plan's read-only environment. |
| Any launch `--mode` + another launch mode | Launch modes are mutually exclusive; pass one `--mode` value. RPC and ACP own stdin, so piped bytes are protocol frames, not a prompt. |

Fast has its own model-segment icon, so it remains visible independently of the single work-mode segment. To verify a Loop hidden by another work-state badge, open slash autocomplete for `/loop`; to stop it, run `/loop`.

## Choose a work mode, not a transport mode

Several deeper features change how omp approaches work. They are available within the appropriate launch modes and have their own controls:

- [Plan mode](/docs/plan) — review an approach before implementation.
- [Goal mode](/docs/goal) — pursue a durable objective across turns.
- [Vibe mode](/docs/vibe) — coordinate parallel workers.
- [Prewalk](/docs/prewalk) — hand planned implementation to a faster model.
- [Advisor](/docs/advisor) — passively review work and surface concerns.

Use those pages for their lifecycle and safety controls. Use this page to choose how omp is launched and whether the current terminal turn should repeat, force one tool, or request priority serving.

## Troubleshooting

**The terminal UI opened, but I wanted output for a script.**
Use `-p` for final text or `--mode json` for events. A bare positional prompt does not make omp headless.

**A piped command appears stuck before any work starts.**
omp must read stdin through EOF. Check that the producer closes the pipe; after one second omp reports what it is waiting for on stderr.

**`omp acp` appears idle.**
That is a server waiting for an ACP client, not a standalone UI. Configure your editor to spawn it; see [ACP](/docs/acp).

**Loop is repeating but its badge disappeared.**
Plan, Prewalk, Goal, and Vibe take display priority in the one mode segment. Check `/loop` in slash autocomplete. Run `/loop` to disable it.

**`/force` says the tool is not active.**
Run `/tools`. Change the current work mode if it intentionally removed the tool, or choose one of the active names.

**`/fast on` is unavailable or turned itself off.**
The current model either has no supported priority path or its provider rejected the request. Continue at the normal tier or switch to a supported model; do not repeatedly toggle after a rejection.

## Related

- [CLI reference](/docs/cli) — every launch flag and subcommand.
- [Slash commands](/docs/slash) — full interactive command reference.
- [Keybindings](/docs/keybindings) — defaults and remapping.
- [RPC mode](/docs/rpc) — native embedding protocol.
- [ACP](/docs/acp) — editor integration.
