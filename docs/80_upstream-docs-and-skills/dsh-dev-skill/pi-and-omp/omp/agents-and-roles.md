<!--
source: https://omp.sh/docs/agents-and-roles
fetched: 2026-09-06
-->

# Agents & model roles

> Choose the model that runs work, the routing slot that selects it, and the reusable specialist that decides how the work is done.

A **model**, a **role**, and an **agent** configure different layers:

| Layer | What it is | Change it when… |
| --- | --- | --- |
| **Model** | A concrete provider/model, such as `anthropic/claude-sonnet-4-5` or `openai/gpt-5.4`. | You want different capability, latency, price, context size, or provider credentials. |
| **Role** | A named routing slot, such as `default`, `smol`, or `slow`, that resolves to a model. | Several features should follow one model choice, or you want to change their model without editing every consumer. |
| **Agent** | A reusable behavior profile: a name, instructions, allowed tools, and optional model, prewalk, and advisor preferences. | You want a repeatable specialist such as a reviewer, researcher, or designer—not merely a different model. |

An agent can point at a role, and the role points at a model. For example, the `reviewer` agent normally uses `@slow`; changing the `slow` role changes the model used by future reviewer runs without changing what the reviewer does.

## A simple workflow

1. 
2. 
3. Use the librarian to verify the upstream API behavior, then summarize the source evidence.Ask the reviewer to inspect the current change for correctness. Do not edit files.Parallelize the UI polish and security check: use the designer for the interface and the security-reviewer for a read-only audit.
  Ask omp in ordinary language to use the specialist by name:
4. 

You never need to describe omp's internal delegation protocol. Name the outcome and specialist, add scope or safety limits, and let the main session coordinate the work.

## Open and navigate Agent Hub

Press <kbd>Alt</kbd>+<kbd>A</kbd> to open Agent Hub. <kbd>Ctrl</kbd>+<kbd>S</kbd> opens the same view through the legacy session-observe binding.

There is also a navigation gesture that is easy to miss:

- From an **empty main-session editor**, press <kbd>←</kbd> twice. Agent Hub opens when the current session has a worker to show.
- While **focused in a worker**, leave its editor empty and press <kbd>←</kbd> twice to return to the main session.

Select a worker and press <kbd>Enter</kbd> to open its live or persisted transcript. A message sent there steers a running worker or follows up with an idle one. Agent Hub also shows status, resolved model, current activity, lineage, tokens, requests, tool calls, active time, and measured cost when available. Use <kbd>r</kbd> to revive a parked worker and <kbd>x</kbd> to kill one whose work should not continue.

See [Subagents & Agent Hub](/docs/subagents) for statuses, isolation, steering, limits, and the complete control reference.

## Choose a bundled agent

These agents ship with omp:

| Agent | Choose it for | Normal model route |
| --- | --- | --- |
| `scout` | Fast, read-only repository exploration and compressed findings. | `@smol` |
| `designer` | UI/UX implementation, accessibility, and visual refinement. | `@designer` |
| `reviewer` | Evidence-backed correctness, quality, and security review. | `@slow` |
| `security-reviewer` | Read-only vulnerability discovery and security analysis. | The current session's model fallback |
| `librarian` | Source-verified research into external libraries and APIs. | `@smol` |
| `task` | General multi-step work with full available capabilities. | `@task` |
| `sonic` | Strictly mechanical edits or data collection with little reasoning. | `@smol` |

Use the narrowest suitable specialist. A read-only agent is safer for investigation; `task` is appropriate when no specialist fits; `sonic` is for mechanical work, not ambiguous design or review. Open `/agents` for the effective definitions in your installation because project and user agents can add names or replace bundled ones.

## Choose a role

Built-in roles route product features as well as agents:

| Role | Work routed to it |
| --- | --- |
| `default` | Normal interactive work and the main-session default. |
| `smol` | Fast, inexpensive utility work and the usual prewalk handoff target. |
| `slow` | Thorough reasoning and review where extra latency is acceptable. |
| `vision` | Image inspection by a vision-capable model. |
| `plan` | Plan-mode architecture and review. |
| `designer` | The bundled designer agent. |
| `commit` | Commit-message generation. |
| `tiny` | Very small background tasks such as titles, memory support, and speech cleanup. |
| `task` | General subagent work. |
| `advisor` | The independent model that reviews an opted-in session or worker. |

Unassigned built-in roles are resolved automatically from available authenticated models. Assign a role in `/model` when you need stable behavior, cost, or provider choice. Changing the active model for the current conversation does not rewrite saved role assignments.

The [Model roles](/docs/roles) page covers automatic selection, project storage, thinking levels, quick cycling, launch overrides, and retry fallback chains.

## How an agent gets its model

For an ordinary named worker, omp tries these sources in order:

1. **Settings override** — `task.agentModelOverrides.<agent-name>`.
2. **Agent default** — the agent's `model` frontmatter, which may contain one selector or an ordered list.
3. **Normal fallback** — the parent session's active model, then its configured/default model fallback.

A selector in either of the first two layers may be a concrete `provider/model` or a role alias such as `@slow`. Role aliases are expanded through `modelRoles` at launch.

Use `task.agentModelOverrides` when you want to reroute an existing agent without copying or editing its definition. Prefer a role alias there when several agents or features should move together:

```yaml
modelRoles:
  default: anthropic/claude-sonnet-4-5
  smol: openai/gpt-4.1-mini
  slow: openai/gpt-5.4:high
  review: openai/gpt-5.4:high

task:
  agentModelOverrides:
    reviewer: "@review"
```

With that configuration, `/model` controls which concrete model fills `review`, while `/agents` controls whether `reviewer` uses that role. A concrete model under `agentModelOverrides` bypasses the agent's frontmatter choice and does not move when a role is reassigned.

## User and project agents

Custom agent definitions are Markdown files with YAML frontmatter:

- **User scope:**`~/.omp/agent/agents/*.md` is available across projects.
- **Project scope:**`.omp/agents/*.md` belongs to the current project.

`/agents` labels definitions as **Project**, **User**, or **Bundled**. Names are case-sensitive. When names collide, the project definition wins over the user definition, and a custom definition wins over the bundled definition. This makes it possible to tailor a standard name such as `reviewer` for one repository, but it can also explain why its behavior differs there.

The model-related part of a definition can stay small:

```md
---
name: release-auditor
description: Check release readiness and report concrete blockers.
tools: read, grep, glob, bash
model: "@slow"
prewalk: false
advisor: "@advisor"
---

Inspect the assigned release scope. Report evidence and blockers; do not edit files.
```

Here `model` participates in the precedence above. `prewalk` and `advisor` provide defaults for this agent; `/agents` can override either without changing the file. Use **New agent** in `/agents` to begin a definition, or follow [Authoring subagents](/docs/subagent-authoring) for all supported frontmatter, tool restrictions, output shapes, skill loading, and validation.

After editing an agent file while omp is running, return to `/agents` and press <kbd>Ctrl</kbd>+<kbd>R</kbd> to reload the list.

## Per-agent prewalk and advisor controls

Select an agent in `/agents` to configure four properties: enabled, model, prewalk, and advisor.

- **Prewalk** starts the worker on its resolved model for planning and early implementation, then makes a one-time handoff to a faster or cheaper target. `on` uses `@smol`; `off` disables it; a model or role pattern chooses another target.
- **Advisor** pairs that worker with an independent reviewer model. `on` uses `@advisor`; `off` disables it; a model or role pattern chooses another advisor.

The corresponding settings override agent frontmatter and can be edited in `~/.omp/agent/config.yml`:

```yaml
task:
  agentPrewalk:
    task: "@smol"
    reviewer: "off"
  agentAdvisor:
    reviewer: "on"
    security-reviewer: "@slow"
```

Use `/settings` for broader defaults and limits. The **Generic Task Prewalk** setting (`task.prewalk`) affects the bundled `task` agent; per-agent choices in `/agents` still take precedence. See [Prewalk](/docs/prewalk), [Advisor](/docs/advisor), and [Settings](/docs/settings) for the full behavior of those systems.

## Cost and troubleshooting

Every worker is a separate model session. Parallel workers multiply provider requests and token use; an advisor adds its own review calls, and prewalk can use two models over one worker's lifetime. Agent Hub reports measured usage and cost when the provider exposes enough data. Start with the smallest useful fan-out, route lightweight work deliberately, and stop obsolete workers.

If the result is not what you expected:

- **Wrong behavior:** confirm the exact agent name and source in `/agents`. A project definition may be shadowing the user or bundled definition.
- **Wrong model:** inspect the effective model in `/agents`, then check `task.agentModelOverrides`, the agent's `model` frontmatter, and the referenced role in `/model`, in that order. Also confirm that the selected provider is authenticated.
- **Unknown or disabled agent:** check the case-sensitive name and enabled state, then press <kbd>Ctrl</kbd>+<kbd>R</kbd> after file changes.
- **Prewalk or advisor does not start:** check the per-agent override first, then frontmatter, role assignment, model availability, and credentials. An unavailable prewalk target is skipped rather than failing the worker.
- **Double-left does nothing:** empty the editor and confirm this session has a worker to show. <kbd>Alt</kbd>+<kbd>A</kbd> opens Agent Hub even when the roster is empty.
- **Hub shows no worker:** Agent Hub is scoped to the current session. Return to or resume the session that launched the worker.

For exhaustive behavior, continue with [Model roles](/docs/roles), [Subagents & Agent Hub](/docs/subagents), and [Authoring subagents](/docs/subagent-authoring).
