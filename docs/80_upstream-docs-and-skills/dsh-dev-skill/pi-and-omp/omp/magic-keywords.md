<!--
source: https://omp.sh/docs/magic-keywords
fetched: 2026-09-06
-->

# Magic keywords

> Steer one prompt toward deeper reasoning or coordinated parallel work with an exact standalone word.

Magic keywords are optional, one-turn shortcuts. Put a recognized standalone word in a normal prompt when you want omp to change how it approaches **that prompt** without switching on a persistent mode.

Start with the behavior you need:

```text
ultrathink about the failure modes before changing this public API

orchestrate the migration across the server, client, and tests

workflowz perform an adversarial review of authentication, authorization, and session handling
```

The word remains part of your visible message. In the terminal editor, omp paints a recognized occurrence with a moving gradient while the editor is focused; the sent message uses a static gradient. This is a recognition aid, not confirmation that the keyword's behavior is enabled or that its required tools are available.

## Choose a keyword

| Keyword | Use it when… | What to expect |
| --- | --- | --- |
| `ultrathink` | A decision, diagnosis, or risky change deserves especially careful reasoning. | omp asks for a careful multi-step approach. If automatic thinking is active, this turn also uses the highest reasoning effort supported by the current model. |
| `orchestrate` | A substantial task has independent work that can profitably run in parallel. | omp scopes the task, delegates suitable independent parts to subagents, integrates the results, and verifies the work. |
| `workflowz` | Broad research, a review, migration, or adversarial analysis benefits from an explicit, deterministic multi-agent workflow. | omp builds a structured workflow with parallel and staged subagent work, then synthesizes the results. |

These words steer execution; they do not guarantee a particular answer or a fixed number of workers. A small or tightly coupled request may have little useful parallel work. `workflowz` is the more explicit workflow-building choice; `orchestrate` is the general-purpose delegation choice.

## Scope: one submitted prompt

A keyword affects only the turn whose submitted user message contains it. It does not become session state and does not carry into the next prompt.

```text
orchestrate inspect the three independent packages and fix their failing builds
```

The orchestration request applies to that turn, including the work omp performs to finish it. A later prompt such as “Now update the release notes” is normal unless you include a keyword again. Multiple enabled keywords in one prompt can all apply, although combining them may add cost without improving the result; usually choose the single best fit.

## Exact matching rules

Matching is case-sensitive and deliberately excludes code-like contexts. Use the exact lowercase spelling as standalone prose.

**Matches:**

```text
Please ultrathink before choosing a migration strategy.
"orchestrate" the independent investigations.
Can you workflowz, then summarize the strongest evidence?
```

Sentence punctuation and quotation marks may touch the word.

**Does not match:**

```text
Ultrathink about this                 # wrong case
orchestrated this migration           # part of another word
my_orchestrate_helper                 # identifier
orchestrate.ts                         # file name
foo::orchestrate                      # symbol reference
orchestrate()                          # call syntax
plans/orchestrate/checklist            # path
`workflowz` this review                # inline code
```

Letters, digits, underscores, slashes, backslashes, hyphens, file-extension suffixes, `::`, and immediate call parentheses bind the word into a code-like token. Occurrences inside inline code, fenced code blocks, and HTML/XML comments, tags, or elements are ignored. This lets you discuss a symbol or paste code without accidentally steering the turn.

If you need to mention the word without activating it, put it in inline code or a fenced block, change its case, or disable that keyword before submitting.

## Prerequisites and fallback behavior

- `ultrathink` needs no subagent tool. Its automatic-thinking override matters only when thinking is set to automatic; otherwise the current thinking selection remains in force. Models differ in the reasoning efforts they support, so “highest” means the highest supported by the active model.
- `orchestrate` requires the subagent task capability to be active. Without it, no orchestration behavior is added; the visible prompt is still submitted normally.
- `workflowz` requires both the subagent task capability and the persistent evaluation capability to be active. If either is unavailable, no workflow behavior is added; the visible prompt is still submitted normally.

Plan mode, tool configuration, or other session controls can make capabilities unavailable. Check `/tools` when `orchestrate` or `workflowz` appears to have had no effect. The colored word can still appear because highlighting recognizes text independently of capability checks.

## Enable or disable keywords

All four settings below default to `true`. In the terminal UI, open `/settings`, then go to **Interaction → Magic Keywords**. The main **Magic Keywords** switch gates every keyword; the three keyword switches control them individually.

You can make the same changes from the shell:

```sh
# Disable all keyword behavior
omp config set magicKeywords.enabled false

# Disable one behavior while leaving the others available
omp config set magicKeywords.ultrathink false
omp config set magicKeywords.orchestrate false
omp config set magicKeywords.workflow false

# Re-enable them
omp config set magicKeywords.enabled true
omp config set magicKeywords.ultrathink true
omp config set magicKeywords.orchestrate true
omp config set magicKeywords.workflow true
```

The setting name is `magicKeywords.workflow`, even though the prompt word is `workflowz`. Run `omp config list` and inspect the `magicKeywords.*` values to verify the effective configuration. Configuration scopes and precedence are covered in [Settings](/docs/settings).

Disabling the global switch stops the editor's animation, but recognized words can remain statically colored in the editor and sent messages. Per-keyword switches do not control highlighting. Therefore, verify enablement through `/settings` or `omp config list`, not color alone.

## Cost and parallelism

Magic keywords do not create a separate billing mode, but they can increase usage:

- `ultrathink` can spend more reasoning tokens when automatic thinking selects the model's maximum supported effort.
- `orchestrate` and `workflowz` may run several subagents concurrently. Parallel execution can reduce elapsed time, but each worker consumes model and tool capacity, so total usage can be materially higher than a single-agent turn.
- More workers are not automatically better. Give independent deliverables, boundaries, and a concrete acceptance check so parallel work is useful rather than duplicated.

Use `/usage` or `omp stats` to inspect usage instead of assuming that faster wall-clock completion costs less.

## Troubleshooting

### The word is not highlighted

Check the lowercase spelling and the boundaries around it. Remove code formatting, a path or extension, identifier characters, `::`, or immediate parentheses. Highlighting is a terminal UI affordance; do not rely on it in one-shot or protocol output.

### The word is highlighted but behavior did not change

Check **Interaction → Magic Keywords** or `omp config list`. The global and matching per-keyword switches must both be on. For `orchestrate`, confirm the task capability in `/tools`; for `workflowz`, confirm both task and evaluation capabilities. Highlighting alone does not prove that behavior was injected.

### `ultrathink` did not change the displayed thinking level

Its maximum-effort override applies when automatic thinking is active and is limited to levels supported by the current model. With a manually selected thinking level, it still steers the turn toward care but does not replace that selection.

### Too many agents ran or usage was higher than expected

Use a narrower prompt, name the genuinely independent slices, or omit the keyword for work that is sequential or small. Disable the individual keyword if you want mentions to remain ordinary prose while keeping the other shortcuts available.
