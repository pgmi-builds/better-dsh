<!--
source: https://omp.sh/docs/sdk
fetched: 2026-09-06
-->

# SDK

> Embed omp in a Bun application with direct access to sessions, events, configuration, and host-owned tools.

## Embed omp in your application

Use the SDK when your host is written in TypeScript or JavaScript, runs on Bun, and should share a process with omp. You get the same agent core as the CLI, but your application owns the prompt lifecycle, receives streaming events, and can expose ordinary functions as agent tools.

For a different language, process isolation, or a stable JSON boundary, choose [RPC mode](/docs/rpc) instead.

### 1. Install the package

```sh
bun add @oh-my-pi/pi-coding-agent
```

The SDK requires **Bun 1.3.14 or newer**. It is not a Node.js SDK.

Before sending a model-backed prompt, authenticate a provider. The quickest path is to run `omp`, enter `/login`, and complete the provider flow. Provider API-key environment variables also work; see [Providers](/docs/providers).

### 2. Run one session

Create `embed.ts`:

```ts
import { createAgentSession } from "@oh-my-pi/pi-coding-agent";

const { session, modelFallbackMessage } = await createAgentSession({
  cwd: process.cwd(),
});

if (modelFallbackMessage) {
  process.stderr.write(`${modelFallbackMessage}\n`);
}

const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await session.prompt("Summarize this repository in three bullets.");
  process.stdout.write("\n");
} finally {
  unsubscribe();
  await session.dispose();
}
```

Run it from the project omp should work on:

```sh
bun run embed.ts
```

The text arrives incrementally through `message_update` events. Tool execution, history updates, retries, and compaction remain part of the session lifecycle; `prompt()` completes after the submitted turn settles. By default, the session uses the current project and persists history just like the CLI.

## Defaults and configuration

`createAgentSession()` follows an “omit to discover, provide to override” model. With no options it discovers your omp credentials, settings, model, extensions, skills, rules, project context, prompt templates, slash commands, MCP servers, and tools. MCP and LSP integration are enabled by default.

This makes the smallest example useful in an existing omp setup. Embedders commonly override only the pieces they need to own:

| Option | Use it when |
| --- | --- |
| `cwd` | omp should operate on a directory other than the host process's project directory. |
| `sessionManager` | The host needs ephemeral history, a custom session location, resume, or fork behavior. |
| `model` or `modelPattern` | Model choice must be deterministic rather than discovered from settings. |
| `thinkingLevel` | The host wants a specific reasoning selector such as `"medium"` or `"high"`. |
| `settings` | The host needs isolated overrides instead of the discovered config. |
| `systemPrompt` / `appendSystemPrompt` | The host needs to replace or extend the rendered system prompt. |
| `toolNames` / `restrictToolNames` | The host needs to request tools or enforce an allowlist. |
| `customTools` | The host exposes application functions to the agent. |
| `extensions` / `additionalExtensionPaths` | The host supplies inline or file-based extensions. |
| `enableMCP` / `enableLsp` | The host disables either automatically discovered integration. |
| `autoApprove` | The host deliberately opts out of interactive tool approval. |

### Ephemeral and persistent sessions

The default session manager writes history to omp's session store. Use an in-memory manager for request-scoped jobs:

```ts
import {
  createAgentSession,
  SessionManager,
} from "@oh-my-pi/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
```

For an explicit file-backed session, use `SessionManager.create(cwd)`. The same public class also provides `continueRecent(cwd)`, `list(cwd)`, `open(path)`, and fork helpers; see [Sessions](/docs/sessions).

### Own model and settings selection

Use the package-root exports when the host must control credentials, model selection, and settings rather than relying on discovery:

```ts
import {
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
} from "@oh-my-pi/pi-coding-agent";

const authStorage = await discoverAuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
await modelRegistry.refresh();

const model = modelRegistry.getAvailable()[0];
if (!model) {
  throw new Error("No authenticated model is available");
}

const settings = Settings.isolated({
  "compaction.enabled": true,
  "retry.enabled": true,
});

const { session } = await createAgentSession({
  authStorage,
  modelRegistry,
  model,
  settings,
  sessionManager: SessionManager.inMemory(),
  enableMCP: false,
});
```

When you pass both `authStorage` and `modelRegistry`, the registry must have been created with that same auth-storage instance. For normal persisted configuration and its precedence rules, see [Settings](/docs/settings).

The default process-wide `AgentRegistry` admits one top-level `Main` identity per generation. If your application runs multiple independent top-level sessions concurrently, give each session its own `agentRegistry: new AgentRegistry()`.

## Stream events into your host

`session.subscribe(listener)` returns an unsubscribe function. The most useful public events are:

| Event | Host use |
| --- | --- |
| `message_update` | Stream assistant content. `assistantMessageEvent.type` includes `text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, and `error`. |
| `message_start` / `message_end` | Observe complete user, assistant, and tool-result messages. |
| `tool_execution_start` / `_update` / `_end` | Render tool progress. The end event includes the result and optional `isError`. |
| `turn_start` / `turn_end` | Delimit one assistant response and its tool results. |
| `agent_start` / `agent_end` | Delimit an agent run. If `agent_end.isTerminal === false`, queued asynchronous delivery will resume the session. |
| `auto_compaction_start` / `_end` | Show automatic context maintenance. |
| `auto_retry_start` / `_end` | Show provider retry state. |
| `notice` | Surface informational, warning, or error notices from the session. |

Event listeners are notifications, not a backpressure mechanism: the session does not await an async listener. Queue expensive host work yourself if ordering matters.

## Add a host-owned tool

A `CustomTool` is a public callback contract. Define its input with the package's exported `z` schema builder and return text or image content for the model. The final `AbortSignal` lets session cancellation reach your I/O.

```ts
import {
  createAgentSession,
  type CustomTool,
  z,
} from "@oh-my-pi/pi-coding-agent";

const lookupTicket: CustomTool = {
  name: "lookup_ticket",
  label: "Lookup ticket",
  description: "Fetch a support ticket by its public ticket ID.",
  parameters: z.object({ ticketId: z.string() }),

  async execute(_toolCallId, { ticketId }, _onUpdate, _context, signal) {
    try {
      const response = await fetch(
        `https://support.example.test/tickets/${encodeURIComponent(ticketId)}`,
        { signal },
      );

      if (!response.ok) {
        return {
          content: [{ type: "text", text: `Ticket lookup failed (${response.status}).` }],
          isError: true,
        };
      }

      const ticket = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(ticket) }],
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        content: [{ type: "text", text: `Ticket lookup failed: ${String(error)}` }],
        isError: true,
      };
    }
  },
};

const { session } = await createAgentSession({
  customTools: [lookupTicket],
});
```

Tool schemas validate shape, not authorization. Enforce tenant boundaries, permissions, rate limits, and secret handling inside the host callback. Return `isError: true` for an expected failure the model can react to; reserve thrown errors for cancellation or unexpected failures.

`toolNames` requests tools and can enable tools that are disabled by default, but it is **not** an allowlist by itself. To restrict the session, set `restrictToolNames: true`. In a restricted session, a host tool is available only when all three are true:

```ts
const { session } = await createAgentSession({
  customTools: [lookupTicket],
  toolNames: ["lookup_ticket"],
  restrictToolNames: true,
  allowRestrictedCustomTools: true,
});
```

For reusable tools, commands, hooks, and UI integrations loaded from authored packages, use [Extension authoring](/docs/extension-authoring).

## Control and clean up a session

| API | Behavior |
| --- | --- |
| `session.prompt(text, options?)` | Submit a prompt. It returns `false` only when a local command fully consumes the input; otherwise `true`. |
| `session.steer(text)` | Queue guidance that interrupts the active run at its next safe boundary. |
| `session.followUp(text)` | Queue another user turn after the current run would otherwise stop. |
| `session.abort()` | Cancel active work and wait for the agent to become idle. |
| `session.compact(instructions?)` | Run context compaction explicitly. |
| `session.dispose()` | Idempotently stop owned work and release session resources. Always await it. |

Calling `prompt()` while the session is already streaming requires `streamingBehavior: "steer"` or `"followUp"`; calling `steer()` or `followUp()` directly is clearer for most hosts.

Use `try`/`finally` around the lifetime of every session. If your host has its own asynchronous shutdown work, call `session.beginDispose()` before the first shutdown `await`, finish the host cleanup, and then `await session.dispose()`. `beginDispose()` closes admission to new work; it does not replace `dispose()`.

## Handle failures

Handle failures at both API and event boundaries:

- Wrap `createAgentSession()` and `session.prompt()` in `try`/`catch`. Invalid configuration, divergent auth/model wiring, a missing selected model, a missing API key, or a busy session can reject the call.
- Watch `message_update` where `assistantMessageEvent.type === "error"` for provider-side streamed failures. Its assistant message carries the provider error details.
- Watch `tool_execution_end.isError` for a tool failure that the agent received as a result.
- Display `modelFallbackMessage` when restoring a session cannot use its saved model and omp selects another one.
- If no model is available, run `omp` and use `/login`, set the provider's API-key environment variable, or pass an explicitly configured `authStorage` and `modelRegistry`.
- Always dispose the session after failure; disposal is safe to call more than once.

## SDK or RPC?

| Choose | Best fit | Trade-off |
| --- | --- | --- |
| **SDK** | Bun/TypeScript host, direct callbacks for tools, direct session state, lowest integration overhead | omp shares your process, runtime, memory, and failure boundary |
| **RPC** | Any language, child-process or service isolation, newline-delimited JSON protocol | The host must manage a process and protocol lifecycle |

RPC starts with `omp --mode rpc` and exposes session events over stdio. Do not put an RPC subprocess behind the SDK merely to call the same process twice: choose the SDK for an in-process Bun host, or RPC for a real language/process boundary.
