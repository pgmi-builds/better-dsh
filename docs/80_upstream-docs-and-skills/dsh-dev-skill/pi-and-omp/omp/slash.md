<!--
source: https://omp.sh/docs/slash
fetched: 2026-09-06
-->

# Slash commands

> The complete in-session command reference: syntax, built-ins, subcommands, aliases, dynamic commands, precedence, and reload behavior.

## Run a command

In the main prompt editor, type `/` to open autocomplete. Keep typing to filter, use the arrow keys to move, and press <kbd>Tab</kbd> or <kbd>Enter</kbd> to accept a completion. <kbd>Escape</kbd> closes the menu.

The smallest useful check is:

```text
/context
```

Press <kbd>Enter</kbd> to run it. Arguments follow the command after a space, and command families take a subcommand first:

```text
/rename investigate checkout timeout
/usage reset active
/mcp test github
```

In the forms below, `[value]` is optional, `<value>` is required, and `a|b` means choose one. Quoted arguments keep spaces together. A colon can separate a top-level command from its first argument, which is why both `/force write` and `/force:write` work.

There is no top-level `/help` built-in. Learn commands from `/` autocomplete and its inline argument hints. Type a command family plus a space to see its subcommands. `/mcp help`, `/ssh help`, and `/marketplace help` print family-specific usage; `/hotkeys` shows keyboard shortcuts. Invalid arguments also print the accepted form.

This page describes the interactive terminal. Commands run only from the main session editor, not while a subagent chat is focused. During a collaboration, guests may run only `/dump`, `/export`, `/copy`, `/hotkeys`, `/settings`, `/leave`, `/collab`, `/exit`, and `/quit` locally; every other slash command is host-only.

## Built-in commands

These names ship in the core registry and take precedence over dynamically discovered commands.

### Modes, models, and turn control

| Command | Visible effect and availability |
| --- | --- |
| `/settings` | Opens the settings menu. |
| `/setup [providers]` Alias: `/providers` | Opens provider setup for sign-in and web-search providers. No other subcommand is accepted. |
| `/plan [prompt]` | Toggles plan mode; an inline prompt starts planning immediately. Requires `plan.enabled`, cannot start during goal mode, and is mutually exclusive with vibe mode. See [Plan mode](/docs/plan). |
| `/plan-review` | Reopens the latest plan review. Available only while plan mode is active. |
| `/vibe [prompt]` | Toggles read-only vibe mode and optionally starts it with a prompt. It cannot start during plan or goal mode. See [Vibe mode](/docs/vibe). |
| `/goal [objective]` | Opens the goal editor when inactive or the management menu when active; an inline objective starts a goal directly. Requires `goal.enabled` and cannot start during plan or vibe mode. See the subcommands below and [Goal mode](/docs/goal). |
| `/guided-goal [rough objective]` | Starts an interview in chat, then configures goal mode from the result. It has the same `goal.enabled`, plan-mode, and vibe-mode constraints as `/goal`. |
| `/loop [count\|duration] [prompt]` | Toggles automatic resubmission after each yield. A positive integer limits iterations; durations accept compact or spaced forms such as `90s`, `10 min`, or `1h30m`. Plain prose is an unbounded inline prompt. Run `/loop` again to stop; <kbd>Escape</kbd> cancels the current iteration. |
| `/queue <message>` | Delivers a follow-up after the active turn yields; if idle, starts it immediately. `-> message` and `=> message` are equivalent editor shorthand. |
| `/model` Alias: `/models` | Opens the model hub for role and provider selection. In the TUI this command does not take a model ID argument. |
| `/switch` | Opens the compact session-only model picker, the same action as <kbd>Alt</kbd>+<kbd>P</kbd>; it does not persist a role setting. |
| `/fast [on\|off\|status]` | Bare form toggles priority service (`service_tier=priority` for OpenAI or fast speed for Anthropic). Enabling can be unavailable for the current model. `toggle` is also accepted. |
| `/extended-context [on\|off\|status]` | Bare form toggles the persisted premium long-context setting; `toggle` is also accepted. |
| `/computer [on\|off\|status]` | Bare form toggles the native computer-use tool for this session. `status` reports backend, permissions, exposure, and model; enabling can be unavailable in the session. `toggle` is also accepted. |
| `/vision <on\|off\|auto\|status>` | Sets a session override for the `inspect_image` delegation tool. `auto` follows the configured mode and hides delegation for models with native image input. |
| `/prewalk` | Arms the authenticated `@smol` role for the next todo-gated edit or write, even if omp was not launched with `--prewalk`. See [Prewalk](/docs/prewalk). |
| `/advisor [on\|off\|status\|dump [raw]\|configure]` | Bare form toggles the advisor; `/advisor toggle` is equivalent. Explicit forms are `/advisor on`, `/advisor off`, `/advisor status`, `/advisor dump [raw]`, and `/advisor configure`. `dump` copies a compact transcript unless `raw` is supplied; `configure` opens the TUI editor. A configured advisor still needs a model assigned to the `advisor` role. See [Advisor](/docs/advisor). |
| `/browser [headless\|visible]` | Bare form toggles the browser between headless and visible and restarts it. Requires `browser.enabled`. `hidden` means headless; `show` and `headful` mean visible. |
| `/force:<tool-name> [prompt]` Also `/force <tool-name> [prompt]` | Forces one tool choice for the next agent turn. An inline prompt starts that turn; without it, the next message uses the choice. The tool must be active. |
| `/live` | Starts Codex-backed realtime voice mode; run it again to stop. Interactive TUI only. |
| `/pause` | Freezes the main agent, subagents, and advisor at their next safe boundary. In-flight calls finish; <kbd>Escape</kbd>, <kbd>Enter</kbd>, or <kbd>Space</kbd> resumes them. |

#### `/goal` subcommands

| Form | Effect |
| --- | --- |
| `/goal set <objective>` | Sets or replaces the persistent objective. A bare objective after `/goal` is the short form. |
| `/goal show` | Shows the objective, status, and budget. |
| `/goal pause` | Pauses the current goal. |
| `/goal resume` | Resumes a paused goal. |
| `/goal drop` | Removes the goal from this session. |
| `/goal budget <N\|off>` | Changes or removes its token budget. |

### Security

`/security` requires `security.enabled`. A bare `/security` lists stored scans. The command starts local scan work as background operations, so use `status` rather than waiting on the prompt. Cloud forms also require a stored OpenAI Codex OAuth account. See [Security](/docs/security) for the scan model and artifacts.

| Form | Effect |
| --- | --- |
| `/security plan [options]` | Creates an immutable plan and prints its ID and fingerprint. Options: repeated `--path <path>`, `--exclude <path>`, and `--knowledge-base <path>`; `--working-tree`; `--diff <base> <head>`; `--output <dir>`; `--archive-existing`; `--credential <id>`. |
| `/security scan [<plan-id>\|options]` | Starts an existing `secplan_…`, or creates a plan from the same options and starts it. Prints scan and operation IDs. |
| `/security status [operation-id]` | Shows one operation or lists operations. |
| `/security cancel <operation-id>` | Requests cancellation of a running operation. |
| `/security scans` | Lists stored project scans. |
| `/security show <scan-id\|security://…>` | Renders a scan or another security resource. |
| `/security import <sarif-file\|bundle-directory>` | Imports SARIF or a Codex Security bundle into the project store. |
| `/security export <scan-id> --output <path> [--format bundle\|sarif\|report]` | Writes a canonical bundle, SARIF document, or report. |
| `/security validate <finding-uri>` or `/security validate <scan-id> <finding-id>` | Starts an agent turn that validates one finding with native security tools. |
| `/security compare <before-scan-id> <after-scan-id>` | Prints finding-lineage comparison data. |
| `/security disposition <scan-id> <finding-id> <open\|false_positive\|accepted_risk\|fixed\|wont_fix> [rationale]` | Updates a finding. Every state except `open` requires a rationale. |
| `/security cloud scans [--credential <id>]` | Lists Codex Security cloud configurations. This accepted subcommand is not currently offered by nested autocomplete. |
| `/security cloud start --repo-id <id> --repo-url <url> --environment <id> [--lookback <days\|all>] [--credential <id>]` | Starts a cloud scan and consumes cloud scan allowance. |
| `/security cloud status <configuration-id> [--credential <id>]` | Shows cloud scan statistics. |
| `/security cloud pull <configuration-id> [--credential <id>]` | Imports cloud findings into the local project store. |

### Sessions, history, and context maintenance

| Command | Visible effect and availability |
| --- | --- |
| `/session [info]` | Opens current-session information in the TUI. |
| `/session delete` | Deletes the current persisted session and returns to the selector. Unavailable while streaming or for an in-memory session. |
| `/session pin [account]` | Pins the current provider to a stored OAuth account; without an account, opens the account selector. This is different from top-level `/pin`. |
| `/new` | Starts a new session without deleting the current one. |
| `/fresh` | Closes provider-side stream state and starts fresh provider state without changing the local transcript. Unavailable while streaming. |
| `/clear` | Clears conversation context in place while keeping the session. Unavailable while streaming. |
| `/drop` | Deletes the current session and starts a new one. |
| `/resume [session-id\|@claude\|@codex]` | Opens the local session picker, opens a Claude/Codex import picker, or resumes the matching session ID. Interactive TUI only. |
| `/pin [session-id]` | Toggles the current or named session at the top of the resume list. |
| `/rename <title>` | Gives the current session a user-set title. |
| `/move <path>` | Moves the session to another existing directory, reloads directory-scoped settings and discovered capabilities, and makes that path the working directory. Unavailable while streaming. |
| `/add-dir <path>` | Adds an existing additional workspace root to this session. Unavailable while streaming. |
| `/remove-dir <path>` | Removes an additional workspace root. The working directory itself cannot be removed; use `/move`. |
| `/dirs` | Lists the working directory and every additional workspace root. |
| `/tree` | Opens the in-place session tree and switches to an existing branch. |
| `/branch` | Selects an earlier message and creates another branch in the same session file. |
| `/fork` | Selects an earlier message and creates a separate session file from it. |
| `/compact [focus]` | Manually compacts context using configured methods and optional focus instructions. See [Compaction](/docs/compaction). |
| `/compact soft [focus]` | Forces a local summary with the active model for this run. |
| `/compact remote [focus]` | Tries OpenAI-compatible server compaction, then a local summary. |
| `/compact snapcompact` | Archives history into dense bitmap images without an LLM summary; it rejects focus text. |
| `/shake [elide\|images\|thinking]` | Removes heavy context without summarizing. Bare form/`elide` strips tool results and large blocks; the other modes strip image or thinking blocks. |
| `/handoff [focus instructions]` | Generates a handoff document and commits it as a compaction entry in the same session. Requires an idle session with enough messages; it does not automatically end the turn or create a new session. See [Handoff](/docs/handoff). |
| `/btw <question>` | Asks an ephemeral side question with current context; the exchange is not added to the persisted conversation. |
| `/tan <work>` | Starts a full background agent for tangential work. Interactive TUI only. |
| `/retry` | Retries the last failed agent turn. It works only while idle and only when there is a failed turn to retry. |
| `/omfg <complaint>` | Converts a complaint about recurring behavior into a TTSR rule. Interactive TUI only. |
| `/cleanse [request] [--all]` | Detects and fixes project diagnostics with weighted parallel subagents. Interactive TUI only. |

#### `/todo` subcommands

A bare `/todo` displays the current phased task list.

| Form | Effect |
| --- | --- |
| `/todo edit` | Opens a Markdown round trip in `$EDITOR`. |
| `/todo copy` | Copies the list as Markdown. |
| `/todo export [path]` | Writes Markdown; default path is `TODO.md`. |
| `/todo import [path]` | Replaces the list from Markdown; default path is `TODO.md`. |
| `/todo append [phase] <task…>` | Appends a task; fuzzy-matches the phase or creates one. |
| `/todo start <task>` | Fuzzy-matches and marks a task in progress. |
| `/todo done [task\|phase]` | Marks the fuzzy match completed; no target applies to all. |
| `/todo drop [task\|phase]` | Marks the fuzzy match abandoned; no target applies to all. |
| `/todo rm [task\|phase]` | Removes the fuzzy match; no target applies to all. |
| `/todo help` Alias: `/todo ?` | Prints todo usage. |

### Status and inspection

| Command | Visible effect and availability |
| --- | --- |
| `/jobs` | Shows running and recently settled background jobs. Settled jobs remain for about five minutes. |
| `/usage [show]` | Shows provider usage, rate limits, resets, and account attribution. |
| `/usage reset [account\|active]` | Spends a saved Codex rate-limit reset. With no argument, the TUI opens an account selector. |
| `/stats [--port <port>] [--host <host>]` | Syncs session files and launches the local statistics dashboard. |
| `/context` | Shows the estimated token budget by source for the current turn. |
| `/tools` | Shows tools currently visible to the agent and distinguishes active from available tools. |
| `/changelog [full]` | Shows recent entries; `full` shows the complete changelog. |
| `/hotkeys` | Shows the live shortcut list. See [Keybindings](/docs/keybindings) for the complete remapping reference. |
| `/extensions` Alias: `/status` | Opens Extension Control Center to inspect and enable or disable discovered capabilities. Interactive TUI only. |
| `/agents` | Opens Agent Control Center for task agents, models, prewalk, and advisor configuration. Interactive TUI only. |
| `/debug` | Opens the configured debugger selector. Interactive TUI only. |

### Memory

A bare `/memory` is `/memory view`. The `mm` family is interactive-TUI-only and requires an active Hindsight backend with mental models enabled.

| Form | Effect |
| --- | --- |
| `/memory view` | Shows the memory payload currently injected into the session. |
| `/memory stats` | Shows backend statistics when the backend provides them. |
| `/memory diagnose` | Runs backend diagnostics when supported. |
| `/memory clear` Alias: `/memory reset` | Clears persisted memory data and artifacts, then refreshes the system prompt. |
| `/memory enqueue` Alias: `/memory rebuild` | Enqueues consolidation maintenance. |
| `/memory mm [list]` | Lists mental models on the active bank. |
| `/memory mm show <id>` | Shows one mental model. |
| `/memory mm refresh [id]` | Refreshes auto-refresh models bank-wide or refreshes one ID. |
| `/memory mm history <id>` | Shows the model's change history. |
| `/memory mm seed` | Creates missing built-in mental models. |
| `/memory mm delete <id>` Alias: `/memory mm remove <id>` | Deletes one mental model. |
| `/memory mm reload` | Re-pulls the cached mental-model injection block. |

### Export, sharing, and live collaboration

| Command | Visible effect and availability |
| --- | --- |
| `/export [--themes] [path]` | Writes the session as HTML. `--themes` bundles the active TUI light/dark themes; a path cannot contain spaces. |
| `/dump` | Copies the plain-text transcript and writes the current LLM request JSON to a temporary file when possible. The JSON can contain raw context or secrets. |
| `/share` | Uploads an encrypted session and prints a share URL, using the configured share server/store or secret-gist path. Large sessions can be trimmed. |
| `/copy` | Opens a conversation-copy picker. |
| `/copy code` | Copies the last code block. |
| `/copy cmd` Alias: `/copy command` | Copies the last shell command or Python evaluation. |
| `/collab [start] [relay-url]` | Starts live hosting, or shows the existing writable link. Uses `collab.relayUrl` when no URL is supplied; a scheme-less relay defaults to `wss://`. Interactive TUI only. |
| `/collab view [relay-url]` | Starts hosting if needed and shows a read-only watcher link. |
| `/collab status` | Shows the active link and participants, or guest status. |
| `/collab stop` | Stops hosting. |
| `/join <link>` | Joins a writable or read-only collaboration link. You must stop hosting or leave another room first. Interactive TUI only. |
| `/leave` | Leaves as a guest or stops the room as its host. |

### Providers, MCP, SSH, and plugins

| Command | Visible effect and availability |
| --- | --- |
| `/login [provider]` | Opens OAuth provider selection or starts the named provider. During a manual callback flow, `/login <redirect-url>` submits the callback. Interactive TUI only. |
| `/logout [provider]` | Opens logout selection or revokes the named OAuth provider. Interactive TUI only. |

#### `/mcp` subcommands

A bare `/mcp` shows its help. The no-argument `/mcp add` wizard is interactive-TUI-only.

| Form | Effect |
| --- | --- |
| `/mcp add` | Opens the server setup wizard. |
| `/mcp add <name> [--scope project\|user] [--url <url> --transport http\|sse] [--token <token>] [-- <command…>]` | With only a name, opens the wizard prefilled. Supplying `--url` or `-- <command…>` quickly adds a remote HTTP/SSE or local stdio server. |
| `/mcp list` | Lists configured and discovered servers. |
| `/mcp remove <name> [--scope project\|user]` Alias: `/mcp rm <name> [--scope project\|user]` | Removes the project entry by default. |
| `/mcp test <name>` | Tests a connection. |
| `/mcp reauth <name>` | Runs OAuth authorization again. |
| `/mcp unauth <name>` | Removes stored OAuth state. |
| `/mcp enable <name>` | Enables a server. |
| `/mcp disable <name>` | Disables a server. |
| `/mcp smithery-search <keyword> [--scope project\|user] [--limit <1-100>] [--semantic]` | Searches Smithery and opens deployment selection. |
| `/mcp smithery-login` | Logs in and caches the Smithery API key. |
| `/mcp smithery-logout` | Removes the cached Smithery key. |
| `/mcp reconnect <name>` | Reconnects one server. |
| `/mcp reload` | Reloads server configuration and rebinds runtime tools. |
| `/mcp resources` | Lists resources from connected servers. |
| `/mcp prompts` | Lists prompts from connected servers. A prompt is invoked as `/<server>:<prompt> [name=value…]`. |
| `/mcp notifications` | Shows notification capabilities and subscription state. |
| `/mcp help` | Prints MCP usage. |

#### `/ssh` subcommands

A bare `/ssh` shows its help.

| Form | Effect |
| --- | --- |
| `/ssh add <name> --host <host> [--user <user>] [--port <port>] [--key <key-path>] [--desc <description>] [--compat] [--scope project\|user]` | Adds an SSH host. `--compat` selects compatibility mode. |
| `/ssh list` | Lists configured hosts. |
| `/ssh remove <name> [--scope project\|user]` Alias: `/ssh rm <name> [--scope project\|user]` | Removes the project entry by default. |
| `/ssh help` | Prints SSH usage. |

#### `/marketplace` and `/plugins`

| Form | Effect |
| --- | --- |
| `/marketplace` or `/marketplace install` | Opens the interactive install browser. Outside the TUI, an explicit `name@marketplace` is required. |
| `/marketplace add <source>` | Adds a source such as `owner/repo`. |
| `/marketplace remove <name>` Alias: `/marketplace rm <name>` | Removes a source. |
| `/marketplace update [name]` | Refreshes one catalog or all catalogs. |
| `/marketplace list` | Lists configured sources. |
| `/marketplace discover [marketplace]` | Lists available plugins, optionally from one source. |
| `/marketplace install [--force] [--scope user\|project] <name@marketplace>` | Installs and reloads the selected plugin. |
| `/marketplace uninstall` | Opens the TUI uninstall selector. |
| `/marketplace uninstall [--scope user\|project] <name@marketplace>` | Uninstalls one plugin. |
| `/marketplace installed` | Lists installed plugins, scope, and shadowing state. |
| `/marketplace upgrade` | Upgrades every outdated plugin. |
| `/marketplace upgrade [--scope user\|project] <name@marketplace>` | Upgrades one plugin. |
| `/marketplace help` | Prints marketplace usage. |
| `/plugins [list]` | Lists npm and marketplace plugins and their enabled state. |
| `/plugins enable [--scope user\|project] <name@marketplace>` | Enables an installed marketplace plugin. |
| `/plugins disable [--scope user\|project] <name@marketplace>` | Disables an installed marketplace plugin. |
| `/reload-plugins` | Refreshes discovery caches, skills, file slash commands, task agents, capability state, and MCP servers in the active session. See reload limits below. |

### Exit

| Command | Effect |
| --- | --- |
| `/exit` | Exits the interactive application. |
| `/quit` Alias: `/q` | Exits the interactive application. |

## Commands that are not core built-ins

Autocomplete combines several command systems. Their icons and source labels identify where they came from.

### Bundled workflow commands

Three useful commands ship outside the core registry, so they can be overridden:

| Command | Source and effect |
| --- | --- |
| `/review [GitHub PR URL\|pr://owner/repo/number] [instructions]` | Bundled TypeScript command. A PR reference starts that review directly; otherwise the TUI offers base-branch, uncommitted, commit, or custom review. See [Review](/docs/review). |
| `/green` | Bundled TypeScript command that expands to a workflow for watching and repairing CI until the current branch is green. |
| `/init [request]` | Bundled Markdown file command that expands to the repository-initialization workflow. A discovered file command named `init` replaces it. |

### Skills

When `skills.enabled` and `skills.enableSkillCommands` are on, every discovered skill appears as:

```text
/skill:<name> [arguments]
```

The command loads that skill's instructions for the turn. Skill commands are user-attributed prompts, not core built-ins. Use `/extensions` to see their source and state. See [Skills](/docs/skills).

### Extension and executable commands

Extensions may register in-session commands with their own UI or program logic. User/project TypeScript command modules are discovered from `commands/<name>/index.{ts,js,mjs,cjs}` under the active agent/config directories, and MCP prompt commands are added by connected servers as `/<server>:<prompt>`. Built-in names are reserved. omp's bundled `/review` and `/green` are the lowest-priority executable commands; a user or project command module with the same name replaces the bundled one. See [Authoring extensions](/docs/extension-authoring).

### File slash commands

Markdown under a discovered `commands/` capability directory becomes `/<filename>` and expands to a prompt. Native locations are the current project's `.omp/commands/*.md` and the active profile's agent `commands/*.md`; compatible Claude Code, agent-dir, Codex, OpenCode, and installed-plugin providers are also discovered.

For duplicate file-command names, the capability provider with the higher priority wins. Native `.omp` commands have the highest provider priority, and project `.omp/commands` wins over the active-profile user directory. Plugin and compatibility providers follow. The bundled `/init` is used only when discovery did not already claim `init`.

### Prompt templates

Markdown prompt templates also appear as `/<filename>`, but they are a separate, last-resort expansion system. Project templates live under `.omp/prompts/**/*.md`; user templates live in the active agent profile's `prompts/**/*.md`. User templates load before project templates, so a user template wins a same-name project template. See [Prompt templates](/docs/prompt-templates) for arguments and interpolation.

### Resolution order

When the same token exists in more than one system, omp resolves it in this order:

1. core built-in name or alias;
2. `/skill:<name>`;
3. extension-registered command;
4. TypeScript custom command, then an MCP prompt command;
5. discovered Markdown file slash command;
6. prompt template.

Autocomplete omits lower-priority prompt templates that are already claimed. Use distinctive names instead of relying on shadowing.

### Reload after changing commands

`/reload-plugins` refreshes skills, Markdown file slash commands, task-agent definitions, capability caches, and MCP connections in the active TUI. Restart omp after adding or changing prompt templates, executable command modules, extension modules, hooks, or custom tools; those initialized surfaces are not fully rebuilt in place. Moving the session with `/move` refreshes directory-scoped capabilities, but a new session is still the reliable way to load changed prompt templates or executable code.

## Slash commands versus magic keywords

[Magic keywords](/docs/magic-keywords) are ordinary words in a prompt that add hidden steering for that turn; they are not `/` commands and do not appear in command autocomplete. Likewise, `/review` is a bundled workflow command rather than a core built-in. Use [Review](/docs/review), [Advisor](/docs/advisor), [Vibe](/docs/vibe), [Security](/docs/security), and [Prewalk](/docs/prewalk) for their focused workflows; this page is the inventory and syntax reference.
