<!--
source: https://omp.sh/docs/mcp-authoring
fetched: 2026-09-06
-->

# Authoring MCP servers

> Build a standards-based tool server, connect it to omp, and verify the handshake and tool calls end to end.

## Build once, use it from many clients

An MCP server turns an API, local service, or workflow into tools that omp can discover and use. Choose MCP when the integration should also work with other MCP clients. For an omp-only integration, a [custom tool](/docs/custom-tools) is usually smaller.

The quickest path is a local **stdio** server. The official SDK handles JSON-RPC framing, version negotiation, and the initialization sequence, so your code can focus on tool schemas and behavior.

## Build a minimal stdio server

Install the current TypeScript server SDK and Zod in your project:

```bash
npm install @modelcontextprotocol/server zod
```

Save this as `mcp/hello-server.mjs`:

```js
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({
  name: "hello",
  version: "1.0.0",
});

server.registerTool(
  "greet",
  {
    description: "Greet one person by name.",
    inputSchema: z.object({
      name: z.string().min(1).describe("The person's name"),
    }),
  },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}!` }],
  }),
);

await server.connect(new StdioServerTransport());
```

Do not print logs to stdout in a stdio server. stdout carries newline-delimited MCP messages; one debug line can corrupt the connection. Write diagnostics to stderr instead.

### Connect it to omp

Add a project config at `.omp/mcp.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  "mcpServers": {
    "hello": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/hello-server.mjs"]
    }
  }
}
```

Start omp in that project, then run:

```text
/mcp reload
/mcp test hello
```

`/mcp test hello` creates a temporary connection, completes initialization, calls `tools/list`, and reports the server identity and discovered tool names. It does **not** call a tool. Exercise the handler with a normal request:

> Use the hello server to greet Ada.

You should see `Hello, Ada!`. The child process starts in the omp project directory unless the server config sets `cwd`, so relative `args` above resolve from the project root.

## Choose a transport

| Transport | Use it for | Server-side contract | omp config |
| --- | --- | --- | --- |
| **stdio** | A local server launched for one omp session | Read JSON-RPC from stdin, write newline-delimited JSON-RPC to stdout, and keep diagnostics off stdout | Omit `type` or use `"type": "stdio"`; set `command`, with optional `args`, `env`, and `cwd` |
| **Streamable HTTP** | A daemon or hosted, shared service | Accept MCP JSON-RPC over HTTP POST; support JSON or SSE responses as required by the MCP transport spec | Use `"type": "http"` and `url`; `headers` and OAuth are optional |
| **Legacy HTTP+SSE** | An existing server built for the 2024-11-05 transport | Open an SSE stream that announces the JSON-RPC POST endpoint | Use `"type": "sse"` and `url`; do not choose this for a new server |

stdio is the default when `type` is absent. A remote entry without `"type": "http"` is therefore treated as stdio and fails because it has no `command`.

### Publish the same tool over Streamable HTTP

The current SDK can serve both current and 2025-era clients. For a small Node-hosted endpoint, install its Node adapter:

```bash
npm install @modelcontextprotocol/node
```

A minimal loopback server looks like this:

```js
import { createServer } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "hello-http", version: "1.0.0" });
  server.registerTool(
    "greet",
    {
      description: "Greet one person by name.",
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );
  return server;
});

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

createServer((request, response) => {
  if (!validateHost(request, response) || !validateOrigin(request, response)) return;
  void nodeHandler(request, response);
}).listen(3000, "127.0.0.1");
```

Configure the running endpoint:

```json
{
  "mcpServers": {
    "hello-http": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

For a public deployment, validate `Host` and `Origin`, authenticate before dispatching to the MCP handler, use TLS, and pass only verified identity to tool code. The handler does not authenticate requests for you. See the SDK's [HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html) and [MCP](/docs/mcp) for omp header and OAuth configuration.

## Public protocol contract

Using an MCP SDK is strongly recommended. If you implement the wire protocol yourself, these are the interoperability points omp relies on:

| Phase | What the server must do |
| --- | --- |
| `initialize` | Accept a JSON-RPC 2.0 request. omp currently offers MCP protocol revision `2025-11-25`. Reply with the negotiated `protocolVersion`, `serverInfo`, and `capabilities`. |
| `notifications/initialized` | Accept the notification before expecting later session traffic. Notifications have no request ID and receive no response. |
| `tools/list` | When `capabilities.tools` is declared, return `{ "tools": [...] }`. If the result has `nextCursor`, omp follows it until all pages are loaded. |
| `tools/call` | Accept `{ "name": string, "arguments"?: object }` and return a tool result. Echo each JSON-RPC request ID exactly; valid IDs may be numbers or strings. |
| Server requests | omp answers `ping` and `roots/list`. `roots/list` returns the active project as a `file:` URI. Do not assume a client supports other server-to-client methods unless it advertised them. |
| Tool changes | If tools can change, advertise `tools.listChanged` and send `notifications/tools/list_changed` after initialization. omp then reloads that server's tool list without a session restart. |

For Streamable HTTP, preserve `Mcp-Session-Id` when you issue one and accept `MCP-Protocol-Version: 2025-11-25` on requests after initialization. Support the HTTP methods, status codes, media types, and optional SSE channel defined by the public MCP transport specification. The official SDK handles these details.

omp sends numeric JSON-RPC request IDs by default. A server should accept both JSON-RPC-permitted forms; requiring one representation reduces compatibility with other clients.

## Define tools that travel well

A listed tool needs a stable `name`, a concrete `description`, and an `inputSchema` whose top level is a JSON Schema object. With the SDK above, a Standard Schema library such as Zod produces that schema for you.

Good schemas help the client select the tool and construct valid arguments:

- Describe the user-visible action and when it is appropriate.
- Use explicit property descriptions, bounds, enums, and `required` fields.
- Keep optional fields genuinely optional; do not require clients to send empty placeholders.
- Validate permissions and inputs again in the handler. A schema is guidance and validation, not authorization.
- Keep names stable once users depend on them.

omp namespaces discovered tools by server, lowercases their names, replaces characters outside `[a-z_]` with underscores, and caps the mounted name at 64 characters with a stable hash suffix when needed. Distinct raw names that normalize identically collide; omp keeps one deterministic winner. Prefer short, distinct lowercase names such as `search_issues` or `create_invoice`. Users ask for the capability in natural language rather than typing the mounted name.

## Return results and errors

Every successful call should return `content`. Text is the most portable content type:

```js
return {
  content: [{ type: "text", text: "Created invoice INV-1042." }],
};
```

omp also accepts MCP image content (`data` as base64 plus `mimeType`) and embedded resource content. If you also return `structuredContent`, include a useful text representation in `content`; do not make the human-readable result depend on structured output support.

Use `isError: true` for an expected, user-correctable failure. This keeps the failure attached to the tool call and gives the model information it can act on:

```js
return {
  content: [{ type: "text", text: "Customer C-17 does not exist." }],
  isError: true,
};
```

Reserve thrown exceptions or JSON-RPC error responses for protocol violations, unavailable dependencies, and unexpected server faults. omp displays expected `isError` results as tool errors; transport and JSON-RPC failures surface as MCP errors. Do not include secrets, tokens, or private stack traces in either form.

For protected HTTP tools, a standards-based authorization challenge may be returned with an error in `_meta["mcp/www_authenticate"]`. omp recognizes that public MCP challenge and can reauthorize before retrying when the server is configured for OAuth.

## Debugging loop

1. 
2. 
3. 
4. 
5. 

| Symptom | Check |
| --- | --- |
| `ENOENT` or command not found | Verify `command`, the project-relative path, executable permissions, and `cwd`. |
| Test hangs or times out | Ensure the server answers `initialize`, then accepts `notifications/initialized` and `tools/list`. The default request timeout is 30 seconds; fix the stall before increasing `timeout`. |
| Invalid JSON or immediate disconnect | Remove every stdout log/banner. Check that each stdio frame is one complete JSON-RPC object followed by a newline. |
| Test connects but a real call fails | `/mcp test` does not call tools. Reproduce with the Inspector and return an actionable `isError` result for domain failures. |
| Tool changes do not appear | Reconnect a restarted stdio process, or advertise `tools.listChanged` and send `notifications/tools/list_changed`. |
| HTTP 401 or 403 | Verify server-side token validation and the client's header/OAuth config; use `/mcp reauth <name>` for managed OAuth. |
| Tool is missing although the server lists it | Look for a normalized-name collision, an invalid top-level input schema, or another server definition shadowing the same name. |

## Ship checklist

- The server negotiates `2025-11-25` with omp and does not send session traffic before initialization completes.
- stdio stdout contains protocol frames only; hosted HTTP has TLS, authentication, and Host/Origin validation.
- `tools/list` returns stable names, descriptions, object input schemas, and every pagination cursor correctly.
- Every `tools/call` path returns useful `content`; expected failures return `isError: true`.
- The Inspector can list and call each tool, and `/mcp test <name>` reports the same inventory.
- A natural-language request in omp exercises the real handler successfully.

## Related

- [MCP](/docs/mcp) — config locations, discovery, transports, credentials, and lifecycle commands.
- [Custom tools](/docs/custom-tools) — omp-only alternative when cross-client compatibility is unnecessary.
- [Plugins](/docs/plugins) — package MCP config with skills, commands, and hooks.
- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25) — public protocol and transport contract.
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/) — current server APIs and examples.
