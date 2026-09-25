<!--
source: https://omp.sh/docs/acp
fetched: 2026-09-06
-->

# ACP

> Run the full omp agent inside an ACP-capable editor, with editor-aware files, terminals, session controls, and permission prompts.

## Use omp from your editor

[Agent Client Protocol (ACP)](https://agentclientprotocol.com) lets an editor host an omp conversation without embedding omp or adding an editor-specific plugin. Use it when you want to review changes, terminals, approvals, and session history beside your code while omp keeps its own models, credentials, settings, extensions, and skills.

The editor starts omp as a child process. You do not run the ACP server in a separate terminal or connect it to a port.

First, confirm that `omp` is available in the environment your editor will use:

```sh
command -v omp
omp --version
```

Then configure the ACP client with these launch values:

| Field | Value |
| --- | --- |
| Command | `omp` |
| Arguments | `acp` |
| Transport | stdio |
| Session directory | The absolute path of the open project or workspace |

`omp --mode acp` is equivalent, but `omp acp` is the recommended spelling for client configuration.

## Connect Zed

In Zed, run **agent: open settings**, open **External Agents**, choose **Add Agent → Add Custom Agent**, and add:

```json
{
  "agent_servers": {
    "Oh My Pi": {
      "type": "custom",
      "command": "omp",
      "args": ["acp"]
    }
  }
}
```

Start a new thread from the Agent Panel and select **Oh My Pi**. Zed owns the thread UI; omp owns the agent, provider connection, and model settings.

If a GUI-launched Zed cannot find `omp`, replace `"omp"` with the absolute path printed by `command -v omp`. The same rule applies to other clients whose environment does not inherit your shell `PATH`.

For another ACP client, create the equivalent custom-agent entry: spawn `omp` with the single argument `acp`, keep stdin and stdout connected to the ACP transport, and supply the workspace's absolute path when creating the session. Do not parse terminal UI output or launch `omp` without `acp`.

## Authenticate and start a thread

omp advertises **Use existing local credentials** to every ACP client. Those are the provider keys and OAuth sessions already available to omp; credentials configured only for your editor's built-in agent are not automatically shared.

If the client offers **Set up Oh My Pi in terminal**, choose it to open omp's interactive provider setup. Otherwise:

1. Run `omp` in a terminal.
2. Enter `/login` or `/login <provider>` and finish authentication.
3. Start a fresh ACP thread in the editor.

See [Providers](/docs/providers) for credential sources and precedence. After connection, use the editor's session controls to select an available **Model** and **Thinking** level. The model list reflects what omp can use with its current credentials and configuration.

Now prompt normally, for example:

```text
Rename issueToken to mintToken across this project, update every caller, and run the focused tests.
```

The response streams into the editor. In a capable client, omp reads through the editor's filesystem bridge, writes through the editor, and runs shell commands in client-side terminals. This keeps reads aligned with open buffers and lets the editor show touched locations and command output. If a client does not provide one of those ACP capabilities, omp falls back to the workspace filesystem or its local command runner for that capability.

## Session controls

An ACP thread is a normal persistent omp session. Depending on the client UI, you can reopen, resume, fork, or close sessions and see their stored title and working directory.

The standard session controls are:

- **Mode** — Default or Plan. Plan is available when `plan.enabled` is true, which is the default.
- **Model** — any model currently available to omp.
- **Thinking** — Off, Auto, or a level supported by the selected model.

Choose **Plan** from the client's mode control when you want read-only investigation before edits. omp presents the finished plan for approval; dismissing or declining that prompt never grants write access. `/plan` is a TUI-only command and is not the way to enter plan mode over ACP. See [Plan mode](/docs/plan) for the workflow.

Text-capable slash commands are advertised in the client's command menu. TUI-only commands such as `/login` and `/quit` are intentionally absent: authentication and process lifetime belong to the ACP host.

## Permissions

ACP adds an editor-side safety gate before:

- shell commands;
- file deletion;
- file moves or renames, including destructive operations contained in a larger edit.

The client can offer **Allow once**, **Always allow**, **Reject**, and **Always reject**. An “always” choice is cached only for the current session and for that operation category; it is not a permanent global setting. Ordinary reads and non-destructive file writes do not trigger this ACP-specific gate, though your normal omp approval settings still apply.

A rejected, cancelled, or unsupported permission request fails closed. omp does not silently execute the operation.

For a trusted unattended workspace, make the choice explicit in the client launch arguments:

```json
{
  "command": "omp",
  "args": ["acp", "--approval-mode", "yolo"]
}
```

This skips omp and client permission prompts unless a per-tool policy is explicitly set to `prompt` or `deny`. Prefer the default prompted setup for interactive editor use. See [Settings](/docs/settings) for persistent `tools.approvalMode` and per-tool policies.

## MCP and editor capabilities

In ACP mode, the client owns MCP server configuration. omp accepts stdio, HTTP, and SSE MCP servers passed by the client when a session starts; it intentionally does not auto-discover omp's on-disk MCP configuration for that session. Configure a missing MCP server in the editor or ACP host, then start or reload the thread.

omp also supports text, images, and embedded context supplied by the client. Whether your editor exposes attachments, session import, forks, Plan mode, terminals, or unsaved-buffer reads depends on the ACP capabilities and UI it implements.

## Troubleshooting

### `omp acp` appears to hang

That is expected when you run it by hand: the process is waiting for ACP messages on stdin, and stdout is reserved for the protocol. Configure the editor to spawn it instead. Startup and transport diagnostics go to stderr, and omp logs are under `~/.omp/logs/`.

In Zed, run **dev: open acp logs** to inspect the client side of the connection.

### The editor reports `command not found`

Run `command -v omp` in a terminal and use that absolute path as the custom agent's command. GUI applications often receive a smaller `PATH` than interactive shells. If the project is remote, install and authenticate omp in the environment where the ACP process actually runs.

### The thread connects but no model works

Open the terminal setup offered by the client, or run `omp` and `/login <provider>` outside the editor. Then create a new thread. Also check that provider credentials or environment variables are visible to the editor process; editor-native model credentials do not automatically configure omp.

### Unsaved changes are missing or terminals open outside the editor

The client may not advertise ACP filesystem or terminal support. Update or reconfigure the client. Without filesystem bridging, save buffers before asking omp to inspect them; without terminal bridging, commands use omp's local runner.

### A permission prompt never completes

The ACP client must render and answer permission requests. Cancelling the dialog or using a client that cannot answer rejects the operation. Use a current client, or deliberately configure an approval policy rather than assuming approval.

### MCP tools are missing

Configure the MCP server in the ACP client, not only in omp's local MCP files. Start a new thread so the client can pass the server configuration during session creation.

## For ACP client implementers

`omp acp` speaks ACP JSON-RPC over newline-delimited stdio. Keep stdout exclusively connected to the protocol and read diagnostics from stderr. A client can integrate progressively: basic prompting works first, while filesystem access, terminals, permission dialogs, images, embedded context, MCP servers, session history, mode selection, model selection, and thinking controls appear when the client implements the corresponding public ACP capabilities.

The process advertises session creation plus list, load, resume, fork, and close support. Use the official [ACP specification](https://agentclientprotocol.com) for message schemas; omp does not require clients to understand its internal tools or private bridge payloads.
