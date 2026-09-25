<!--
source: https://omp.sh/docs
fetched: 2026-09-06
-->

# Overview

> Bring a real software task to your terminal. omp can inspect the repository, change code, run your development tools, and keep the work in a resumable session.

## Start with a real task

omp is a terminal-first coding agent for work that takes more than a pasted snippet. Run it inside a project, describe the outcome you want, and it can investigate the codebase, edit files, run commands, and explain the result without making you shuttle context between an editor, a shell, and a chat window.

If this is your first visit, begin with the [Quickstart](/docs/quickstart). It covers installation and provider authentication. Then open a project and start an interactive session:

```sh
cd path/to/your-project
omp
```

Give it a concrete task in ordinary language:

```text
Find why the user-session test hangs, fix the root cause, run the smallest relevant test, and explain what changed.
```

omp streams its response and shows file operations, commands, and other work as compact cards. Press <kbd>Ctrl</kbd>+<kbd>O</kbd> to expand a card and inspect its full output or diff. You can follow up, correct course, or press <kbd>Escape</kbd> to stop the active turn.

A good first task has a clear goal and a way to verify it. If you only want an explanation, say “investigate, but do not edit.” For a large or risky change, start with [Plan mode](/docs/plan) so you can review the approach before implementation.

## Why use omp

Software work rarely ends at generating code. A useful change may require finding the right files, understanding existing conventions, renaming symbols safely, running a focused test, inspecting a live process, or checking a pull request. omp keeps that loop in one session and works with the repository and development environment already on your machine.

It is a good fit for developers who:

- prefer to direct and review work from a terminal;
- work in existing repositories where context and verification matter;
- want to choose their own model providers instead of being tied to one;
- need a short investigation today and a resumable, multi-step change tomorrow; or
- want one workflow that can grow from a single agent to planning, parallel work, and shared sessions.

omp can modify files and run commands in your environment, so review its work as you would a teammate’s change and use [approval controls](/docs/approvals) for sensitive projects. Prompts and relevant context are sent to the model provider you select; integrations may also contact their corresponding services.

## What you notice as a user

**One loop from request to verification**

Ask for an outcome rather than copying code into a browser. omp can combine repository search, edits, commands, [language-aware code intelligence](/docs/code-intelligence), [live debugging](/docs/debugging), [browser work](/docs/web), and [GitHub context](/docs/github) when the task calls for them. Its work remains visible in the session.

**Your choice of models**

Connect API-key, OAuth, subscription, gateway, or local providers, then choose models for everyday work, fast tasks, deeper reasoning, and planning. Start with [Providers](/docs/providers); use [Settings](/docs/settings) when you want to tune routing or behavior.

**Work you can leave and return to**

Sessions are saved locally by default. Resume earlier work, branch when you want to try a different direction without discarding history, or share a session when someone else needs the context. See [Sessions](/docs/sessions) for the user controls.

**Planning before implementation**

Run `/plan` for a separate planning turn, refine the proposal, and decide when to execute it. This is useful for migrations, architectural changes, and work where the order of operations matters. See [Plan mode](/docs/plan).

**Parallel work when the task actually splits**

Ask omp to delegate independent parts of a task to subagents, such as auditing several packages at once. You can watch their progress and steer them while they work. See [Subagents](/docs/subagents).

**A workflow you can extend**

Project rules and [skills](/docs/skills) teach omp how your team works. Extensions and [MCP servers](/docs/mcp) can add public integrations when the built-in capabilities are not enough.

## A practical learning path

1. **Get one prompt working:**[Quickstart](/docs/quickstart) covers installation, authentication, terminal setup, and your first session.
2. **Learn the interactive controls:**[Using omp](/docs/using) explains the screen, editor, message queue, and one-shot mode.
3. **Keep useful work:**[Sessions](/docs/sessions) covers resume, branch, fork, export, and sharing.
4. **Choose the next guide for your goal:**

| You want to… | Go to… |
| --- | --- |
| Control a running session efficiently | [Slash commands](/docs/slash) and [Keybindings](/docs/keybindings) |
| Connect or change models | [Providers](/docs/providers) and [Settings](/docs/settings) |
| Design a large change before touching code | [Plan mode](/docs/plan) |
| Investigate symbols, diagnostics, or a live process | [Code intelligence](/docs/code-intelligence) and [Debugging](/docs/debugging) |
| Split independent work or share a live session | [Subagents](/docs/subagents) and [Collab](/docs/collab) |
| Use omp from scripts or another program | [CLI reference](/docs/cli), [RPC mode](/docs/rpc), or the [SDK](/docs/sdk) |
| Add team instructions or integrations | [Skills](/docs/skills), [MCP](/docs/mcp), and [authoring extensions](/docs/extension-authoring) |

Not sure which branch to take? Complete the [Quickstart](/docs/quickstart), run one small task in a repository you know, and continue with [Using omp](/docs/using).
