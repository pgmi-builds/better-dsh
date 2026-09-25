<!--
source: https://omp.sh/docs/ttsr
fetched: 2026-09-06
-->

# Time-Traveling Stream Rules

> Stop a specific mistake while omp is generating it, inject the correction, and let the agent try again before the mistake takes effect.

A **Time-Traveling Stream Rule (TTSR)** is a guardrail for a recognizable mistake in the agent's live output: a forbidden API in an edit, an unsafe shell fragment, or a recurring claim in prose. When the rule matches, omp can interrupt that response, show which rule fired, supply the rule's Markdown instructions, and restart generation with the correction in view.

Use TTSR for guidance that is:

- important only when a particular pattern appears;
- specific enough to detect reliably; and
- most useful *before* the proposed tool call runs.

This is better than [always-on context](/docs/context-files) when the instruction is narrow or rarely relevant. Always-on context is better for conventions the agent must consider throughout every task, because TTSR is reactive: it cannot help until its condition appears.

## Create the smallest useful rule

From the project root, create `.omp/rules/no-box-leak.md`:

```md
---
description: Prevent permanent Box::leak allocations in Rust edits
condition: 'Box::leak\('
scope:
  - 'tool:edit(*.rs)'
  - 'tool:write(*.rs)'
---

Do not introduce `Box::leak` in production Rust code. Keep ownership explicit;
prefer `Arc<str>`, `Cow<'static, str>`, or a true process-lifetime singleton,
then continue with the option that fits this code.
```

The filename becomes the rule name, `no-box-leak`. The frontmatter says *when and where* to react; the Markdown body says *why and what to do instead*. Keep the body short and actionable—the model receives it only when the rule fires.

Save rules in one of these native locations:

| Location | Use |
| --- | --- |
| `<project>/.omp/rules/<name>.md` or `.mdc` | Project rule; normally commit it with the repository. |
| `~/.omp/agent/rules/<name>.md` or `.mdc` | Personal rule for every project. The directory follows the active profile and `PI_CODING_AGENT_DIR`. |

Project and user rules are discovered when a session starts. Start a new session after adding or changing a file.

## Test, inspect, and enable it

Test a rule file in isolation before relying on discovery:

```bash
omp ttsr test \
  --rule .omp/rules/no-box-leak.md \
  --source tool --tool edit --path src/lib.rs \
  'let value = Box::leak(Box::new(input));'
```

The report should list `no-box-leak` under triggered rules. The source, tool, and candidate path matter: they reproduce the context used by `scope` and `globs`. Other useful checks are:

```bash
# Show every active TTSR rule, its conditions, scope, and source file.
omp ttsr list

# Explain both matching and non-matching rules for a sample.
omp ttsr test --verbose --source tool --tool edit --path src/lib.rs \
  'let value = Box::leak(Box::new(input));'

# Look for existing files that would match the rule.
omp ttsr scan --rule .omp/rules/no-box-leak.md src/
```

`omp ttsr test src/lib.rs` also works: a recognized source-file extension implies a tool/edit context. Use explicit flags when diagnosing a path or scope mismatch. `--json` is available for scripting, and `--file -` reads a sample from stdin.

TTSR is enabled by default. To enable it explicitly and inspect the effective value:

```bash
omp config set ttsr.enabled true
omp config get ttsr.enabled
```

`omp config set` writes the active profile's global `~/.omp/agent/config.yml`. For a project-only override, edit `<project>/.omp/config.yml` instead. Inside omp, `/extensions` is another way to inspect discovered rules and their source paths.

## What firing looks like

With the default `interruptMode: always`, a matching response stops immediately. The TUI shows an **Injecting rule: no-box-leak** notification, the partial attempt is discarded by default, and the agent generates a replacement response using the rule body. A matching edit or write is stopped before that incomplete call executes.

This is an interruption and retry, not a text replacement: the rule should explain the safe alternative rather than attempt to rewrite code itself. A narrowly placed trigger keeps the retry early and inexpensive.

For a soft tool-specific nudge, set `interruptMode: never` on the rule. omp lets the matched tool finish and places the reminder alongside that tool's result for the agent's next step. On prose, `never` lets the response finish and follows it with the correction. Use this only when allowing the matched action to complete is safe.

## Matching and scope

`condition` is a JavaScript regular expression. It is evaluated against the accumulated content for each watched output surface, so it can match across streamed chunks. For `edit` and `write`, omp matches the source content being introduced rather than serialized command syntax. Other tools are matched against their streamed arguments.

Prefer the smallest distinctive pattern:

```yaml
condition: 'Box::leak\('
```

Avoid a broad pattern such as `leak`, which also catches discussion, logs, and unrelated identifiers. YAML single quotes make regex backslashes easiest to read. Leading `(?i)`, `(?m)`, and `(?s)` flags are supported; otherwise use JavaScript regular-expression syntax.

A rule may provide a string or a list for `condition`. Multiple regex conditions are alternatives: any one can trigger. `astCondition` provides the same OR behavior with ast-grep patterns. If both kinds are present, either kind can trigger after scope and path gates pass.

With no `scope`, a rule watches assistant prose and every tool's arguments, but not thinking. An explicit scope replaces that default. Supported tokens are:

| Scope token | Watches |
| --- | --- |
| `text` | Assistant prose. |
| `thinking` | The model's thinking stream when the provider exposes one. |
| `tool` or `toolcall` | Every tool. |
| `tool:<name>` | One tool, for example `tool:bash`. Bare tool names such as `bash` are also accepted. |
| `tool:<name>(<glob>)` | One tool only when its candidate path matches, for example `tool:edit(src/**/*.ts)`. |

A comma-separated string and a YAML list are both accepted. Prefer a YAML list when combining scopes. Path globs match normalized paths and basenames. A top-level `globs` field is an additional path gate across all scopes; at least one candidate path must match it.

AST matching is useful when formatting or identifier names make regex too fragile:

```md
---
description: Reject TypeScript any assertions
astCondition:
  - '$VALUE as any'
scope:
  - 'tool:edit(*.ts)'
  - 'tool:write(*.ts)'
---

Preserve the real type. Narrow or model it instead of asserting `any`.
```

`astCondition` works only on source-bearing edit/write content with a recognizable file extension. It examines content introduced by the call, not unchanged code elsewhere in the file. Test it with `--source tool` and `--path`.

## Repeats, cooldowns, and precedence

By default, each rule fires once per session. That fired state is saved with the session, so resuming does not unexpectedly re-arm it. To allow another injection after a cooldown, configure the global repeat policy:

```bash
omp config set ttsr.repeatMode after-gap
omp config set ttsr.repeatGap 10
```

The gap counts completed turns, not seconds or stream fragments. All TTSR rules use this global repeat policy.

Precedence is predictable:

1. Rules named in `ttsr.disabledRules` are removed.
2. A project native rule wins over a user native rule with the same filename-derived name; more generally, the first rule discovered for a name wins.
3. A valid rule with `condition` or `astCondition` is a TTSR rule even if it also says `alwaysApply: true`; it is not also injected as always-on context.
4. A rule's `interruptMode` overrides the global `ttsr.interruptMode`.
5. If several eligible rules match the same output, omp can inject all distinct matches. If any matching rule requires interruption, the response is interrupted.

Use unique, descriptive filenames to avoid accidental shadowing. Confirm the effective source with `omp ttsr list`.

## Complete rule frontmatter

All fields are optional except that a TTSR rule needs at least one usable `condition` or `astCondition`. String fields marked “list” also accept a single string.

| Field | Type | Meaning |
| --- | --- | --- |
| `description` | string | Human-readable summary shown by rule inspection. Recommended. |
| `condition` | string or string list | JavaScript regex alternatives. A legacy `ttsr_trigger` spelling is accepted, but use `condition` for new rules. |
| `astCondition` | string or string list | ast-grep pattern alternatives for edit/write source content. |
| `scope` | string or string list | Output surfaces and optional tool/path filters. Omit for `text` plus all tools, excluding thinking. |
| `globs` | string or string list | Additional candidate-path gate. This does not replace `scope`. |
| `interruptMode` | `always`, `prose-only`, `tool-only`, or `never` | Per-rule override for which matching surfaces abort immediately. |
| `alwaysApply` | boolean | General rule metadata. A valid TTSR condition takes precedence, so combining them does not make the body always-on. |
| For compatibility, a `condition` value that looks like a file glob (such as `*.rs`) is treated as shorthand for watching `edit` and `write` on that glob with a catch-all condition. Prefer an explicit regex plus `scope`; it makes the trigger's intent and test context clear. |  |  |

The Markdown after frontmatter is the injected instruction. The rule name and source path come from discovery; do not put them in frontmatter.

The complete global TTSR configuration is:

```yaml
ttsr:
  enabled: true
  contextMode: discard       # discard | keep
  interruptMode: always      # always | prose-only | tool-only | never
  repeatMode: once           # once | after-gap
  repeatGap: 10              # completed turns
  builtinRules: true
  disabledRules: []          # filename-derived rule names
```

`contextMode: keep` retains the partial response before retry; `discard` removes it and is safer for most guardrails. `builtinRules: false` disables only omp's bundled TTSR rules, not your files. Disable one rule without deleting it with:

```bash
omp config set ttsr.disabledRules '["no-box-leak"]'
```

Start a new session after changing TTSR configuration so discovery and session state are unambiguous.

## Safety and performance

- Scope dangerous-action rules to the relevant tool and file type. Watching all prose and tools increases false positives and matching work.
- Interrupt before the unsafe fragment is complete. A TTSR match cannot undo a tool call that already finished.
- Keep regexes linear and specific. Avoid nested, ambiguous repetition such as `(.*)+`, which can become expensive as output grows.
- Prefer `astCondition` for structural code rules, but constrain it by tool and extension; structural matching costs more than a simple regex.
- Do not put secrets in rule bodies. The body is sent to the selected model when the rule fires and may be retained in the session.
- Run `omp ttsr scan` before enabling a broad repository rule. Review matches rather than treating every textual occurrence as a violation.
- Use `interruptMode: never` only when it is acceptable for the matched tool action to execute.

## Troubleshooting

### `omp ttsr list` does not show the rule

- Confirm the file is `.md` or `.mdc` in `.omp/rules/` or the active profile's `rules/` directory.
- Ensure frontmatter begins at the first line, has closing `---`, and contains a non-empty `condition` or `astCondition`.
- Check `omp config get ttsr.enabled`, `omp config get ttsr.disabledRules`, and `omp config get ttsr.builtinRules`.
- Look for another discovered rule with the same filename-derived name.
- Start a new session after editing the file.

### The isolated test does not trigger

Run with `--verbose` and reproduce the live context exactly:

```bash
omp ttsr test --verbose --rule .omp/rules/no-box-leak.md \
  --source tool --tool edit --path src/lib.rs 'Box::leak('
```

Check regex escaping, tool name, `scope`, top-level `globs`, and path extension. An AST rule without `--source tool` and a file extension cannot infer a language. Invalid regex and AST patterns are ignored rather than stopping session startup.

### The test triggers but a live session does not

The session may have loaded the previous file, the rule may already have fired under `repeatMode: once`, or the live action may use a different tool/path surface. Start a fresh session, inspect with `omp ttsr list`, and test with the same `--source`, `--tool`, and `--path`.

### The rule fires too often

Narrow `condition`, add a tool/path `scope`, or add `globs`. Use `ttsr.disabledRules` as an immediate off switch while revising it. Do not solve false positives by making the body vague—the trigger should identify the violation.

### The partial response remains visible

Check `omp config get ttsr.contextMode`. Set it back to `discard` for clean retries. Also check whether the rule or global `interruptMode` is `never` for that surface; non-interrupting matches intentionally allow the current response or tool to finish.

## Related

- [Context files](/docs/context-files) — guidance that belongs in every prompt.
- [Hooks](/docs/hooks) — deterministic interception around tool execution.
- [Skills](/docs/skills) — on-demand playbooks selected for a task.
