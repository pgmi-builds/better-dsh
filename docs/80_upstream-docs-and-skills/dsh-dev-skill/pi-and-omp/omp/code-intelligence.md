<!--
source: https://omp.sh/docs/code-intelligence
fetched: 2026-09-06
-->

# Code intelligence

> Give omp symbol-aware navigation, renames, fixes, and diagnostics through the language servers already used by your project.

## Make code changes with semantic context

Code intelligence lets omp ask a language server what a symbol means, where it is defined, which code refers to it, and which fixes are valid. That is safer than treating source code as plain text: a semantic rename can distinguish two same-named variables and update imports and re-exports across files.

Usually, you only need to install the language server for your language, start `omp` from the project root, and ask for the outcome you want:

```text
Rename `issueToken` to `mintToken` across the project. Preview the language-server changes before applying them.
```

omp can also find definitions and implementations, inspect inferred types, list references, report diagnostics, apply server-provided fixes, and rename files while updating imports. For syntax-based changes that do not center on a symbol, use [structural edits](/docs/editing) instead.

## What works automatically

LSP support is enabled by default. omp checks its built-in server definitions and selects a server only when both of these are true:

1. A matching project marker, such as `package.json`, `Cargo.toml`, or `go.mod`, exists directly in the directory where you launched omp.
2. The server executable is available in a supported project-local bin directory or on `PATH`.

Project-local executables take precedence. This includes locations such as `node_modules/.bin`, Python virtual-environment bin directories, Ruby binstubs, and a project `bin` directory for Go projects.

Discovery does not walk to parent directories, and wildcard markers only inspect the launch directory. Start omp at the repository or package root that contains the marker.

By default, detected servers are **lazy**: the welcome panel lists them as available, but omp waits until code intelligence or an edit to a matching file needs one before starting it. Servers are shared between omp sessions for the same project when the daemon broker is available; omp falls back to a private server if sharing is unavailable.

In interactive mode, run `/session` to see the detected server names, file types, and startup state:

| State | Meaning |
| --- | --- |
| `available` | Detected and ready to start on first use. |
| `connecting` | Starting eagerly. |
| `ready` | Eager startup completed. |
| `error` | Startup failed; the line includes the failure when one is available. |

## Ask in natural language

Describe the result you want and point omp to a symbol or file when that removes ambiguity. You never need to supply protocol positions or LSP request details.

| Goal | Example request |
| --- | --- |
| Understand a symbol | `Explain the inferred type of result in src/parser.ts and show me its definition.` |
| Find impact | `Find every reference to PaymentGateway.authorize, including implementations, before changing it.` |
| Rename safely | `Rename issueToken to mintToken across the project using code intelligence. Preview first.` |
| Move a module | `Move src/auth/token.ts to src/security/token.ts and update imports through the language server.` |
| Diagnose a file | `Ask the language server why src/server.ts is failing and explain the diagnostics.` |
| Apply a fix | `Use the server's quick fix for the missing import in src/routes.ts, then check diagnostics again.` |
| Inspect a contract | `Find every implementation of StorageAdapter and summarize how they differ.` |

When a name appears more than once on a line, describe the occurrence in words, for example: “the second `parse` call on line 88.” omp resolves the exact source position.

## What you see

Navigation requests return source locations, signatures, types, or documentation that omp can explain in its response. Reference searches give it a project-wide impact list. Diagnostics include the server's severity, message, and location.

For a rename, ask for a preview when you want to inspect the proposed files before anything changes. When applied, omp shows the normal changed-file and diff output. A semantic rename may update many files as one server-computed workspace change; if the server returns no valid rename, omp does not invent semantic edits.

Language servers cannot reliably find dynamic string lookups, prose comments, generated code outside the workspace, or consumers in another package that is not part of the server workspace. After a broad change, ask omp to run the project's compiler and targeted tests as well as checking diagnostics.

## Configure or override a server

No configuration file is needed for a built-in server when its marker and executable are discoverable. First install the server in the project or on `PATH`, then restart omp from the project root.

Use `<project>/.omp/lsp.json` for a project-specific override. For example, built-in definitions are merged by server name, so this changes only the `gopls` settings:

```json
{
  "servers": {
    "gopls": {
      "settings": {
        "gopls": {
          "gofumpt": false,
          "staticcheck": false
        }
      }
    }
  }
}
```

Object-valued fields such as `settings`, `initOptions`, `capabilities`, and `workspaceReadyTimings` replace that whole field; they are not deep-merged. Include every value you want to retain inside the overridden object.

To add a server that omp does not define, provide its command, handled extensions, and project markers:

```yaml
# <project>/.omp/lsp.yaml
servers:
  my-language-server:
    command: my-language-server
    args: ["--stdio"]
    fileTypes: [".xyz"]
    languageId: xyz
    rootMarkers: [".xyz-project"]
```

The command may be a binary name resolved from project-local bins or `PATH`, or an absolute path. A new server missing `command`, `fileTypes`, or `rootMarkers` is ignored with a warning.

To disable one built-in server for a project while leaving the others available:

```json
{
  "servers": {
    "eslint": {
      "disabled": true
    }
  }
}
```

After editing LSP configuration, start a new omp session for the clearest verification. Check the welcome panel or `/session`, then ask:

```text
Confirm which language server handles src/main.ts and check that file for diagnostics.
```

If you install a missing executable during an existing session, ask omp to reload all language servers and reread their configuration.

## Choose where configuration lives

omp reads JSON, YAML, and YML files named `lsp` or `.lsp`. Sources merge from lower to higher precedence:

| Precedence | Locations |
| --- | --- |
| Lowest | `~/lsp.*` and `~/.lsp.*` |
|  | LSP configuration supplied by installed plugins |
|  | User configuration directories, including the active omp agent directory and supported Claude, Codex, and Gemini directories |
|  | Launch-directory configuration directories such as `<cwd>/.omp`, `<cwd>/.claude`, `<cwd>/.codex`, and `<cwd>/.gemini` |
| Highest | `<cwd>/lsp.*` and `<cwd>/.lsp.*` |

For omp-owned configuration, prefer:

- Project: `<project>/.omp/lsp.json`
- User: `~/.omp/agent/lsp.json` for the default profile, or the active profile's agent directory

At one location, precedence is `lsp.json`, `.lsp.json`, `lsp.yaml`, `.lsp.yaml`, `lsp.yml`, then `.lsp.yml`. Server entries merge shallowly by name. Servers not mentioned in an override retain their built-in definitions, and omp still filters the merged set by `disabled`, root markers, and executable availability.

The top-level `servers` wrapper is optional, but do not mix wrapped and flat server entries. These forms are equivalent:

```json
{
  "servers": {
    "eslint": { "disabled": true }
  },
  "idleTimeoutMs": 300000
}
```

```yaml
eslint:
  disabled: true
idleTimeoutMs: 300000
```

An omitted, zero, or negative `idleTimeoutMs` leaves idle shutdown disabled.

## LSP settings

Open `/settings`, then use the **Files → LSP** group to change these interactively. Persistent settings can also go in user `~/.omp/agent/config.yml` or project `.omp/config.yml`; see [Settings](/docs/settings) for profiles and precedence.

| Setting | Default | Effect |
| --- | --- | --- |
| `lsp.enabled` | `true` | Enables symbol intelligence, LSP formatting, and LSP diagnostics. |
| `lsp.lazy` | `true` | Starts a server only when a matching file operation needs it. Set `false` to warm detected servers in the background at interactive startup. |
| `lsp.shared` | `true` | Shares one server per project through the daemon broker, with private-server fallback. |
| `lsp.formatOnWrite` | `false` | Formats matching code after omp writes it. |
| `lsp.diagnosticsOnWrite` | `true` | Returns diagnostics after file writes. |
| `lsp.diagnosticsOnEdit` | `false` | Also returns diagnostics after incremental edits. |
| `lsp.diagnosticsDeduplicate` | `true` | Suppresses diagnostics already shown for a file unless they changed. |

For a one-off session with all LSP-backed behavior disabled, launch:

```sh
omp --no-lsp
```

## Server configuration reference

A partial override of a built-in server may omit inherited fields. A new server needs the three required fields shown below.

| Field | Type | Required for a new server | Purpose |
| --- | --- | --- | --- |
| `command` | string | Yes | Executable name or absolute path. |
| `fileTypes` | string[] | Yes | Extensions handled by the server, including the leading dot. |
| `rootMarkers` | string[] | Yes | Files or directories that identify the launch directory as a matching project; one-level wildcards are supported. |
| `args` | string[] | No | Command-line arguments for the server process. |
| `languageId` | string | No | Language identifier sent for opened files; inferred from the path when omitted. |
| `initOptions` | object | No | Server-specific initialization options. |
| `settings` | object | No | Server-specific workspace settings. |
| `disabled` | boolean | No | Excludes this server when `true`. |
| `warmupTimeoutMs` | number | No | Per-server eager-start timeout in milliseconds. |
| `isLinter` | boolean | No | Marks a diagnostics/formatting-only server so it is not used for type intelligence. |
| `capabilities` | object | No | Enables supported optional integrations: `flycheck`, `ssr`, `expandMacro`, `runnables`, and `relatedTests`. These are currently used for rust-analyzer. |
| `workspaceReadyTimings` | object | No | Advanced rust-analyzer timing overrides: `timeoutMs`, `pollMs`, `settleMs`, and `statusRequestTimeoutMs`. |

## Troubleshooting

### No server appears in the welcome panel or `/session`

- Launch omp from the directory containing the expected root marker; discovery does not search parents.
- Confirm the binary is installed where omp can resolve it. For example, run `command -v rust-analyzer` or inspect the project's local bin directory.
- Check that a custom server has non-empty `command`, `fileTypes`, and `rootMarkers` fields.
- Check the config filename and syntax. Unreadable or invalid JSON/YAML is ignored so other sources can continue loading.
- If several Python or JavaScript servers are installed, disable the ones you do not want so server selection is unambiguous.

### A server is `available`, but nothing has started

This is normal with `lsp.lazy: true`. Ask for a definition, references, rename, or diagnostics on a matching file. Set `lsp.lazy: false` if you prefer background startup when the interactive session opens.

### Startup fails or diagnostics stay empty

Ask omp to report which server it selected, reload it, and show the startup error. Verify the configured command and arguments outside omp. Also confirm that the file extension is in `fileTypes` and that the file belongs to the project described by the server's root marker.

A server marked `isLinter` can provide formatting, diagnostics, and fixes but not definitions, references, or semantic renames. Compiler and test output may also catch workspace or build-system errors that an LSP does not report.

### A rename is refused or misses text

Built-ins, external declarations, generated files, and string-only property names may not be renameable. Ask omp to show references first, then use targeted or structural edits for non-semantic occurrences. Always review the diff and run the relevant compiler or tests after a cross-project rename.
