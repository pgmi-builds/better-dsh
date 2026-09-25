<!--
source: https://omp.sh/docs/marketplace
fetched: 2026-09-06
-->

# Marketplaces

> Add plugin catalogs you trust, browse what they publish, and install plugins for one project or every project.

Marketplaces let you install plugins by short name instead of managing each plugin's repository yourself. A marketplace is only a catalog: it tells omp which plugins exist and where their code comes from.

Start by adding a catalog controlled by a publisher you trust, browse its entries, and install one plugin at **project** scope while you evaluate it:

```text
/marketplace add anthropics/claude-plugins-official
/marketplace
/marketplace install --scope project <plugin>@claude-plugins-official
```

In the interactive TUI, `/marketplace` opens a browser showing plugin names, versions, descriptions, and their marketplace. Select an entry to install it at the default user scope, or use the explicit install command above when you want project scope.

## Choose and verify a source

omp does not search a central store or certify marketplace publishers. `/marketplace discover` searches only catalogs you have already added. Obtain a source from the plugin publisher's own site or repository, then inspect it before adding it:

1. Confirm the repository or domain belongs to the expected publisher.
2. Inspect `.omp-plugin/marketplace.json` or `.claude-plugin/marketplace.json`.
3. Follow each plugin's `source`; a trusted catalog can still point to another repository.
4. Prefer entries pinned to a reviewed commit with `sha`, rather than a moving branch.

Adding a source fetches and validates its catalog; it does not install a plugin. List configured sources at any time to catch an unexpected or renamed source:

```text
/marketplace list
```

From a shell:

```sh
omp plugin marketplace list
```

Accepted source forms are:

| Source | Example | How omp treats it |
| --- | --- | --- |
| GitHub shorthand | `owner/repo` | Clones the GitHub repository |
| Git URL | `https://github.com/org/repo`, `git@github.com:org/repo.git`, or `ssh://…` | Clones the repository |
| Direct catalog URL | `https://plugins.example/marketplace.json` | Downloads that JSON catalog |
| Local directory | `./marketplace`, `~/marketplace`, or an absolute path | Reads the directory without cloning it |

Git and local sources must contain `.omp-plugin/marketplace.json` (preferred) or the Claude Code-compatible `.claude-plugin/marketplace.json` fallback. A direct catalog URL cannot use relative plugin sources such as `"./plugins/linter"`, because there is no accompanying repository tree.

## Browse and install

After adding a source, either open the TUI browser or print the available entries:

```text
/marketplace
/marketplace discover
/marketplace discover claude-plugins-official
```

The shell equivalents are:

```sh
omp plugin discover
omp plugin discover claude-plugins-official
```

Install by the catalog ID `name@marketplace`:

```text
/marketplace install --scope project name@marketplace
/marketplace install --scope user name@marketplace
```

```sh
omp plugin install name@marketplace --scope project
```

The default scope is `user`. `--force` reinstalls an existing plugin:

```text
/marketplace install --force name@marketplace
```

For the shell command, the marketplace must already be configured. Otherwise, `omp plugin install name@marketplace` may interpret the argument as an npm package and version tag instead. Run `omp plugin marketplace list` and use the catalog's declared `name`, which may differ from its repository name.

## Update, upgrade, and remove

Refreshing a **marketplace** and upgrading a **plugin** are separate operations:

```text
/marketplace update marketplace-name   # refresh one catalog
/marketplace update                    # refresh every catalog
/marketplace upgrade name@marketplace  # reinstall one plugin from its current entry
/marketplace upgrade                   # upgrade all eligible marketplace plugins
```

A catalog update does not change installed plugin code. An upgrade does. When upgrading all plugins, omp compares entries that declare a `version`; one failed plugin does not stop the others, so review the reported results.

List or remove installed plugins with:

```text
/marketplace installed
/marketplace uninstall --scope project name@marketplace
/plugins list
```

In the TUI, `/marketplace uninstall` with no ID opens a selector. Shell equivalents are:

```sh
omp plugin list
omp plugin uninstall name@marketplace --scope project
omp plugin upgrade name@marketplace --scope project
```

Remove a catalog only after deciding what to do with its installed plugins:

```text
/marketplace remove marketplace-name
```

```sh
omp plugin marketplace remove marketplace-name
```

Removing a marketplace deletes its registry entry and catalog cache, but does **not** uninstall plugins already recorded from it. Uninstall those explicitly if you no longer trust or need them.

## Scopes and enable state

| Scope | Visibility | Default storage |
| --- | --- | --- |
| `user` | Every project | `~/.omp/plugins/installed_plugins.json` |
| `project` | Only the active project | The nearest project `.omp/plugins/installed_plugins.json` |

An enabled project installation shadows the user installation of the same `name@marketplace`. A disabled project installation does not shadow the user copy. When a plugin is installed in both scopes, pass `--scope user` or `--scope project` to uninstall, upgrade, enable, or disable the intended copy.

```text
/plugins disable --scope project name@marketplace
/plugins enable --scope project name@marketplace
```

```sh
omp plugin disable name@marketplace --scope project
omp plugin enable name@marketplace --scope project
```

Project scope limits where omp loads the plugin; it is **not** a security sandbox. Plugin code still runs with the same operating-system permissions as omp.

On systems using omp's XDG layout, user registry and cache files live under the effective XDG data/cache roots instead of `~/.omp`. `omp config init-xdg` creates those directories but does not move existing data or set the XDG environment variables.

## Reload the active session

Marketplace commands in the interactive TUI update disk state and invalidate discovery caches, but they do not rebuild every part of the running session.

After installing, upgrading, uninstalling, enabling, or disabling a plugin, run:

```text
/reload-plugins
```

This refreshes skills, slash commands, task agents, capability discovery, and MCP servers. Restart the omp session when the change includes custom tools, hooks, or extension modules; those initialized runtime surfaces are not fully rebuilt by `/reload-plugins`.

Shell commands affect future sessions. An already-running session still needs the reload or restart described above.

## Control automatic updates

By default, `marketplace.autoUpdate` is `notify`. At startup omp refreshes stale catalogs and checks versions, but current `notify` mode reports availability only in the debug log; it does not display a TUI notification. Choose the behavior explicitly if that is not what you want:

```sh
omp config get marketplace.autoUpdate
omp config set marketplace.autoUpdate off
omp config set marketplace.autoUpdate auto
```

| Value | Startup behavior |
| --- | --- |
| `off` | Do not check marketplace plugins |
| `notify` | Check and write available updates to the debug log; this is the default |
| `auto` | Check and automatically upgrade available plugins |

Use `off` or manual `/marketplace update` plus `/marketplace upgrade` when you need to review every code change before it runs. `auto` allows a publisher to deliver newer plugin code without a manual approval step.

## Security model

Marketplaces and plugins are not signed, sandboxed, or centrally reviewed by omp. Installing a plugin can add skills and commands, but it can also add hooks, custom tools, agents, MCP or LSP servers, and extension modules. Those surfaces may run processes, access files, make network requests, or act automatically during a session.

Before installation:

- review both the catalog entry and the resolved plugin source;
- inspect hooks, server commands, extension modules, and package installation scripts;
- verify a declared `sha` against the commit you reviewed;
- use project scope to limit accidental loading elsewhere, without treating it as a permission boundary;
- avoid automatic upgrades for sources whose future changes you cannot trust.

`--force` only reinstalls a plugin. It does not perform additional verification.

## Troubleshooting

### A source adds successfully but no plugins appear

Run `/marketplace update <name>` and then `/marketplace discover <name>`. The catalog's top-level `name` is the command name. Invalid plugin entries are skipped even when the rest of a catalog is usable, so inspect the logs and the entry's required `name` and `source` fields.

### The catalog cannot be found

For a repository or local directory, put the catalog at `.omp-plugin/marketplace.json` or `.claude-plugin/marketplace.json` at the repository root. Prefix a relative local path with `./`; a bare directory name is not recognized as a local source.

### An install is not visible

Run `/marketplace installed` to confirm the ID and scope, then `/reload-plugins`. Restart the session for tools, hooks, or extension modules. If both scopes contain the same ID, `/plugins list` shows which copy is active or shadowed.

### Updating did not change the plugin

`/marketplace update` refreshes only the catalog. Run `/marketplace upgrade name@marketplace` to update installed code, then reload or restart the session.

## Publish a marketplace

A marketplace author publishes a Git repository with a catalog and one or more installable [plugin trees](/docs/plugins):

```text
my-marketplace/
  .omp-plugin/
    marketplace.json
  plugins/
    my-plugin/
```

Use `.omp-plugin/marketplace.json` for omp. Use `.claude-plugin/marketplace.json` instead when you also need Claude Code compatibility; omp reads it when the `.omp-plugin` catalog is absent.

The smallest valid catalog is:

```json
{
  "name": "my-marketplace",
  "owner": { "name": "Your Name" },
  "plugins": [
    {
      "name": "my-plugin",
      "description": "What this plugin adds",
      "version": "1.0.0",
      "source": "./plugins/my-plugin"
    }
  ]
}
```

`name`, `owner.name`, and `plugins` are required at the top level. Each plugin requires `name` and `source`. Marketplace and plugin names must start and end with a lowercase letter or digit, contain only lowercase letters, digits, `-`, and `.`, and be at most 64 characters.

Relative sources must begin with `./` and remain inside the marketplace repository. External plugins may use `github`, `url`, or `git-subdir` source objects with optional `ref` and `sha`; pin `sha` for reproducible installs. npm source objects are accepted by the catalog parser but are not currently installable.

Test the exact consumer workflow locally before publishing:

```text
/marketplace add ./my-marketplace
/marketplace discover my-marketplace
/marketplace install --scope project my-plugin@my-marketplace
/reload-plugins
```

Then push the repository and share its `owner/repo` shorthand. Consumers can inspect that repository, add it, and install by the catalog name.

## Related

- [Plugins](/docs/plugins) — plugin layout, loading, and lifecycle.
- [Skills](/docs/skills) — on-demand playbooks that plugins can ship.
- [Hooks](/docs/hooks) — automatic lifecycle code to inspect before installation.
- [Custom tools](/docs/custom-tools) — executable capabilities a plugin can add.
