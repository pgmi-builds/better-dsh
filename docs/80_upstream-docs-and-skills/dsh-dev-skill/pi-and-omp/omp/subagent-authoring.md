<!--
source: https://omp.sh/docs/subagent-authoring
fetched: 2026-09-06
-->

# Authoring subagents

> Define a named specialist in one Markdown file, give it only the tools it needs, and ask omp to use it by name.

A custom subagent is useful when you repeat the same delegation: reviewing an API, checking migrations, researching a dependency, or making a tightly scoped kind of change. Give that work a stable name and instructions once, then ask omp to use the specialist whenever the need returns.

## Create the smallest useful agent

For a project-specific, read-only API reviewer, create `.omp/agents/api-reviewer.md`:

```md
---
name: api-reviewer
description: Review API changes for compatibility, missing tests, and contract drift.
tools: [read, grep, glob]
---

Review the assigned API change.

Check exported types, HTTP behavior, tests, and documented contracts. Report only concrete findings with file and line references. Do not edit files.
```

Only `name` and `description` are required. The Markdown body is the agent's durable instructions. This example grants an explicit read-only tool set rather than inheriting every tool available to the current session.

Save the file, open `/agents`, and press <kbd>Ctrl</kbd>+<kbd>R</kbd>. Search for `api-reviewer` and confirm that the detail pane shows the expected file path. If it is disabled, press <kbd>Space</kbd> to enable it.

Then ask naturally and use the exact name:

```text
Use the api-reviewer subagent to review the current branch. Keep it read-only and report actionable findings.
```

You do not need a special request format. Naming the agent is the clearest way to select it; its `description` also tells omp when the specialist is appropriate.

## Choose where it lives

| Scope | Location | Use it for |
| --- | --- | --- |
| Project | `<project>/.omp/agents/<name>.md` | Repository-specific conventions that should travel with the project. omp walks upward from the current directory and uses the nearest `.omp/agents` directory. |
| User | `~/.omp/agent/agents/<name>.md` | Personal specialists available across projects. With a named profile, use `~/.omp/profiles/<profile>/agent/agents/`. |
| OMP extension | `<extension-root>/agents/<name>.md` | Agents distributed with an OMP extension package. |
| Claude marketplace plugin | `<plugin-root>/agents/<name>.md` | Agents supplied by an enabled Claude marketplace plugin. |

For a given `name`, the first definition wins:

1. the nearest project `.omp/agents` directory
2. the active user's agents directory
3. OMP extension roots, ordered by their configured source: command-line extensions, project extensions, user extensions, then installed npm/link plugins
4. Claude marketplace plugins, project scope before user scope
5. agents bundled with omp

Names are matched exactly and are case-sensitive. Prefer lowercase kebab-case names. Within one directory, files are considered in filename order, so do not keep two definitions with the same `name`. A project or user definition can intentionally replace a plugin or bundled agent by reusing its name; `/agents` shows which file won.

Direct `.claude/agents`, `.codex/agents`, and similar cross-tool directories are not scanned. Their frontmatter contracts are not interchangeable with omp's.

## Write effective instructions

Keep the body specific to the reusable role. State:

- what the agent owns and what it must not do
- the checks or workflow it should follow
- the evidence expected in its answer
- whether it may edit files
- any project boundaries that remain true across assignments

Put the changing work in your request, not in the definition. For example, keep “review API compatibility” in the file and put “review the pagination change on this branch” in the prompt. Avoid copying general project instructions into every agent; normal project context still applies.

The `description` is a selection hint, not a second system prompt. Use concrete verbs, subject matter, and boundaries: “Review database migrations for unsafe locks and rollback gaps” is more useful than “A helpful database expert.”

## Grant tools safely

An explicit `tools` list is a capability boundary. Start with the smallest set that can complete the job:

- investigation usually needs `read`, `grep`, and `glob`
- add `lsp` when semantic code navigation is useful
- add `edit` or `write` only when the agent is meant to change files
- add `bash` only when it must run commands; shell access can also modify the workspace
- add `web_search`, `browser`, `github`, or plugin/MCP tools only when external access is part of the role
- add `task` only when this specialist must delegate further, and restrict `spawns` as well

When `tools` is omitted, the agent inherits the parent session's available tools. That is convenient for a general-purpose worker but is usually too broad for a reviewer. omp automatically adds the private completion capability an agent needs; do not add it yourself.

Isolation is chosen for an individual delegation, not in agent frontmatter. Ask for it explicitly when the agent will make risky or independent changes:

```text
Use the migration-fixer subagent in an isolated worktree to fix the failing migration test.
```

Isolation requires a supported Git checkout and configured task isolation. It separates filesystem changes; it does not make network, shell, or credential access harmless, so keep the tool grant narrow.

## Frontmatter reference

Frontmatter keys may use camelCase or kebab-case. These are the current public fields:

| Field | Meaning |
| --- | --- |
| `name` | **Required.** Exact, case-sensitive identifier used to select the agent. |
| `description` | **Required.** Short explanation of when this agent should be used. |
| `tools` | CSV string or YAML list of allowed tool names. Omit to inherit the current session's tools. |
| `model` | One model selector, a CSV string, or a YAML list tried in order. It may be a concrete selector such as `openai/gpt-5-mini` or a role alias such as `"@review"`. Omit to use normal inherited selection. |
| `thinking-level` | `inherit`, `off`, `auto`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. The older `thinking` key is also accepted. Actual support is model-dependent. |
| `spawns` | Agent names this agent may delegate to, as a CSV string or list; `*` allows any discovered agent. Omit for none. For compatibility, granting the `task` tool without this field implies `*`, so set this field explicitly. |
| `autoload-skills` | Skill names to load before the first assignment, as CSV or a list. Unknown names are ignored. |
| `read-summarize` | Set `false` when `read` must return verbatim code rather than structural summaries. Normally leave it enabled. |
| `output` | JSON Schema for a structured result. Omit when a normal prose report is appropriate. |
| `blocking` | Set `true` when callers should wait for this agent even if asynchronous delegation is enabled. Usually omit it. |
| `prewalk` | `true` hands off to the model in the `smol` role at the first edit or write; a model selector or role alias chooses another target. Use it when a stronger model should inspect or plan before a cheaper model implements. |
| `advisor` | `true` uses the configured `advisor` model role; a model selector or role alias chooses a specific advisor. Subagents otherwise run without an advisor. |

There is no separate `role` field. Put a role alias in `model`, then map that alias in your user or project configuration. This keeps agent instructions stable while letting each environment choose the concrete model:

```md
---
name: api-reviewer
description: Review API changes for compatibility, missing tests, and contract drift.
tools: [read, grep, glob]
model: "@review"
thinking-level: high
---

Review the assigned API change and report concrete findings with file and line references.
```

```yaml
# ~/.omp/agent/config.yml, or the active profile's config.yml
modelRoles:
  review: openai/gpt-5.4
```

You can assign or change custom model roles from the Roles view in `/models`. The `/agents` hub also lets you override a discovered agent's model, prewalk target, or advisor without editing the shared definition; those per-agent settings take precedence over its frontmatter.

## Reload and maintain definitions

A delegation re-reads agent definitions before it starts, so a saved edit applies to the next use. The `/agents` screen has its own displayed snapshot; press <kbd>Ctrl</kbd>+<kbd>R</kbd> there after adding, renaming, or editing a file.

For agents supplied by extensions or plugins, run `/reload-plugins` after installing or changing the package so omp reloads the whole plugin surface. Plain project and user Markdown edits do not require restarting omp.

Treat project agents like code: review changes, keep descriptions accurate, and remove obsolete duplicate files. If you want editable copies of omp's bundled definitions as a starting point, run `omp agents unpack --project` or `omp agents unpack` for user scope; customize only the files you intend to override.

## Troubleshooting

**The agent is missing from `/agents`.** Press <kbd>Ctrl</kbd>+<kbd>R</kbd>, check that the file ends in `.md`, and confirm it is directly inside an `agents` directory. Verify that the frontmatter has non-empty string values for both `name` and `description`. Invalid YAML or missing required fields skips that file while discovery continues.

**The wrong definition wins.** Inspect the source path in `/agents`, then check for the same exact `name` in a higher-precedence project or user directory. In a monorepo, remember that the nearest `.omp/agents` directory is the project source.

**omp does not choose the agent.** Ask for it by exact name. Improve `description` with the task, subject, and boundary that distinguish it from other agents. Also verify in `/agents` that the agent is enabled.

**The requested model does not resolve.** Open `/models` and confirm the concrete model or role alias is configured and authenticated. For fallback behavior, list more than one selector under `model`.

**A tool is unavailable.** Add its exact registered name to `tools`, or remove the explicit list only if inheriting the full parent tool set is intentional. Plugin-provided tools also require the plugin to be enabled and reloaded.

**An edit appears ignored.** Actual delegation reads fresh definitions, but the `/agents` inventory may still show its previous snapshot. Reload the hub. For an extension or plugin package, use `/reload-plugins` as well.

## Related

- [Subagents & Agent Hub](/docs/subagents) — delegate work and observe running agents.
- [Agents & model roles](/docs/agents-and-roles) — choose whether to change behavior, routing, or the underlying model.
- [Skills](/docs/skills) — reusable playbooks an agent can autoload.
- [Plugins](/docs/plugins) — package and distribute agents with other capabilities.
- [Settings](/docs/settings) — configure model roles and task isolation.
