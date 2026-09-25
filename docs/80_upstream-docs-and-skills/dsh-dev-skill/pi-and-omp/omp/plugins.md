<!--
source: https://omp.sh/docs/plugins
fetched: 2026-09-06
-->

# Plugins

> Install, inspect, pause, update, and remove trusted bundles of omp capabilities without managing every file by hand.

Plugins add capabilities to omp as one managed unit. A plugin may contain extension code, skills, slash commands, hooks, custom tools, agents, rules, prompts, or MCP/LSP/DAP configuration. Use one when you want to install and manage a collection of related behavior together.

Start by seeing what is already installed. Before adding anything, inspect its publisher and source:

```sh
omp plugin list
omp plugin install --dry-run '@scope/plugin@1.2.3'
omp plugin install '@scope/plugin@1.2.3'
omp plugin list
```

`--dry-run` previews npm, Git, and local-path installs without installing the target. It does **not** apply to marketplace installs; evaluate those at project scope instead. A successful install prints the resolved name and version. Start a new omp session to load all of the plugin's behavior, or follow [Reload an active session](#reload-an-active-session).

> **Plugins are trusted code, not a sandbox.** Project scope limits where a marketplace plugin is discovered; it does not limit what that plugin can read, write, execute, or send over the network.

## Choose an install source

`omp plugin install` accepts these source forms:

| Source | Example | Where it is installed |
| --- | --- | --- |
| npm package or version | `omp plugin install '@scope/plugin@1.2.3'` | User plugin directory |
| Git shorthand, optionally pinned | `omp plugin install 'github:org/repo#v1.4.0'` | User plugin directory |
| Full Git URL | `omp plugin install 'https://github.com/org/repo.git#v1.4.0'` | User plugin directory |
| Local directory | `omp plugin install ./path/to/plugin` | Symlinked into the user plugin directory |
| Marketplace entry | `omp plugin install --scope project plugin-name@marketplace-name` | User scope by default, or project scope |

Git shorthands also support `gitlab:`, `bitbucket:`, `codeberg:`, `sourcehut:`, and `srht:`. Full HTTPS, SSH, `git://`, and `git+…` URLs are accepted. Quote sources containing `#`, `[` or `]` so your shell does not interpret them.

The shorter `omp install <source>` command is a convenience wrapper around `omp plugin install` and `omp plugin link`. The `omp plugin …` form is used throughout this page because it exposes the complete management surface.

For a local plugin under development, these are equivalent:

```sh
omp plugin install ./my-plugin
omp plugin link ./my-plugin
```

Source edits remain visible through the symlink, but an already running omp session still needs a reload or restart before every changed capability is active.

## Install from a marketplace

A marketplace is a catalog of plugins, not a plugin itself. Add a catalog, inspect its entries, then install an entry by its full `name@marketplace` ID:

```sh
omp plugin marketplace add anthropics/claude-plugins-official
omp plugin marketplace list
omp plugin discover claude-plugins-official
omp plugin install --scope project plugin-name@claude-plugins-official
omp plugin list
```

Supported catalog sources include:

- GitHub shorthand such as `owner/repo`
- HTTP(S), SSH, or Git repository URLs
- a direct HTTP(S) URL ending in `.json`
- local directories such as `./catalog`, `~/catalog`, or `/absolute/catalog`

Git and local catalogs use `.omp-plugin/marketplace.json`, falling back to the Claude Code-compatible `.claude-plugin/marketplace.json`. See [Marketplaces](/docs/marketplace) for catalog browsing, source formats, and publishing.

### User and project scope

Scope applies only to marketplace installs:

- `--scope user` is the default and makes the plugin available across projects.
- `--scope project` records it in the nearest project `.omp/plugins/installed_plugins.json` and makes it available in that project.
- npm, Git, and linked local plugins use the user plugin directory; passing `--scope` for them is ignored with a warning.

An enabled project install shadows an enabled user install with the same `name@marketplace` ID. A disabled project install does not hide the enabled user install. If the same plugin is installed in both scopes, pass `--scope user` or `--scope project` when upgrading, disabling, enabling, or uninstalling that copy.

Project scope is useful for keeping a project's dependency set separate. It is **not** a security boundary: the plugin still runs with the same OS permissions as omp.

## Inspect, disable, and enable

List before changing state so you use the installed package name or full marketplace ID:

```sh
omp plugin list
omp plugin list --json
```

The human-readable list separates npm/link plugins from marketplace plugins. It shows versions, enabled state and optional features for npm/link plugins; marketplace rows include scope and whether a project copy shadows a user copy. Inside a session, `/plugins` or `/plugins list` provides a shorter view.

Disable a plugin when you want to stop loading it without deleting its files or settings:

```sh
# npm, Git, or linked plugin; state is user-wide
omp plugin disable @scope/plugin
omp plugin enable @scope/plugin

# marketplace plugin
omp plugin disable --scope project plugin-name@marketplace-name
omp plugin enable --scope project plugin-name@marketplace-name
```

Inside an interactive session, `/plugins disable` and `/plugins enable` manage marketplace plugins:

```text
/plugins disable --scope project plugin-name@marketplace-name
/plugins enable --scope project plugin-name@marketplace-name
```

Run `/reload-plugins` afterward, or restart omp. Disabling reduces future loading; it cannot undo actions code already performed in the current process.

Some npm/link plugins declare optional features. Inspect and change those independently of the whole-plugin enabled state:

```sh
omp plugin features @scope/plugin
omp plugin features @scope/plugin --enable search,web
omp plugin features @scope/plugin --disable web
omp plugin features @scope/plugin --set search
```

At install time, quote the feature selector:

```sh
omp plugin install '@scope/plugin[search,web]'
omp plugin install '@scope/plugin[*]'
omp plugin install '@scope/plugin[]'
```

No brackets uses the plugin's defaults; `[*]` enables every declared feature and `[]` enables none of the optional features.

## Update plugins

Update behavior depends on the source.

### Marketplace plugins

Refreshing a marketplace updates only its catalog. Upgrade is the separate step that replaces installed plugin code:

```sh
omp plugin marketplace update marketplace-name
omp plugin upgrade --scope project plugin-name@marketplace-name
```

Omit the marketplace name to refresh all catalogs. Omit the plugin ID from `omp plugin upgrade` to upgrade all installed marketplace plugins:

```sh
omp plugin marketplace update
omp plugin upgrade
```

When one marketplace plugin exists in both scopes, omitting `--scope` upgrades both copies. Bulk upgrade may partially succeed if one entry fails, so read every result and run `omp plugin list` afterward.

### npm and Git plugins

There is no generic `omp plugin update` command for npm or Git installs. Reinstall the version or ref you intend to run:

```sh
omp plugin install '@scope/plugin@1.3.0'
omp plugin install 'github:org/repo#v1.5.0'
```

For a linked local plugin, update its source directory yourself; the symlink does not need reinstalling. Pin npm versions and Git tags or commits when reproducibility matters.

## Remove a plugin

Preview removal, then uninstall by the name shown in `omp plugin list`:

```sh
omp plugin uninstall --dry-run @scope/plugin
omp plugin uninstall @scope/plugin
```

For a marketplace plugin, use its full ID and specify the copy when necessary:

```sh
omp plugin uninstall --dry-run --scope project plugin-name@marketplace-name
omp plugin uninstall --scope project plugin-name@marketplace-name
```

Uninstalling removes that plugin registration and installed files for the selected scope. Removing a marketplace catalog is different: it removes the catalog and its cache but does not uninstall plugins already installed from it.

```sh
omp plugin marketplace remove marketplace-name
```

Restart omp after removing executable plugin behavior, or reload the active session as described below.

## Reload an active session

Shell commands change plugin state on disk; they do not rebuild an omp process that is already running. Interactive marketplace changes also require an explicit refresh.

Run:

```text
/reload-plugins
```

This refreshes plugin discovery, skills, slash commands, agent definitions, capability caches, and MCP connections in the active session. Restart omp for newly installed or changed extension modules, hooks, or executable custom tools, because those initialized runtime components are not fully rebuilt in place. When in doubt, restart.

## Check health and settings

If a plugin is installed but missing from `omp plugin list`, fails to load, or points at a deleted local path, run the non-mutating health check first:

```sh
omp plugin doctor
```

After reading its findings, `omp plugin doctor --fix` can attempt repairs. Use `--json` when another program needs to consume the result.

Plugins may declare typed settings. Inspect the declared keys before setting one:

```sh
omp plugin config list @scope/plugin
omp plugin config get @scope/plugin apiKey
omp plugin config set @scope/plugin apiKey value
omp plugin config delete @scope/plugin apiKey
omp plugin config validate
```

Add `-l` or `--local` to `config list`, `get`, `set`, or `delete` to use the current project's setting overrides. A manifest marking a setting as secret masks its display; it does not turn an untrusted plugin into trusted code.

## Trust checklist

A plugin can run extension modules in omp's process, register hooks around prompts and tool activity, expose executable tools, start MCP/LSP/DAP processes, and receive configured credentials. Treat installation like running code from that source.

Before installing or upgrading:

1. Verify the publisher, repository, and exact npm version, Git ref, or marketplace entry.
2. Read extension entry points, hooks, executable tools/scripts, and MCP/LSP/DAP configuration.
3. Review dependency and source changes between the installed and proposed versions.
4. Prefer a pinned npm version, Git tag, commit, or marketplace version.
5. Use project scope to limit discovery while evaluating a marketplace plugin, but do not mistake it for sandboxing.
6. Disable or uninstall anything you no longer trust, then restart omp.

Adding a marketplace does not execute its plugins, but the catalog controls where later installs and upgrades fetch code. Trust both the catalog maintainer and each plugin source.

## Plugins, extensions, and marketplaces

| Term | What it is | How users manage it |
| --- | --- | --- |
| **Plugin** | An installable unit that can bundle several omp capabilities | `omp plugin install`, `list`, `disable`, `upgrade`, and `uninstall` |
| **Extension** | Runtime TypeScript/JavaScript code that registers behavior with omp | Load directly for one session or from config, or ship it inside a plugin |
| **Marketplace** | A catalog that names plugins and points to their sources | `omp plugin marketplace …` or `/marketplace …` |

A plugin does not have to contain an extension module; it may contain only declarative surfaces such as skills or MCP configuration. Conversely, you can load an extension directly without installing it as a managed plugin. See [Authoring extensions](/docs/extension-authoring) for that runtime API.

## Command reference

| Command | Purpose |
| --- | --- |
| `omp plugin list [--json]` | List npm/link and marketplace plugins |
| `omp plugin install [--dry-run] [--force] <source>[features] …` | Install npm, Git, local, or marketplace sources; `--dry-run` is not supported for marketplace entries |
| `omp install <source> …` | Convenience form of plugin install/link |
| `omp plugin link <path>` | Symlink a local plugin for development |
| `omp plugin disable <name> …` / `enable <name> …` | Persist whole-plugin enabled state |
| `omp plugin features <name> [--enable list] [--disable list] [--set list]` | Inspect or select optional npm/link plugin features |
| `omp plugin uninstall [--dry-run] <name> …` | Remove installed plugins |
| `omp plugin upgrade [name@marketplace] [--scope user\|project]` | Upgrade one or all marketplace plugins |
| `omp plugin marketplace add <source>` | Add a marketplace catalog |
| `omp plugin marketplace list` | List configured catalogs |
| `omp plugin marketplace update [name]` | Refresh one or all catalogs without upgrading plugins |
| `omp plugin marketplace remove <name>` | Remove a catalog, not its installed plugins |
| `omp plugin discover [marketplace]` | List marketplace entries |
| `omp plugin doctor [--fix] [--json]` | Check plugin installation health |
| `omp plugin config <list\|get\|set\|delete> <name> … [-l]` | Manage declared plugin settings |
| `omp plugin config validate` | Validate settings for every installed plugin |

Use `--scope user|project` only with marketplace install, enable, disable, upgrade, and uninstall operations. `/marketplace help` shows the equivalent in-session marketplace commands.

## For plugin authors

Users should not need to understand manifests to manage plugins. Authors of npm or linked omp packages declare runtime entry points in `package.json` under `omp` (legacy `pi` is also accepted):

```json
{
  "name": "@acme/omp-review",
  "version": "1.0.0",
  "omp": {
    "extensions": ["./src/index.ts"]
  }
}
```

A package can also use conventional `skills/`, `commands/`, `hooks/`, `tools/`, `rules/`, `prompts/`, and `agents/` directories plus `.mcp.json` or `mcp.json`. Optional `features` and typed `settings` belong in the `omp` manifest because the management commands above read them. See [Authoring extensions](/docs/extension-authoring) for the public extension API and [Marketplaces](/docs/marketplace) for catalog manifests.
