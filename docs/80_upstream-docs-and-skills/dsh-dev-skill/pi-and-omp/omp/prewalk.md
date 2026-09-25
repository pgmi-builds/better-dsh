<!--
source: https://omp.sh/docs/prewalk
fetched: 2026-09-06
-->

# Prewalk

> Let a capable model investigate and begin a change, then hand the same session to a faster or cheaper model for implementation.

## Plan with strength, implement with speed

Prewalk is a one-time model handoff inside a normal omp session. Start on the model you trust to understand an unfamiliar repository, identify risks, and organize the work. Once that model has made a todo list and begun changing the project, omp switches the current session to a faster or cheaper target model to continue the implementation.

A useful first run is:

```sh
omp --model @slow --prewalk-into @smol
```

Then describe the complete outcome as usual. The conversation, repository context, todos, and changes stay in the same session; prewalk changes the model doing the remaining work, not the task.

This can reduce cost and latency on changes where planning is difficult but execution is routine. It is a tradeoff, not a free quality improvement: the target model still has to understand the planner's todos, adapt when implementation reveals a bad assumption, test the result, and finish cleanup. Keep one capable model throughout when the work requires repeated design decisions, subtle debugging, or high-risk edits.

## Enable it and choose the target

Prewalk is disabled by default. Arm it for one new session with `--prewalk`:

```sh
omp --prewalk
```

This uses the model assigned to the `smol` role. To make the choice predictable, assign that role in `/model` under **Roles**, or configure it in `~/.omp/agent/config.yml`:

```yaml
modelRoles:
  smol: anthropic/claude-haiku-4-5
```

To choose a different target for one launch, pass a role alias or model selector to `--prewalk-into`. This flag also arms prewalk, so `--prewalk` is not required alongside it.

```sh
omp --prewalk-into @smol
omp --prewalk-into openai/gpt-5-mini
```

Use a full `provider/model-id` when you need a stable exact choice. A configured role can also carry a thinking level, and a model selector may include one, such as `provider/model-id:medium`. omp resolves the target using the same role and model-matching rules as other model controls.

For persistent opt-in, set:

```sh
omp config set prewalk.enabled true
```

The equivalent YAML is:

```yaml
prewalk:
  enabled: true
```

With the setting enabled, each fresh session is armed and targets `@smol`. Use `--prewalk-into <model-or-role>` to override that target for a launch, or `--no-prewalk` to keep a particular session on its starting model:

```sh
omp --no-prewalk
```

`--no-prewalk` cannot be combined with `--prewalk` or `--prewalk-into`. The persistent setting does not automatically arm a restored conversation; pass `--prewalk` explicitly if you want a handoff while continuing one.

## Recognize the handoff

An armed prewalk lets the starting model investigate and establish the implementation plan first. When todos are available, the first completed file edit starts the handoff. The edit itself is made by the starting model; the target model receives the same session and continues from there.

You will see notices that make the lifecycle explicit:

- **Armed** — identifies the resolved target and says omp is waiting for the todo list and first edit or write.
- **Switched** — identifies the target and reports that the switch followed the first edit or write.
- **Nothing to switch** — the target model and thinking level already match the active session, so omp disarms prewalk instead of performing a no-op.

The handoff waits if the model is still only reading, searching, or discussing an approach. If todos are available but no project file has yet been changed, it remains armed. In configurations where todos are unavailable, the first completed file edit can hand off directly.

Prewalk is one-shot. After the switch it is no longer armed, and later edits do not cause more model changes. The target becomes the current model for the remainder of the live session, but the switch does not rewrite your saved model-role settings. The model indicator and the switch notice show which model is currently active.

## Arm it in an active session

Run `/prewalk` to arm a handoff without restarting or changing `prewalk.enabled`:

```text
/prewalk
```

The command resolves `@smol`, checks that it is usable, and displays the target when it arms successfully. It does not accept a target argument; use `--prewalk-into` when starting omp if you need another target.

If prewalk is already armed, `/prewalk` keeps the existing target rather than replacing it. After a handoff has happened, you can choose another current model with the normal model controls and run `/prewalk` again to create another one-shot handoff.

## Choose where to spend model quality

A good prewalk target is authenticated, quick, inexpensive, and reliable at the languages and tools the task needs. Compare the expected savings with the cost of repairing a weak implementation:

| Work shape | Suggested choice |
| --- | --- |
| Broad investigation followed by repetitive call-site updates | Strong starter, fast target |
| Clear plan followed by routine tests or mechanical edits | Strong starter, cheap target |
| Security-sensitive migration or behavior with hidden invariants | Keep the capable model active |
| Debugging where each result changes the next hypothesis | Usually skip prewalk |
| Small, obvious edit | Start on the inexpensive model directly; prewalk adds little |

A stronger planner should leave specific, ordered todos and begin with a representative edit. If the target frequently has to rediscover constraints, use a more capable target or do not hand off.

## Prewalk and subagents

This page describes the main session handoff. A task subagent is a separate delegated run with its own context and model selection; arming the main session does not mean every subagent will prewalk. Configure subagent prewalk separately only when you use delegated agents and want the same plan-then-switch pattern inside those runs. See [Subagents](/docs/subagents).

## Troubleshooting

- **No armed notice appears at startup** — prewalk is off unless `prewalk.enabled` is `true` or the launch includes `--prewalk` or `--prewalk-into`. A restored session does not inherit automatic arming from the setting; pass the flag explicitly.
- **`Warning: prewalk disabled — model … not found`** — the target role or selector did not resolve. Check the effective `smol` assignment in `/model`, or use a full selector returned by `omp models find <name>`.
- **`Warning: prewalk disabled — no API key for …`** — authenticate the target provider or select a model whose provider is already configured. omp continues startup with prewalk unarmed.
- **`/prewalk` reports a model or API-key error** — `/prewalk` always uses `@smol`. Fix that role or its provider credentials; to use another target, restart with `--prewalk-into`.
- **It is armed but has not switched** — let the starting model finish investigation, create its todos, and begin the first project edit. Read-only work and discussion do not consume the handoff.
- **The first edit happened but no switch followed** — check whether the edit failed, whether the target already matched the current model and thinking level, or whether the visible notice says prewalk was disabled during target resolution.
- **`/prewalk` says it is already armed for another model** — the existing one-shot target is preserved. Let it hand off, or start a new session with the desired `--prewalk-into` target.
- **Quality drops after the switch** — choose a stronger target, assign more appropriate thinking effort, or use `--no-prewalk` for tasks whose design continues throughout implementation.
