<!--
source: https://omp.sh/docs/settings
fetched: 2026-09-06
-->

# Settings

> Inspect, change, scope, and troubleshoot omp configuration without guessing which value wins.

omp works without a config file: known settings fall back to built-in defaults (some optional values default to unset). Start a session and run `/settings` when you want to see the **effective** values for your current directory, search by name, and change the settings that have an interactive control. The panel marks values that differ from their built-in defaults.

The panel saves changes to your active global or named-profile config and applies most UI and session behavior immediately. Use **Enter** or **Space** to change a value, type to search across tabs, and **Esc** to close. For a precise reset, a project-only change, or a setting not shown in the panel, use `omp config` or YAML as described below.

A few useful defaults on a fresh install are:

- dark theme `titanium` and light theme `light`
- thinking level `high`
- steering and follow-ups delivered `one-at-a-time`
- immediate interruption when you steer a running turn
- compaction and automatic image resizing enabled
- named model-role changes saved globally (`modelRoleStorage: global`)
- tool approval mode `yolo` unless a launch mode or runtime flag overrides it; review [Approvals](/docs/approvals) before changing policy

Defaults can evolve. `omp config list` is the authoritative view of the keys and effective values in the version you are running.

## Inspect, change, and reset from the shell

Run these in the directory whose project settings you want included:

```sh
omp config list                              # every effective setting, type, and allowed enum values
omp config list --json                       # machine-readable inventory
omp config get theme.dark                    # one effective value
omp config set theme.dark catppuccin-macchiato
omp config set compaction.enabled false
omp config reset theme.dark                  # write the built-in default to global config
omp config path                              # print the active agent directory
```

`set` and `reset` write the global config for the active profile, not the project file. `reset` writes the schema default; it does **not** delete the key. If you want the key to inherit from another layer, remove it from the YAML file instead.

Values are parsed by setting type:

| Type | Shell input |
| --- | --- |
| Boolean | `true` / `false`, `yes` / `no`, `on` / `off`, or `1` / `0` |
| Number | A finite number |
| Enum | One exact value listed by `omp config list` |
| Array | JSON, for example `omp config set disabledProviders '["ollama"]'` |
| Record | JSON, for example `omp config set providers.maxInFlightRequests '{"anthropic":2}'` |
| String | The remaining argument text, trimmed |

Keys must be complete dotted paths: use `theme.dark`, not `theme`. Unknown keys and invalid CLI values fail without being saved. Human `config list` output masks configured credentials; `--json` omits their values and marks them redacted. `config get` is an explicit request for one value and therefore does **not** mask a credential.

## Files and scopes

| Scope | Location | Use it for | How to write it |
| --- | --- | --- | --- |
| Global | `~/.omp/agent/config.yml` | Your normal defaults across projects | `/settings`, `omp config set`, `omp config reset`, or an editor |
| Named profile | `~/.omp/profiles/<name>/agent/config.yml` | Isolated settings, auth, sessions, and caches for a work/persona profile | Run under `omp --profile <name>` or set `OMP_PROFILE`, then use the same commands |
| Project | `<cwd>/.omp/config.yml` | Repository-specific overrides that can be shared with the project | Edit the YAML file; settings discovery checks the current directory, not ancestors |
| Config overlay | Any YAML file passed with `--config` or named in `PI_CONFIG_FILES` | Temporary, CI, secret, or experiment-specific overrides | Read-only layer for that process; never copied into persistent config |
| Runtime | CLI flags and feature-specific environment overrides | One launch only | Never persisted |

`omp config path` prints the active **agent directory**, so append `config.yml` when opening the file. An existing `config.yaml` is also accepted and updated in place. `PI_CODING_AGENT_DIR` relocates the default profile's agent directory; `PI_CONFIG_DIR` changes the normal `.omp` root name.

A named profile replaces the ordinary global scope rather than inheriting its settings. To inspect one without entering a session, put the profile flag before the subcommand:

```sh
omp --profile work config path
omp --profile work config list
omp --profile work config set theme.dark titanium
```

`OMP_PROFILE` is the persistent environment equivalent; `PI_PROFILE` remains a legacy fallback. Keybindings are stored separately and have their own profile inheritance rules; see [Keybindings](/docs/keybindings#remap-shortcuts).

### Project settings

Create `.omp/config.yml` in the exact directory where you launch omp:

Enabled compatibility providers can also contribute project-level settings from their own formats. They share the project layer; use `omp config get <key>` to inspect the merged result and [Context files](/docs/context-files) to control discovery sources.

```yaml
# <repo>/.omp/config.yml
modelRoles:
  default: anthropic/claude-sonnet-4-5

disabledProviders:
  - ollama

compaction:
  enabled: true
  thresholdPercent: 80
```

`omp config set` does not write arbitrary project settings. Edit this file directly. The one interactive project write is a model-selector role assignment when `modelRoleStorage` is `project`; only `modelRoles` is updated there, and missing project roles continue to fall back to the global profile.

Keep credentials out of committed project YAML. Prefer stored login credentials, environment variables, [secret references](/docs/secrets), or an untracked overlay.

### One-shot overlays

```sh
omp --config ./local/ci.yml "diagnose this failure"
omp --config ./base.yml --config ./experiment.yml "try this configuration"
```

Overlay paths are resolved from the working directory and `~` is expanded. Repeating `--config` is allowed; later files win. `PI_CONFIG_FILES` accepts a platform path list (`:` on Unix, `;` on Windows) and loads those files first, before explicit `--config` files.

Overlays are strict: a missing file, malformed YAML, or document whose top level is not a mapping stops startup. They are not quarantined or silently ignored.

## Precedence and merging

From lowest to highest priority:

```text
built-in defaults
  < active global/profile config
  < project config
  < PI_CONFIG_FILES overlays, in listed order
  < --config overlays, in command-line order
  < runtime flags and feature-specific environment overrides
```

Examples of runtime overrides include model-role flags such as `--model`, `--smol`, `--slow`, and `--plan`, approval flags, `--hide-thinking`, `--advisor`, `--no-pty`, and `--api-key`. Environment variables are not one universal settings layer: each owning feature decides whether its variable is an override or fallback. See the [environment variable reference](/docs/env).

Mappings deep-merge; scalars and arrays replace:

```yaml
# global
statusLine:
  preset: default
  transparent: false
disabledProviders: [anthropic, openai]

# project
statusLine:
  transparent: true
disabledProviders: [groq]
```

Inside the project, `statusLine.preset` remains `default`, `transparent` becomes `true`, and `disabledProviders` is exactly `[groq]`. Higher arrays never append to lower arrays. This replacement rule also applies to `enabledModels`, `cycleOrder`, `extensions`, and every other array setting.

## Validation, saving, and reloads

- `/settings` constrains choices to the controls and values supported by the current build. Its changes update the running session and are saved in the background.
- `omp config set` checks that the key exists and parses booleans, numbers, enums, arrays, and records before writing atomically.
- A hand-edited YAML file must contain a mapping at its root. YAML parsing does not promise to catch every semantically wrong value, so use `/settings` or `omp config set` when possible and inspect the result with `omp config get <key>`.
- On writable startup, invalid persistent global or native project YAML is moved beside the original as `*.broken-<timestamp>-<pid>-<id>`, then startup fails and reports both paths. Fix or restore the moved file; omp does not discard it.
- Running sessions do not generally watch config files. `/settings` changes are live, but changes made by another `omp config` process or text editor reliably take effect on the next launch. Moving the session to another working directory reloads that directory's project layer; restart when model/provider discovery was already initialized.
- Concurrent saves re-read the file under a lock and preserve unrelated external edits.

There is no general `/reload-settings` command. `/reload-plugins` refreshes extension and discovery state, not arbitrary settings.

## Common recipes

### Set model roles

Use `/settings` or the model selector for guided selection, and [Model roles](/docs/roles) for role behavior. YAML is useful when several roles change together:

```yaml
modelRoles:
  default: anthropic/claude-sonnet-4-5
  smol: anthropic/claude-haiku-4-5
  slow: anthropic/claude-opus-4-6:high
  plan: openai/gpt-5.3-codex:high
  commit: anthropic/claude-haiku-4-5
```

Run `omp --list-models` to inspect the models available with your current providers and credentials.

### Change queue behavior

```yaml
steeringMode: one-at-a-time  # or all
followUpMode: one-at-a-time  # or all
interruptMode: immediate     # or wait
```

See [Using omp](/docs/using) for how steering differs from follow-up prompts.

### Set a theme and terminal behavior

```yaml
theme:
  dark: catppuccin-macchiato
  light: light
terminal:
  showImages: true
tui:
  hyperlinks: auto
```

See [Themes](/docs/themes) for built-in and custom palettes.

### Limit a repository's providers

```yaml
# <repo>/.omp/config.yml
disabledProviders:
  - ollama
  - openrouter
```

This project array replaces the global array. Provider ids and authentication live in [Providers](/docs/providers).

### Configure safety-sensitive features

Start from the interactive controls, then follow the dedicated guides rather than copying a broad policy blindly:

- tool permission policy: [Approvals](/docs/approvals)
- advisor review: [Advisor](/docs/advisor)
- desktop automation: [Computer](/docs/computer)
- security review: [Security](/docs/security)
- prompt-triggered modes: [Magic keywords](/docs/magic-keywords)
- pre-execution repository walks: [Prewalk](/docs/prewalk)

### Configure compaction and memory

```yaml
compaction:
  enabled: true
  thresholdPercent: 80
memory:
  backend: off
```

Compaction has several strategies, thresholds, and background modes; see [Compaction](/docs/compaction). Memory backends and retention are covered in [Memory](/docs/memory).

## Complete setting groups

`/settings` is organized into the following current tabs and sections. This is the best place to browse without knowing a key name.

| Tab | Sections |
| --- | --- |
| Appearance | Theme; Composer; Status Line; Display; Images |
| Model | Thinking; Sampling; Prompt; Retry & Fallback; Advisor; Prewalk; Vision |
| Interaction | Input; Approvals; Notifications; Speech; Collab; Magic Keywords; Startup & Updates; Power (macOS); Agent; Git |
| Context | General; Compaction; Rules (TTSR); Experimental |
| Memory | General; Auto-Learn; Mnemopi; Hindsight |
| Files | Editing; Reading; Read Summaries; LSP |
| Shell | Bash; Eval & Runtimes |
| Tools | Available Tools; Todos; Grep & Browser; Computer; GitHub; Output Limits; Execution; Discovery & MCP; Extensions; Developer |
| Tasks | Modes; Subagents; Isolation; Commands & Skills |
| Providers | Services; Fireworks; Tiny Model; Protocol; Timeouts; Privacy |

For exact key discovery, the family index below maps current namespaces to where users normally encounter them. Some families span more than one tab. Standalone keys are listed alongside namespaces. Use `omp config list` for every leaf key, effective value, type, and enum choices; add `--json` when you need descriptions in machine-readable output.

- **Appearance:**`theme`, `symbolPreset`, `colorBlindMode`, `composer`, `statusLine`, `terminal`, `images`, `tui`, `display`, `showHardwareCursor`.
- **Model:**`modelRoles`, `modelTags`, `modelProviderOrder`, `cycleOrder`, `modelRoleStorage`, `enabledModels`, `defaultThinkingLevel`, `hideThinkingBlock`, `proseOnlyThinking`, `omitThinking`, `externalThinking`, `model`, `inlineToolDescriptors`, `includeModelInPrompt`, `includeWorkspaceTree`, `personality`, sampling keys (`temperature`, `topP`, `topK`, `minP`, `presencePenalty`, `repetitionPenalty`, `textVerbosity`), `tier`, `retry`, `advisor`, `prewalk`, and model request `images` / `providers` options.
- **Interaction:**`autoResume`, `power`, `git`, `steeringMode`, `followUpMode`, `interruptMode`, `loop`, `doubleEscapeAction`, `treeFilterMode`, `autocompleteMaxVisible`, `spelling`, `emojiAutocomplete`, `paste`, `startup`, `update`, `marketplace`, `magicKeywords`, `completion`, `error`, `ask`, `recap`, `collab`, `share`, `stt`, and interaction-related `tools` / `features`.
- **Context:**`workspace`, `contextPromotion`, `extendedContext`, `compaction`, `snapcompact`, `branchSummary`, `ttsr`, plus context-related `tools` options.
- **Memory:**`memory`, `autolearn`, `memories`, `mnemopi`, `hindsight`, and memory-model settings under `providers`.
- **Files:**`edit`, `readLineNumbers`, `read`, and `lsp`.
- **Shell:**`shellPath`, `bash`, `bashInterceptor`, `shellMinimizer`, `eval`, `python`, `ruby`, and `julia`.
- **Tools:**`tools`, `todo`, `glob`, `grep`, `astGrep`, `astEdit`, `debug`, `launch`, `speechgen`, `generate_image`, `inspect_image`, `computer`, `checkpoint`, `fetch`, `vault`, `github`, `web_search`, `security`, `browser`, `async`, `irc`, `mcp`, `tasks`, `extensionHandlers`, and developer options under `dev`.
- **Tasks:**`plan`, `goal`, `title`, `task`, `worktree`, `skills`, and `commands`.
- **Providers and services:**`providers`, `provider`, `disabledProviders`, `secrets`, `live`, `tts`, `speech`, `codexResets`, `exa`, `searxng`, and auth-broker settings under `auth`.
- **Advanced CLI/YAML-only families:**`extensions`, `disabledExtensions`, `commit`, `gc`, `thinkingBudgets`, plus advanced leaves under `statusLine`, `images`, `tui`, `retry`, `compaction`, `memories`, `autolearn`, `mnemopi`, `hindsight`, `bashInterceptor`, `shellMinimizer`, `eval`, `task`, and `skills`.

Keybinding remaps do not live in this file: use `keybindings.yaml` as described in [Keybindings](/docs/keybindings#remap-shortcuts).

## Troubleshooting

### A project value is not taking effect

1. Run `omp config get <key>` from the directory containing `.omp/config.yml`.
2. Confirm the project file is in the process's exact working directory; omp does not search parent directories for native project settings.
3. Check that a later `--config` overlay, `PI_CONFIG_FILES`, CLI flag, or feature environment variable is not winning.
4. Remember that an array in the project replaces the whole global array.
5. Restart if provider/model/tool discovery was already initialized.

### `omp config set` changed the wrong file

It always writes the active global/profile config. Run `omp config path` to identify that agent directory. Edit `<repo>/.omp/config.yml` directly for a project override.

### `omp config reset` appears to do nothing

`reset` writes the built-in default into the global file. A project, overlay, or runtime value can still win. Inspect with `omp config get <key>`, then remove or change the higher layer. To inherit instead of pinning the global default, delete the global YAML key manually.

### Startup reports broken YAML

Read the reported error and backup path. Persistent malformed YAML is moved to a unique `.broken-*` sibling before startup stops, preserving the original contents. Repair that backup into a mapping and restore it as `config.yml`. Overlay errors are not moved; fix the overlay in place.

### A key is unknown or a value is rejected

Run `omp config list`, copy the exact dotted key, and use one of the displayed enum values. Arrays and records passed to `set` must be valid JSON even though persistent files use YAML.

### An edit is not visible in an existing session

A separate shell command or editor does not push settings into an already-running session. Start a new session. If you used `/settings`, check whether a project, overlay, or runtime override has higher precedence than the global value you changed.
