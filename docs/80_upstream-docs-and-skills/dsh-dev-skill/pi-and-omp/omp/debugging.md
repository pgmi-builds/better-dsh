<!--
source: https://omp.sh/docs/debugging
fetched: 2026-09-06
-->

# Debugging

> Let omp pause a real program, inspect its live state, and explain why it behaves differently from what the source suggests.

## Debug a program with omp

Use the debugger when the answer depends on runtime state: a value changes unexpectedly, a branch is taken only for one input, a process hangs, or several threads interact badly. omp speaks the Debug Adapter Protocol (DAP), so it can launch or attach to a program, stop it, inspect frames and variables, step, and evaluate expressions through a language-specific debug adapter.

The smallest useful workflow is:

1. Install the adapter for the language and make its executable available to omp.
2. Start `omp` in the project directory.
3. Describe the program, the stop point, and the question in normal language.

For example, after installing debugpy with `uv add --dev debugpy`:

```text
Debug etl/transform.py with sample.csv. Break on line 58 when i == 3,
inspect the locals and running total, and explain where the bad value enters.
```

omp selects debugpy from the `.py` target and Python project markers, launches the script, and drives the stopped process. You do not need to translate the request into DAP operations or manage frame identifiers yourself.

For questions that only require reading definitions, references, or types, use [code intelligence](/docs/code-intelligence) instead. Debugging executes or attaches to real code and can change the target's state.

## What works automatically

Debugger support is enabled by default. Confirm the setting from a shell with:

```sh
omp config get debug.enabled
```

For a launch, omp considers only installed adapters, then ranks them using the target's file extension and nearby project markers such as `pyproject.toml`, `go.mod`, `Cargo.toml`, `package.json`, and `CMakeLists.txt`. For an extensionless native executable it prefers GDB, then LLDB. An adapter named in your request overrides automatic selection.

Most built-in launch configurations stop at program entry. That gives omp a chance to install the breakpoints you requested before it resumes execution. Go is also able to use a package directory as the target; other adapters normally require a file or executable path.

Attaching is less self-describing than launching. Include the adapter when there could be ambiguity, along with either a process ID or the host and port exposed by the target.

## Install an adapter

Install at least one adapter appropriate for the target. omp includes configuration for the following common choices; the adapter itself is a separate program.

| Target | Built-in adapter name | What omp expects |
| --- | --- | --- |
| C, C++, Rust | `gdb` | A GDB build with DAP support, available as `gdb` |
| C, C++, Objective-C, Swift, Rust, Zig | `lldb-dap` | `lldb-dap` on `PATH` |
| C, C++, Rust, Zig | `codelldb` | `codelldb` on `PATH` |
| Python | `debugpy` | `python` on `PATH` and `uv add --dev debugpy` in that interpreter |
| Go | `dlv` | `go install github.com/go-delve/delve/cmd/dlv@latest` and `$GOBIN` (or `~/go/bin`) on `PATH` |
| Ruby | `rdbg` | `gem install debug` and `rdbg` on `PATH` |
| JavaScript and TypeScript on Node | `js-debug-adapter` | vscode-js-debug's `dapDebugServer.js`; see below |
| .NET | `netcoredbg` | `netcoredbg` on `PATH` |
| Kotlin | `kotlin-debug-adapter` | `kotlin-debug-adapter` on `PATH` |
| PHP | `php-debug-adapter` | `php-debug-adapter` on `PATH` |
| Bash | `bash-debug-adapter` | `bash-debug-adapter`, `bash`, and `bashdb` on `PATH` |
| Dart / Flutter | `dart-debug-adapter` / `flutter-debug-adapter` | The Dart SDK's `dart debug_adapter` command |
| Elixir | `elixir-ls-debugger` | `elixir-ls-debugger` on `PATH` |

Installation is platform-specific for adapters without a command in the table. After installing one, verify that the process which starts omp can resolve it, for example:

```sh
command -v dlv
command -v lldb-dap
```

### JavaScript and TypeScript

`js-debug-adapter` is omp's adapter name, **not an npm package**. Do not run `npm install -g js-debug-adapter`.

Download a `js-debug-dap-*.tar.gz` archive from the [vscode-js-debug releases](https://github.com/microsoft/vscode-js-debug/releases) and extract it so the server is located here:

```text
~/.local/opt/js-debug/src/dapDebugServer.js
```

That path is discovered automatically. A Neovim Mason installation is also discovered at `$XDG_DATA_HOME/nvim/mason/packages/js-debug-adapter/js-debug/src/dapDebugServer.js` (normally under `~/.local/share`). For any other location, export the path before starting omp:

```sh
export JS_DEBUG_DAP_SERVER=/absolute/path/to/js-debug/src/dapDebugServer.js
omp
```

omp runs the server with `node` when available and otherwise uses its Bun host.

## Configure an adapter

You usually do not need a DAP config file. Add one when an adapter is installed outside `PATH`, its built-in defaults do not match the project, or you are adding an adapter that omp does not know yet.

Use `.omp/dap.json` for project-specific configuration or `~/.omp/agent/dap.json` for a personal default. A `dap.json` in the directory where omp starts has higher precedence than `.omp/dap.json`. The equivalent `.dap.json`, `dap.yaml`, `.dap.yaml`, `dap.yml`, and `.dap.yml` names are also accepted. Adapter maps from all applicable files are merged; workspace files override user and plugin defaults.

### Override a built-in adapter

Overrides are merged with the built-in entry, so only specify what changes. This project-level file makes omp use the project's Python environment while preserving debugpy's file extensions and root markers:

```json
{
  "adapters": {
    "debugpy": {
      "command": ".venv/bin/python",
      "launchDefaults": {
        "justMyCode": true,
        "stopOnEntry": true
      }
    }
  }
}
```

Relative commands such as `.venv/bin/python` are resolved from the debug working directory. On Windows, use the interpreter path appropriate to the environment.

### Add a custom adapter

A custom adapter needs a command and enough matching information for automatic selection:

```json
{
  "adapters": {
    "acme-jvm": {
      "command": "./tools/acme-debug-adapter",
      "args": ["--stdio"],
      "languages": ["java", "kotlin"],
      "fileTypes": [".java", ".kt", ".kts"],
      "rootMarkers": ["pom.xml", "build.gradle", "build.gradle.kts"],
      "launchDefaults": {
        "request": "launch",
        "stopOnEntry": true,
        "projectRoot": "."
      },
      "attachDefaults": {
        "request": "attach",
        "host": "127.0.0.1"
      }
    }
  }
}
```

`launchDefaults` and `attachDefaults` are adapter-specific DAP arguments. They are the right place for settings that cannot be inferred from a prompt, such as a JVM main class, source maps, `justMyCode`, or an adapter-specific attach mode. At runtime, the program path, working directory, program arguments, PID, host, and port from your request take precedence over these defaults.

## Ask omp to launch or attach

Give omp concrete paths and describe the evidence you want. A launch target is a path, not a shell command; ask omp to build the target first if necessary.

```text
Launch build/server with --config test/fixtures/dev.toml. Stop in parseConfig,
then show me the arguments and the first caller that supplied an empty path.
```

```text
Debug the Go package in ./cmd/worker. Break when retryCount reaches 5 and
compare the current job with the previous stack frame.
```

```text
Use lldb-dap to launch ./build/repro with arguments --seed 417. Stop at main,
then continue until decode_packet and inspect the packet header.
```

To attach to a local process, include its PID:

```text
Attach lldb-dap to PID 48120. Pause it, show all threads, and identify which
thread is holding the process in shutdown.
```

For a debug server, include both endpoint and adapter:

```text
Use debugpy to attach to 127.0.0.1:5678. When the request handler is reached,
inspect request.user and explain why authorization fails.
```

Only one root debug session can be active in an omp session. Ask omp to end the current debug session before launching or attaching to a different target.

## What you see while stopped

Debug activity appears in the transcript as `Debug` blocks. After a successful launch or attach, the block identifies the selected adapter, status, working directory, and program. When execution stops, it also shows the stop reason, current frame, and source location, for example:

```text
Adapter: debugpy
Status: stopped
Stop reason: breakpoint
Frame: transform_row
Location: /workspace/etl/transform.py:58:9
```

omp can then inspect the stack, threads, scopes, locals, nested values, target output, and supported expressions before it steps or continues. If the target does not stop within the request timeout, the transcript says that it is still running; this is not reported as a crash. Ask omp to pause it, or set a reachable breakpoint and continue.

A stopped process is genuinely paused. It may stop serving requests or holding locks until continued or terminated. Expression evaluation can also call code or mutate state in some adapters, so say “inspect without evaluating expressions” when that distinction matters.

## Troubleshooting

### Debugging is unavailable

Check the feature gate and enable it if necessary:

```sh
omp config get debug.enabled
omp config set debug.enabled true
```

Start a new omp session after changing which tools are enabled.

### omp says the adapter is unavailable

Verify the executable from the same shell that starts omp. If it is installed elsewhere, either update `PATH` before starting omp or set an absolute `command` in `dap.json`. For debugpy, `python` may exist even when the module does not; verify with:

```sh
python -m debugpy --version
```

For JavaScript, verify `JS_DEBUG_DAP_SERVER` or one of the automatic `dapDebugServer.js` locations rather than looking for a `js-debug-adapter` executable.

### The wrong adapter is selected

Name the adapter in the request. For a durable fix, correct its `fileTypes` and `rootMarkers` in the project DAP config. File extensions should include the leading dot and are matched lowercase.

### The target path is rejected

Pass a source file or executable path, not a command plus flags in one string. Put program arguments in the request separately. Directory targets require an adapter with `acceptsDirectoryProgram: true`; the built-in Delve configuration enables this for Go packages.

### A breakpoint is pending or never hit

Check that the source path and line belong to the code actually loaded by the target. Rebuild compiled code with debug symbols, disable optimizations if stepping is misleading, and verify source-map settings for generated JavaScript. A conditional expression must use the target language and be supported by that adapter.

### Attach fails

Confirm the PID is still alive or the host and port are reachable. Then name the intended adapter explicitly. Some adapters require additional fields such as a process selector or mode; put those adapter-specific values in `attachDefaults`.

### omp reports another active session

Ask it to terminate the existing debug session, then retry. A launch or attach failure is cleaned up automatically, but a running or stopped session remains active until the debugging work ends.

## DAP adapter configuration reference

| Field | Required | Meaning |
| --- | --- | --- |
| `command` | Yes | Executable name or path. Relative paths resolve from the debug working directory. |
| `args` | No | Arguments passed to the adapter process, not to the program being debugged. |
| `languages` | No | Language metadata associated with the adapter. |
| `fileTypes` | No | Lowercase extensions, including the leading dot, used for launch selection. |
| `rootMarkers` | No | Files or directories used to recognize and rank matching projects. |
| `launchDefaults` | No | Adapter-specific arguments merged into every launch before the requested program, working directory, and program arguments. |
| `attachDefaults` | No | Adapter-specific arguments merged into every attach before the requested PID, host, and port. `skipAttachRequest: true` is available for an adapter that is already attached when its process starts. |
| `connectMode` | No | `stdio` by default; `socket` for Delve-style adapters; or `tcp` for a local DAP server. In `tcp` mode, `${port}` in `args` is replaced with the allocated port. |
| `acceptsDirectoryProgram` | No | Set to `true` when the adapter can launch a package or project directory instead of a file. |

The outer `adapters` object is optional: a config file may instead contain the adapter map directly. Invalid new entries without a usable `command` are ignored; an invalid partial override does not erase the built-in adapter it was meant to change.
