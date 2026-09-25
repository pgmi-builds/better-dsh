<!--
source: https://pi.dev/docs/latest
fetched: 2026-09-06
-->

# Pi Documentation

Pi is a minimal terminal coding harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and pi packages.

## Quick start

Install Pi with npm:

```
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Pi does not require install scripts for normal npm installs.

On Linux or macOS, you can also use the installer:

```
curl -fsSL https://pi.dev/install.sh | sh
```

To uninstall pi itself, use npm for curl and npm installs:

```
npm uninstall -g @earendil-works/pi-coding-agent
```

For pnpm, Yarn, or Bun installs, use the matching global remove command: `pnpm remove -g @earendil-works/pi-coding-agent`, `yarn global remove @earendil-works/pi-coding-agent`, or `bun uninstall -g @earendil-works/pi-coding-agent`.

Then run it in a project directory:

```
pi
```

Authenticate with `/login` for subscription providers, or set an API key such as `ANTHROPIC_API_KEY` before starting pi.

For the full first-run flow, see [Quickstart](/docs/latest/quickstart).

## Start here

- [Quickstart](/docs/latest/quickstart) - install, authenticate, and run a first session.
- [Using Pi](/docs/latest/usage) - interactive mode, slash commands, context files, and CLI reference.
- [Providers](/docs/latest/providers) - subscription and API-key setup for built-in providers.
- [llama.cpp](/docs/latest/llama-cpp) - run a local router and manage models with `/llama`.
- [Security](/docs/latest/security) - project trust, sandbox boundaries, and vulnerability reporting.
- [Containerization](/docs/latest/containerization) - sandbox pi with Gondolin, Docker, or OpenShell.
- [Settings](/docs/latest/settings) - global and project settings.
- [Keybindings](/docs/latest/keybindings) - default shortcuts and custom keybindings.
- [Sessions](/docs/latest/sessions) - session management, branching, and tree navigation.
- [Compaction](/docs/latest/compaction) - context compaction and branch summarization.

## Customization

- [Extensions](/docs/latest/extensions) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](/docs/latest/skills) - Agent Skills for reusable on-demand capabilities.
- [Prompt templates](/docs/latest/prompt-templates) - reusable prompts that expand from slash commands.
- [Themes](/docs/latest/themes) - built-in and custom terminal themes.
- [Pi packages](/docs/latest/packages) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](/docs/latest/models) - add model entries for supported provider APIs.
- [Custom providers](/docs/latest/custom-provider) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](/docs/latest/sdk) - embed pi in Node.js applications.
- [RPC mode](/docs/latest/rpc) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](/docs/latest/json) - print mode with structured events.
- [TUI components](/docs/latest/tui) - build custom terminal UI for extensions.

## Reference

- [Environment variables](/docs/latest/environment-variables) - Pi process configuration and session metadata available to bash tools.
- [Session format](/docs/latest/session-format) - JSONL session file format, entry types, and SessionManager API.

## Platform setup

- [Windows](/docs/latest/windows)
- [Termux on Android](/docs/latest/termux)
- [tmux](/docs/latest/tmux)
- [Terminal setup](/docs/latest/terminal-setup)
- [Shell aliases](/docs/latest/shell-aliases)

## Development

- [Development](/docs/latest/development) - local setup, project structure, and debugging.
