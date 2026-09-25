<!--
source: https://omp.sh/docs/mcp
fetched: 2026-09-06
-->

# MCP

> Connect omp to external services and local programs through Model Context Protocol servers.

## Connect your first server

Use MCP when a service or tool already publishes an MCP server and you want omp to work with it—for example, to search an issue tracker, query a database, or use a filesystem outside the current project. You configure the server once, then ask for the work in ordinary language.

The quickest route is the guided setup inside omp:

```text
/mcp add
```

Choose **Project** when everyone working in this repository should discover the server, or **User** when it is only for you. After setup, verify it immediately:

```text
/mcp test filesystem
```

A successful test shows the server name and version, its tool count, and up to ten tool names. You can then ask, for example:

> Use the filesystem MCP server to summarize the Markdown files in my Documents folder.

You do not need to address MCP tools by their internal names.

## Minimal configuration

For a local server, create `.omp/mcp.json` in the project. This example starts the official filesystem server and grants it access only to one directory:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/alice/Documents"
      ]
    }
  }
}
```

Replace the path with an absolute directory on your machine. `stdio` is the default transport when `type` is omitted.

If you edit the file while omp is running, apply and verify the change with:

```text
/mcp reload
/mcp list
/mcp test filesystem
```

`/mcp list` groups servers by source and shows whether each one is connected, connecting, inactive, disabled, or not connected.

## Where omp looks

You often do not need to copy an existing MCP setup. omp automatically imports supported server definitions from Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Windsurf, VS Code, installed plugins, and extension packages. Run `/mcp list` to see what was found and which file supplied it.

For configuration owned by omp, prefer:

| Scope | File | Use it for |
| --- | --- | --- |
| Project | `.omp/mcp.json` | A server definition shared by this repository |
| User | `~/.omp/agent/mcp.json` | Your personal servers in the default profile |
| Named profile | `~/.omp/profiles/<name>/agent/mcp.json` | Servers isolated to `omp --profile <name>` |
| Portable fallback | `mcp.json` or `.mcp.json` at the project root | A lowest-priority file shared with other MCP clients |

Project MCP discovery is enabled by default. The first definition found for a duplicate server wins; definitions are not merged. `/mcp add`, `/mcp enable`, `/mcp disable`, and OAuth commands write only omp-managed files, not another application's config.

## Transports

Choose the transport published by the server. A URL ending in `/sse` does not by itself select SSE; set `type` explicitly for every remote server.

| Transport | Required fields | When to use it |
| --- | --- | --- |
| `stdio` | `command`; optional `args`, `env`, `cwd` | A local executable. `type` may be omitted. |
| `http` | `type: "http"`, `url`; optional `headers` | A hosted Streamable HTTP server. Use this for new remote integrations. |
| `sse` | `type: "sse"`, `url`; optional `headers` | A legacy HTTP+SSE server that specifically requires the older transport. |

A minimal Streamable HTTP entry looks like this:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "acme": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

A server cannot have both `command` and `url`.

## Authentication and secrets

### Bearer tokens and API keys

Put credentials for a local process in `env`, or credentials for HTTP/SSE in `headers`. Reference an environment variable instead of committing the secret:

```json
{
  "mcpServers": {
    "acme": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${ACME_TOKEN}"
      }
    }
  }
}
```

omp expands `${VAR}` and `${VAR:-default}` in server configuration when it loads the file. In `env` and `headers`, a whole value that names an environment variable also resolves from the process environment. A value beginning with `!` runs the remaining shell command and uses its trimmed output; use that only with a command you trust.

Although `auth.type: "apikey"` is accepted by the schema, it does not fetch and inject an API key. Use `env` or `headers` for API keys.

### OAuth

For an HTTP or SSE server that supports OAuth, leave the token out and run:

```text
/mcp reauth acme
```

omp opens the authorization flow and stores the credential in the active profile's auth storage (`agent.db`, or the configured auth broker), not in `mcp.json`. Use `/mcp unauth acme` to remove it. If the provider requires a registered client, add only the settings it requires:

```json
{
  "mcpServers": {
    "acme": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "${ACME_CLIENT_ID}",
        "clientSecret": "${ACME_CLIENT_SECRET}"
      }
    }
  }
}
```

OAuth credentials are bound to the active profile and server URL. The same profile may reuse that credential for the same URL in another checkout. An explicit `Authorization` header takes precedence over managed OAuth, so remove a stale header before reauthorizing.

## Inspect and control servers

| Command | What you see or change |
| --- | --- |
| `/mcp list` | Configured and discovered servers, source files, transports, and connection states |
| `/mcp test <name>` | A temporary connection test, server version, tool count, and up to ten upstream tool names; press Esc to cancel |
| `/mcp reload` | Rediscover config files and rebuild the current session's MCP connections and tools |
| `/mcp reconnect <name>` | Reconnect one known server without rediscovering every config file |
| `/mcp enable <name>` | Enable a server; for imported config, create a user-level override |
| `/mcp disable <name>` | Disable a server by name, including one imported from another tool |
| `/mcp reauth <name>` | Replace the active profile's managed OAuth credential |
| `/mcp unauth <name>` | Remove that managed OAuth credential |
| `/mcp resources` | List resources and resource templates exposed by connected servers |
| `/mcp prompts` | List prompts exposed by connected servers and their slash-command names |
| `/mcp notifications` | Show notification support, subscriptions, and whether update injection is enabled |
| `/mcp remove <name> [--scope project\|user]` | Delete an omp-managed definition; project is the default scope |
| `/mcp help` | Show the current command reference |

`/tools` shows every tool currently visible to omp. MCP tool names appear as `mcp__<server>_<tool>` after names are lowercased and normalized to underscores. omp may remove a repeated server prefix or shorten a very long name. These names help you identify where a capability came from; continue requesting work in natural language.

Connected servers may also publish prompts, resources, and notifications. `/mcp prompts` shows callable prompt commands in the form `/server:prompt`. Resource updates enter the conversation only when `mcp.notifications` is enabled; the default is off.

## Safety

Treat every MCP definition as executable, trusted configuration:

- A `stdio` server runs its configured command with your user permissions. Review project MCP files before opening an unfamiliar repository.
- Grant the smallest useful filesystem roots, OAuth scopes, database permissions, and API permissions.
- A remote server receives the arguments and data needed for each requested operation. Use only endpoints and server packages you trust.
- Never commit tokens or client secrets. Prefer environment variables, a trusted secret command, or managed OAuth.
- Because OAuth is profile-scoped by URL, an untrusted checkout defining the same URL can use that profile's stored credential. Use a separate profile for untrusted projects.
- Disable an unwanted discovered server with `/mcp disable <name>` rather than editing another application's config.

## Troubleshooting

### The server is missing from `/mcp list`

Check that the JSON parses and contains a top-level `mcpServers` object, then run `/mcp reload`. A user-level `disabledServers` entry may hide the server. Project sources are also skipped when `mcp.enableProjectConfig` is false. If the name exists in several sources, the higher-priority definition wins.

### A remote server says `stdio server requires "command"`

Add `"type": "http"` (or `"sse"` for a legacy server). Without `type`, omp assumes `stdio`.

### A local server will not connect

Run `/mcp test <name>` and check that the executable is installed, `cwd` exists, arguments are correct, and required environment variables are available to the process that launched omp. A stdio server must reserve stdout for MCP protocol messages; send diagnostic logs to stderr.

### The server returns 401 or 403

For managed OAuth, run `/mcp reauth <name>`. If needed, use `/mcp unauth <name>` first. For header authentication, confirm the environment variable is set and remove any stale explicit `Authorization` header that would override OAuth.

### The connection times out

Set a larger per-server `timeout` in milliseconds, then reload. The default is 30 seconds; `0` disables client-side MCP timeouts. `OMP_MCP_TIMEOUT_MS` overrides every per-server timeout for the process.

```json
{
  "mcpServers": {
    "slow-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "timeout": 120000
    }
  }
}
```

Use `/mcp reconnect <name>` for a transient failure. Use `/mcp reload` after changing files or when discovery itself is wrong.

## Server field reference

| Field | Applies to | Meaning |
| --- | --- | --- |
| `enabled` | All | Connect unless `false`; user enable/disable overrides can supersede imported definitions |
| `timeout` | All | Request timeout in milliseconds; `0` disables it |
| `requestIdFormat` | All | `"number"` by default; use `"string"` only for a server that requires string JSON-RPC IDs |
| `command` | stdio | Executable to start |
| `args` | stdio | Argument array passed without shell parsing |
| `env` | stdio | Environment variables passed to the process |
| `cwd` | stdio | Working directory for the process |
| `url` | http, sse | Remote MCP endpoint |
| `headers` | http, sse | Request headers, including token authentication |
| `oauth` | http, sse | Optional `clientId`, `clientSecret`, `redirectUri`, `callbackPort`, `callbackPath`, and `prompt` settings for authorization |
| `auth` | All | Advanced stored-credential metadata; normally generated/resolved by managed OAuth rather than written by hand |

User config may also contain `disabledServers` and `enabledServers` arrays. The denylist has highest precedence.

These related settings live in `~/.omp/agent/config.yml` (or the active profile's config):

```yaml
mcp:
  enableProjectConfig: true
  renderMarkdownResults: true
  notifications: false
  notificationDebounceMs: 500
```

Those are the defaults. `notificationDebounceMs` controls how long resource updates are grouped before they enter the conversation.

## Related

- [Custom tools](/docs/custom-tools) — write a small native tool when no suitable MCP server exists.
- [MCP server authoring](/docs/mcp-authoring) — build and package a server of your own.
- [Settings](/docs/settings) — configure project discovery, notifications, and result rendering.
- [Plugins](/docs/plugins) — distribute MCP definitions with other omp extensions.
