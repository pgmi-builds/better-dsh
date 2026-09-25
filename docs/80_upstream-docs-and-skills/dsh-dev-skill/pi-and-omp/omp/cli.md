<!--
source: https://omp.sh/docs/cli
fetched: 2026-09-06
-->

# CLI reference

> The complete shell interface for launching omp, scripting it, and running its maintenance commands.

## Choose a command

Use `omp` by itself for an interactive coding session. Add a prompt, pipe text, or choose one of the dedicated commands when you need a non-interactive result or administrative task.

| Goal | Smallest command |
| --- | --- |
| Open the interactive TUI in the current directory | `omp` |
| Start with a request | `omp "Fix the failing tests"` |
| Attach context to the first request | `omp @plan.md @screenshot.png "Implement this"` |
| Print one answer and exit | `omp -p "Summarize this project"` |
| Pipe input into a one-shot run | `git diff \| omp -p "Review this diff"` |
| Continue the latest session for this directory | `omp -c` |
| Choose or name a saved session | `omp -r` or `omp -r <id>` |
| Emit machine-readable events | `omp -p --mode json "Find every TODO"` |
| Start a protocol server | `omp --mode rpc` or `omp acp` |
| Discover a command or its flags | `omp --help` or `omp <command> --help` |

## Command-line shape

```sh
omp [launch flags] [@files...] [messages...]
omp launch [launch flags] [@files...] [messages...]
omp <command> [arguments] [command flags]
```

`launch` is the default command. If the first non-flag word is not a registered command, omp treats the remaining words as the initial request. For example, `omp "fix the build"` launches a session, while `omp models` lists models. Use an explicit `omp launch …` when a request begins with a command name.

All long options that take a value accept either `--flag value` or `--flag=value`. Use `--` to stop parsing flags:

```sh
omp -- "Explain why --force is dangerous here"
```

A loaded extension can add launch flags. `omp --help` shows those in addition to the built-in surface below.

## Launch input and entry modes

### Prompts, files, images, and stdin

- Plain positional arguments are joined into the initial request.
- Prefix a path with `@` to attach it. Text is included as context; supported images are sent as image input. See [Files](/docs/files) for size limits and supported sources.
- When stdin is not a TTY, omp reads it automatically. No `-` marker is required.
- A missing or unreadable `@file` makes the command fail instead of silently omitting it.
- `@file` arguments are not expanded in `rpc` or `rpc-ui` mode; send input through that protocol instead.

```sh
omp @requirements.md "Implement the first unchecked item"
omp @before.png @after.png "Match the second design"
printf '%s\n' 'Explain packages/core' | omp -p
```

### Output and protocol modes

| Entry | What happens |
| --- | --- |
| `omp` | Interactive text mode: opens the TUI and keeps the session running. |
| `omp -p`, `omp --print` | Headless text mode: processes the request, writes the answer, and exits. |
| `omp -p --mode json` | Writes a newline-delimited structured event stream for automation. |
| `omp --mode rpc` | Runs the JSON-RPC server over stdio. See [RPC](/docs/rpc). |
| `omp --mode rpc-ui` | Runs RPC with UI extension events enabled. |
| `omp --mode acp`, `omp acp` | Runs an Agent Client Protocol server over stdio. See [ACP](/docs/acp). |

`--mode text` is the default. `--print` controls whether text/JSON runs exit after the request; protocol modes remain servers.

## Launch flags

The flags in this section apply to `omp` and `omp launch`. `omp acp` also accepts the relevant launch flags even though it forces ACP transport.

### Workspace and configuration

| Flag | Effect |
| --- | --- |
| `--cwd <dir>` | Start in this directory instead of the shell's current directory. |
| `--add-dir <dir>` | Add another workspace directory. Repeat to add more than one. |
| `--allow-home` | Allow a session to start in `~`; otherwise omp protects against accidentally treating the whole home directory as a project. |
| `--profile <name>` | Use isolated auth, sessions, settings, and caches for a named profile. |
| `--alias <command>` | Create a shell shortcut for the selected `--profile`, then exit. |
| `--config <file>` | Add a YAML settings overlay for this process. Repeatable; later files win. |

Configuration merges in this order: built-in defaults, global configuration, project configuration, files from `PI_CONFIG_FILES`, repeated `--config` files, then runtime overrides such as launch flags. The first global file present is `~/.omp/agent/config.yml` or `~/.omp/agent/config.yaml`; native project settings live at `.omp/config.yml`. Environment-variable precedence is resolver-specific rather than one universal rule. See [Settings](/docs/settings) and [Environment variables](/docs/env).

### Saved sessions

| Flag | Effect |
| --- | --- |
| `-c`, `--continue` | Continue the latest session associated with the current project. |
| `-r [id\|path]`, `--resume [id\|path]`, `--session [id\|path]` | Resume by ID prefix or JSONL path. With no value, open the session picker. |
| `--fork <id\|path>` | Fork a saved session into a new session. |
| `--from-claude` | Import a Claude Code session. |
| `--from-codex` | Import a Codex session. |
| `--session-dir <dir>` | Override the directory used for session storage and lookup. |
| `--no-session` | Keep this run ephemeral instead of saving it. |
| `--provider-session-id <id>` | Reuse an externally issued provider session ID for continuity and cache scoping. |
| `--no-title` | Skip automatic session-title generation. |
| `--export <session> [output.html]` | Render a saved JSONL session as HTML and exit. If omitted, the output name is derived from the session file. |

### Models and reasoning

| Flag | Effect |
| --- | --- |
| `--model <id-or-role>` | Select a model by fuzzy ID, `provider/model`, or configured role such as `slow` or `@slow`. |
| `--provider <name>` | Legacy provider hint. Prefer `--model`. |
| `--api-key <key>` | Supply the selected provider's credential for this run; it is not persisted. |
| `--smol <id>` | Override the fast/lightweight model role. |
| `--slow <id>` | Override the thorough reasoning model role. |
| `--plan <id>` | Override the planning model role. |
| `--models <a,b,…>` | Restrict the models available to `Ctrl+P` cycling. Patterns may include effort, for example `sonnet:high`. |
| `--thinking <level>` | Set `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `auto`. |
| `--service-tier <tier>` | Override the OpenAI-family tier: `none`, `auto`, `default`, `flex`, `scale`, or `priority`. `none` omits the request field. |
| `--provider-session-id <id>` | Reuse a provider-side session ID. |
| `--prompt-cache-key <key>` | Override the provider prompt-cache key for this session. |
| `--hide-thinking` | Hide thinking blocks in the TUI without changing model reasoning. |
| `--print-thoughts` | Include thinking blocks in print-mode text output. |
| `--external-thinking` | Use a private scratchpad while disabling supported provider reasoning. This request shape can trigger provider abuse controls; use at your own risk. |

See [Providers](/docs/providers) for model and credential resolution and [Roles](/docs/roles) for role selection.

### Prewalk and plan execution

| Flag | Effect |
| --- | --- |
| `--prewalk` | After a plan todo list exists, switch to a fast model at the first edit or write. Off by default. |
| `--no-prewalk` | Disable prewalk even when configuration enables it. |
| `--prewalk-into <id>` | Choose the prewalk target; the default is the `smol` role. |
| `--plan-yolo` | Start in read-only plan mode, auto-approve the first resolved plan, then execute it. |
| `--plan-yolo-into <id>` | Choose the model that executes a plan-yolo plan; the default is `smol`. |

See [Prewalk](/docs/prewalk) and [Plan mode](/docs/plan).

### Capabilities, approvals, and runtime

| Flag | Effect |
| --- | --- |
| `--tools <a,b,…>` | Make only the named built-in capabilities available for this run. |
| `--no-tools` | Disable all built-in capabilities. Plugin-provided capabilities can still load. |
| `--no-lsp` | Disable language-server features, formatting, and diagnostics. |
| `--no-pty` | Disable PTY-backed interactive shell execution. |
| `--approval-mode <mode>` | Use `always-ask`, `write`, or `yolo` for this session. |
| `--auto-approve`, `--yolo` | Skip approval prompts for all operations. |
| `--advisor` | Enable passive per-turn review and injected advice. See [Advisor](/docs/advisor). |
| `--max-time <duration>` | Stop after positive seconds or a duration such as `5s`, `10m`, or `1h`. |

Approval shortcuts weaken the interactive safety boundary. See [Approvals](/docs/approvals) and [Security](/docs/security).

### Extensions, hooks, skills, and rules

| Flag | Effect |
| --- | --- |
| `-e <path>`, `--extension <path>` | Load an extension file. Repeatable. |
| `--hook <path>` | Load a hook/extension file through the same loader. Repeatable. |
| `--trusted-extension <absolute-path>` | Load a trusted extension from an absolute path. Repeatable; cannot be combined with `-e`, `--extension`, or `--hook`. |
| `--plugin-dir <dir>` | Add a local plugin directory to discovery. Repeatable. |
| `--no-extensions` | Disable extension discovery. Explicit `-e` and `--hook` paths still load. |
| `--skills <glob,…>` | Keep only skills matching the comma-separated glob patterns. |
| `--no-skills` | Disable skill discovery and loading. |
| `--no-rules` | Disable rules discovery and loading. |

### Prompt and output

| Flag | Effect |
| --- | --- |
| `--system-prompt <text-or-file>` | Replace the default system prompt. If the value names a readable file, omp reads it; otherwise the value is literal text. |
| `--append-system-prompt <text-or-file>` | Append readable file contents or literal text to the default prompt. |
| `-p`, `--print` | Process the request without the TUI, then exit. |
| `--mode <mode>` | Select `text`, `json`, `rpc`, `rpc-ui`, or `acp`. |
| `--print-thoughts` | Include reasoning blocks in print-mode text. |
| `--no-title` | Skip the background title-generation request. |
| `-h`, `--help` | Print help and exit. |
| `-v`, `--version` | Print the installed version and exit. |

## Shell completions

Completion scripts are generated from the live command registry, including nested actions and extension-provided launch flags.

```sh
# zsh: add to ~/.zshrc
eval "$(omp completions zsh)"

# bash: add to ~/.bashrc
eval "$(omp completions bash)"

# fish: install once
omp completions fish > ~/.config/fish/completions/omp.fish
```

Run `omp completions bash`, `omp completions zsh`, or `omp completions fish` to print a script. Restart the shell or source its startup file, then type `omp ` and press Tab to verify it.

## Subcommand index

Every public subcommand accepts `--help`. Aliases are shown beside their canonical command. Put command-specific flags after the command.

| Command | Purpose and nested actions |
| --- | --- |
| `launch` | Start a coding session; this is the default command. |
| `acp` | Run the ACP server over stdio. |
| `agents` | `unpack` bundled task-agent definitions. |
| `auth-broker` | `serve`, `token`, `login`, `logout`, `import`, `migrate`, `status`, `list`. |
| `auth-gateway` | `serve`, `token`, `status`, `check`. |
| `bench` | Benchmark one or more models. |
| `browser-relay` | `serve` the Chrome relay or `install` its extension. |
| `cleanse` | Discover project diagnostics and fix them with file-disjoint workers. |
| `commit` | Generate a commit message, update changelogs, and commit. See [Commit](/docs/commit). |
| `completions` | Generate a completion script for `bash`, `zsh`, or `fish`. |
| `compress` | Densify one or more text files. |
| `config` | `list`, `get`, `set`, `reset`, `path`, `init-xdg`. |
| `dry-balance` | Simulate OAuth-account selection across session IDs. |
| `gallery` | Preview terminal renderers and lifecycle states. |
| `gc` | Inspect or apply storage garbage collection. |
| `grep` | Run omp's standalone regex search from the shell. |
| `grievances` | `list`, `clean`, or `push` auto-QA reports. |
| `images`, `img` | `status`, `doctor`, `probe`, or `purge` image-publication state. |
| `install` | Install or link extensions; shorthand for `plugin install`/`plugin link`. |
| `join` | Join a collaboration link. See [Collaboration](/docs/collab). |
| `models` | `ls`, `find`, `refresh`, or list a named provider. |
| `plugin` | Install, configure, enable, disable, discover, and upgrade plugins and marketplaces. |
| `ps` | `list`, `info`, `logs`, `stop`, `kill`, or `restart` supervised processes. |
| `read` | Print a local path, URL, archive member, database row, or internal URI. |
| `render` | Render a complete saved transcript through the production terminal renderer. |
| `say` | Speak text locally or write it to a WAV file. |
| `search`, `q` | Search the web with the configured search providers. |
| `setup` | Run onboarding, or set up `python` or `speech`. |
| `share` | Share a saved session through the share service or a secret gist. |
| `shell` | Open the interactive shell console. |
| `ssh` | `add`, `remove`, or `list` saved SSH hosts. |
| `stats` | Open the statistics dashboard or print statistics. |
| `tiny-models` | `download` or `list` local tiny models. |
| `token` | Print or inspect the stored credential for a provider. |
| `ttsr` | `test`, `list`, or `scan` Time-Traveling Stream Rules. |
| `update` | Check for or install omp and plugin updates. |
| `usage` | Show provider limits or `invalidate` cached usage reports. |
| `worktree`, `wt` | `list` or `clear` agent-managed worktrees. |

## Subcommand reference

### Sessions, collaboration, and local services

| Command | Syntax, actions, and flags |
| --- | --- |
| `omp acp [launch flags]` | Starts ACP over stdio. There are no ACP-only public flags; use the applicable [launch flags](#launch-flags). |
| `omp agents unpack [flags]` | Writes bundled agent definitions. `--user` targets `~/.omp/agent/agents` (default); `--project` targets `./.omp/agents`; `--dir <path>` overrides both; `-f`, `--force` overwrites; `--json` emits JSON. |
| `omp browser-relay [serve\|install] [flags]` | Defaults to `serve`. `-p`, `--port <n>` chooses the port; `--token <value>` requires an extension token; `--dir <path>` selects the install directory; `--no-group` leaves Chrome tabs ungrouped; `-v`, `--verbose` logs traffic summaries. See [Computer use](/docs/computer). |
| `omp join <link>` | Joins the encrypted collaboration link supplied by a host. No command-specific flags. |
| `omp ps [action] [name] [flags]` | `list` (default) shows processes; `info` shows one; `logs` reads output; `stop` requests graceful shutdown; `kill` terminates immediately; `restart` restarts it. `-a`, `--all`; `-j`, `--json`; `--plain`; `--dir <path>`; `--global <scope>`; `-f`, `--follow`; `--head`; `-n`, `--lines <n>` (max 1000); `--grep <regex>`; `--timeout <seconds>` for `stop`. |
| `omp share <session> [--gist]` | Shares a session ID prefix or JSONL path. `--gist` uses a secret GitHub gist instead of the share server. |
| `omp shell [flags]` | Opens the interactive console. `-C`, `--cwd <dir>` chooses its directory; `-t`, `--timeout <ms>` sets each command timeout; `--no-snapshot` skips the user's shell snapshot. |
| `omp stats [flags]` | Opens the usage dashboard. `-p`, `--port <n>` and `--host <host>` bind the server; `-j`, `--json` prints JSON; `-s`, `--summary` prints a console summary. |
| `omp worktree [list\|clear] [flags]` | `list` is the default. `clear` removes managed entries; `-n`, `--dry-run` previews; `--all` includes live PR-checkout worktrees; `-j`, `--json` emits JSON. `wt` is an alias. |

### Authentication and provider inspection

| Command | Syntax, actions, and flags |
| --- | --- |
| `omp auth-broker [action] [source] [flags]` | `serve` starts the credential vault; `token` prints or rotates its bearer; `login [provider]`; `logout [provider]`; `list` lists OAuth providers; `import <path>` imports credentials; `migrate` uploads local credentials; `status` checks the configured broker. Flags: `--json`; `-b`, `--bind <host:port>`; `--regenerate`; `--via <user@host>`; `--provider <id>` for import; `--include-disabled`; `--from-local`; `--include-env`; `--include-oauth`; `--dry-run`. |
| `omp auth-gateway [serve\|token\|status\|check] [flags]` | `serve` starts the forward proxy; `token` prints or rotates its bearer; `status` shows gateway/broker configuration; `check` probes credentials. Flags: `--json`; `-b`, `--bind <host:port>`; `--regenerate`; `--no-auth` allows any local caller; `--strict` performs live provider checks and uses a small amount of quota. |
| `omp dry-balance [model] [flags]` | Tests account selection without running sessions. `--model <selector>`; `--count <n>`; `--concurrency <n>`; `--json`; `--bench` sends one live benchmark request per OAuth account. |
| `omp models [action] [pattern] [flags]` | Bare or `ls` lists models; a provider name lists that provider; `find <text>` searches; `refresh` refreshes the catalog. Flags: `--json`; `-e`, `--extension <path>` repeatable; `--no-extensions`; `--config <file>` repeatable. |
| `omp token <provider> [flags]` | Prints the selected API key or OAuth access token. `--raw` avoids unpacking nested credential JSON; `--force-refresh` refreshes OAuth; `-l`, `--list` lists accounts; `-a`, `--account <n>` selects a 1-based account. Treat output as a secret. |
| `omp usage [invalidate] [flags]` | Bare command shows live provider limits; `invalidate` clears cached reports. `-j`, `--json`; `-p`, `--provider <id>`; `-r`, `--redact`; `--history`; `-d`, `--days <n>`. |

### Plugins, marketplaces, and configuration

| Command | Syntax, actions, and flags |
| --- | --- |
| `omp config list [--json]` | Lists every setting and current value. Credential fields are redacted in the list. |
| `omp config get <key> [--json]` | Prints one setting. An explicit credential `get` returns the value, so protect its output. |
| `omp config set <key> <value> [--json]` | Sets a global value. Booleans accept `true/false`, `yes/no`, `on/off`, or `1/0`; arrays and records use JSON. |
| `omp config reset <key> [--json]` | Restores the schema default. |
| `omp config path` | Prints the active agent/config directory. |
| `omp config init-xdg` | Initializes the XDG Base Directory layout. |
| `omp install <target…> [flags]` | Installs npm/git/marketplace targets, or links local directories. `--json`; `--force`; `--dry-run`; `--scope user\|project` for marketplace installs. |
| `omp update [flags]` | Installs the current channel's update. `-f`, `--force`; `-c`, `--check`; `-l`, `--plugins`; `--canary`; `--stable`. |

`omp plugin` has its own nested surface:

The shared flags are `--json`, `--force`, `--dry-run`, `--scope user\|project`, and `-l`, `--local` (operate on the project-local plugin directory); action-specific use is listed below.

| Command | Effect and relevant flags |
| --- | --- |
| `omp plugin list [--json]` | Lists npm/link and marketplace plugins. Bare `omp plugin` also lists. |
| `omp plugin install <target…> [flags]` | Installs npm specs, git URLs, `name@marketplace`, or links local paths. Feature syntax is `pkg[one,two]`, `pkg[*]`, or `pkg[]`. Flags: `--json`, `--force`, `--dry-run`, `--scope user\|project`. |
| `omp plugin uninstall <name…> [flags]` | Removes plugins. Flags: `--json`, `--dry-run`, `--scope user\|project`. |
| `omp plugin link <path> [--json]` | Symlinks a local plugin for development. |
| `omp plugin doctor [--fix] [--json]` | Checks plugin health; `--fix` attempts repair. |
| `omp plugin features <plugin> [flags]` | Shows optional features. `--enable <a,b>`, `--disable <a,b>`, or `--set <a,b>` changes them; `--json` emits JSON. |
| `omp plugin config list <plugin> [--json]` | Lists plugin settings. |
| `omp plugin config get <plugin> <key> [--json]` | Reads one plugin setting. Secret fields are masked in display output. |
| `omp plugin config set <plugin> <key> <value>` | Parses, validates, and writes a plugin setting. |
| `omp plugin config delete <plugin> <key>` | Deletes a plugin setting. |
| `omp plugin config validate [--json]` | Validates settings for all installed plugins. |
| `omp plugin enable <name…> [--scope user\|project] [--json]` | Enables an installed plugin. Scope applies to marketplace installations. |
| `omp plugin disable <name…> [--scope user\|project] [--json]` | Disables without uninstalling. |
| `omp plugin marketplace list` | Lists configured marketplace sources; this is the default marketplace action. |
| `omp plugin marketplace add <source>` | Adds a marketplace source. |
| `omp plugin marketplace remove <name>` | Removes a source. `rm` is also accepted. |
| `omp plugin marketplace update [name]` | Updates one marketplace, or all when no name is supplied. |
| `omp plugin discover [marketplace]` | Lists available marketplace plugins, optionally from one source. |
| `omp plugin upgrade [name@marketplace] [--scope user\|project]` | Upgrades one marketplace plugin across scopes (or one selected scope), or all plugins when omitted. |

There is no top-level `omp marketplace`, `omp discover`, `omp enable`, `omp disable`, or `omp upgrade` management command; use the `omp plugin …` forms above.

### Project maintenance and diagnostics

| Command | Syntax and flags |
| --- | --- |
| `omp bench <model…> [flags]` | Benchmarks TTFT/prefill and generation throughput. `--runs <n>`; `--max-tokens <n>`; `--prompt <text>`; `--profile mix\|chat\|prefill\|generation`; `--prefill-bytes <n>`; `--service-tier <tier>`; `--json`; `--par <n>`; `--cache`; `--cache-prefix-file <path>`; `--cache-prefix-bytes <n>`; `--cache-pairs <n>`; `--cache-concurrency <n>`. |
| `omp cleanse [request] [flags]` | Discovers the checker implied by a request such as `"ts errors"`. `-n`, `--agents <n>`; `-m`, `--model <selector>`; `-t`, `--tests`; `-a`, `--all`. |
| `omp commit [flags]` | Generates a message, updates changelogs, and commits the staged diff. `--push`; `--dry-run`; `--no-changelog`; `--legacy`; `-c`, `--context <text>`; `-m`, `--model <selector>`. |
| `omp compress <file-or-glob…> [flags]` | Rewrites text into a dense prompt register. `-o`, `--out <path>` for one file; `-i`, `--inPlace`; `-r`, `--rounds <n>`; `-n`, `--agents <n>`; `-m`, `--model <selector>`. |
| `omp gc [flags]` | Dry-runs storage maintenance unless `--apply` is present. Flags: `--apply`; `--json`; `--agent-dir <path>`; `--blobs`; `--archive`; `--wal`; `--cold-archive-after-days <n>`; `--retain-newest-global <n>`; `--retain-newest-per-cwd <n>`. |
| `omp grievances [list\|clean\|push] [flags]` | `list` is default; `clean` deletes selected reports; `push` submits queued reports. `-n`, `--limit <n>`; `-t`, `--tool <name>`; `-j`, `--json`; `--id <n>`; `--all`. |
| `omp images [status\|doctor\|probe\|purge] [flags]` | `status` is default; `doctor` diagnoses; `probe` checks external health; `purge` defaults to a dry-run. `--json`; `--apply`; `--all`; `--dir <project>`; `--timeout <seconds>`. Alias: `img`. |
| `omp ttsr [test\|list\|scan] [input] [flags]` | `list` shows rules; `test` checks an inline snippet, path, or `--file`; `scan [dir]` checks files. `--file <path\|->`; `-r`, `--rule <file>`; `--source text\|thinking\|tool`; `--tool <name>`; `-p`, `--path <path>`; `-v`, `--verbose`; `--json`; `--no-gitignore`; `--max-bytes <n>` (`0` disables the limit). |

### Standalone inspection and media commands

These are shell commands. Their arguments are ordinary CLI syntax; they are not model function-call recipes.

| Command | Syntax and flags |
| --- | --- |
| `omp gallery [flags]` | Previews renderers. `-t`, `--tool <name>`; `-s`, `--state <state>` repeatable (`streaming`, `progress`, `success`, or `error`; displayed-label aliases also work); `-w`, `--width <columns>`; `-e`, `--expanded`; `--plain`; `--screenshot`; `-o`, `--out <path>`; `--font <family>`; `--font-size <points>`. Screenshot mode requires `vhs`. |
| `omp grep [pattern] [path] [flags]` | Searches with a regex. `-g`, `--glob <pattern>`; `-l`, `--limit <n>`; `-C`, `--context <n>`; `-f`, `--files`; `-c`, `--count`; `--no-gitignore`. |
| `omp read <path-or-uri>` | Prints a file, URL, internal URI, archive member, or SQLite selection. Selectors such as `src/a.ts:50-100` and `src/a.ts:raw` are accepted. |
| `omp render [session] [flags]` | Renders the latest current-directory session by default. `-w`, `--width <columns>`; `--height <rows>`; `-t`, `--timing`; `--repaint <n>`; `--plain`; `-q`, `--quiet`. |
| `omp say [text] [flags]` | Speaks text locally. `--voice <id>`; `--model <key>`; `-f`, `--file <path>`; `-o`, `--out <wav>` writes instead of playing. |
| `omp search [query…] [flags]` | Searches the web. `--provider <name>` accepts `auto`, `perplexity`, `gemini`, `anthropic`, `codex`, `xai`, `zai`, `exa`, `tinyfish`, `jina`, `kagi`, `tavily`, `firecrawl`, `brave`, `kimi`, `parallel`, `synthetic`, `searxng`, `startpage`, `duckduckgo`, `ecosia`, `google`, `mojeek`, or `public`; `--recency day\|week\|month\|year`; `-l`, `--limit <n>`; `--compact`. Alias: `q`. |

### Setup, SSH, and local model assets

| Command | Syntax, actions, and flags |
| --- | --- |
| `omp setup` | Runs the interactive onboarding wizard and requires a TTY. |
| `omp setup python [--check] [--json]` | Installs or probes Python-kernel dependencies. |
| `omp setup speech [--check] [--json]` | Installs or probes speech dependencies. |
| `omp ssh add <name> [flags]` | Adds a host. Options: `--host <address>`, `--user <name>`, `--port <n>`, `--key <path>`, `--desc <text>`, `--compat`, `--scope project\|user`, `--json`. |
| `omp ssh remove <name> [--scope project\|user] [--json]` | Removes a saved host. |
| `omp ssh list [--json]` | Lists saved hosts. |
| `omp tiny-models list [--json]` | Lists tiny local models used for session titles and memory. |
| `omp tiny-models download <model\|all> [--json]` | Downloads one model or all supported tiny models. |

## Practical examples

```sh
# Start in another directory with an additional workspace root
omp --cwd apps/web --add-dir packages/ui "Fix the broken component test"

# Resume a session and keep the result as a separate fork
omp --fork 01JZ8Y2A "Try the smaller design"

# Bounded one-shot run for CI
omp -p --mode json --no-session --max-time 10m \
  "Check whether generated files are current" > omp-events.jsonl

# Restrict the session and require approval for writes
omp --tools read,grep,glob --approval-mode write \
  "Audit the migration without changing files"

# Inspect available models, then benchmark two choices
omp models find sonnet
omp bench sonnet gpt-5.6 --runs 3

# Manage a project-scoped marketplace plugin
omp plugin marketplace add https://example.com/marketplace.json
omp plugin install widget@example --scope project
omp plugin list

# Check configuration and storage without applying destructive work
omp config get defaultThinkingLevel
omp gc --json
omp worktree clear --dry-run
```

If a command rejects an action or flag, run `omp <command> --help` from the installed version. That output is generated from the same current command registry used for dispatch and completion.
