<!--
source: https://omp.sh/docs/custom-tools
fetched: 2026-09-06
-->

# Custom tools

> Give omp a typed, project-specific action, then use it from ordinary prompts like any built-in capability.

## Add an action that omp does not have

A custom tool is a small TypeScript or JavaScript module that lets omp call code you control. It is useful for project-specific work such as querying an internal service, checking a domain invariant, or performing a carefully bounded operation.

Start with a project tool so its source can be reviewed with the repository. Create `.omp/tools/hello/index.ts`, restart omp from the project, and ask it to use the tool. Use an [MCP server](/docs/mcp) instead when the capability already lives in a separate service or needs to be shared by several clients.

> **Custom tools are trusted code.** omp imports discovered tool modules and runs them with your user account's permissions. Review project-local `.omp/tools` code before opening omp in an unfamiliar repository.

## Create the smallest tool

From the project root:

```bash
mkdir -p .omp/tools/hello
```

Create `.omp/tools/hello/index.ts`:

```ts
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const factory: CustomToolFactory = pi => ({
  name: "hello",
  label: "Hello",
  description: "Greet a person by name",
  parameters: pi.zod.object({
    name: pi.zod.string().describe("The person to greet"),
  }),

  async execute(_toolCallId, params) {
    return {
      content: [{ type: "text", text: `Hello, ${params.name}!` }],
      details: { greeted: params.name },
    };
  },
});

export default factory;
```

No schema package needs to be installed for this example. omp injects the schema builders into the factory as `pi`.

### Load and test it

Tool discovery happens when a session starts. Exit any running session, then launch omp again from the project root:

```bash
omp
```

Enter `/tools` and confirm that `hello` is listed. Then prompt:

```text
Use the hello tool to greet Ada.
```

You should see a **Hello** tool card and a final result containing `Hello, Ada!`. For a one-shot check, start a fresh process:

```bash
omp -p 'Use the hello tool to greet Ada.'
```

You write the factory and its `execute` function; you do **not** call `execute` or enter a JSON tool request. The model chooses the tool from your natural-language request, constructs arguments that match `parameters`, and omp validates those arguments before running your code. A precise `description`, field descriptions, and narrow schemas make that choice more reliable.

## Choose where it loads

| Scope | Recommended path | Use it when |
| --- | --- | --- |
| Project | `.omp/tools/<name>/index.ts` | The tool belongs to one repository and should be reviewed with it. |
| User | `<active-config-dir>/tools/<name>/index.ts` | You want the tool in every project for the active omp profile. Run `omp config path` to print the active config directory; the default is `~/.omp/agent`. |

The native omp directories also accept flat `.ts` and `.js` files such as `.omp/tools/hello.ts`. A named subdirectory with `index.ts` is preferable when the tool has supporting files. omp also discovers flat `.ts` and `.js` tools in user and project `.claude/tools` and `.codex/tools` directories for compatibility.

A discovered `.md` or `.json` file is metadata, not an executable tool module. The executable module must export a factory function; a default export is the supported, unambiguous form shown above.

## Factory and definition API

Import `CustomToolFactory` from `@oh-my-pi/pi-coding-agent`. A factory may return one tool, an array of tools, or a promise of either. Each returned tool name must be unique across built-ins and every other loaded custom tool.

### Required fields

| Field | Author contract |
| --- | --- |
| `name` | Registry name used to identify the tool. Do not reuse a built-in or another custom tool name. |
| `label` | Human-readable name shown in the TUI. |
| `description` | Short, specific guidance that helps the model decide when the tool applies. |
| `parameters` | Schema for accepted arguments. omp derives the TypeScript type of `params` from it and validates calls before `execute`. |
| `execute` | Async implementation that returns an `AgentToolResult`. |

### Optional behavior

| Field | Effect |
| --- | --- |
| `strict` | Requests strict schema handling for the tool. |
| `hidden` | Keeps the tool disabled unless it is explicitly selected. |
| `loadMode` | `"discoverable"` keeps the schema out of the always-present tool set; `"essential"` keeps it top-level. Custom tools default to `"discoverable"`. |
| `approval` | Declares the capability tier: `"read"`, `"write"`, or `"exec"`; it may also be a decision object or a function of the parsed arguments. An omitted approval is treated as `"exec"`. |
| `onSession` | Receives lifecycle events for setup, state changes, and cleanup. |
| `renderCall` | Replaces the default TUI rendering of the call. |
| `renderResult` | Replaces the default TUI rendering of partial and final results. |

`renderCall(args, options, theme)` and `renderResult(result, options, theme)` return a `Component` from `@oh-my-pi/pi-tui`. Their `options` include `expanded` and `isPartial`; partial renders can also receive `spinnerFrame`. Renderers affect what the person sees, not what the model receives.

## Parameter schemas

The factory host supplies three public schema builders:

| Builder | Guidance |
| --- | --- |
| `pi.zod` | Zod-compatible builder used in the starter example. |
| `pi.arktype` | Native omptype/ArkType builder. |
| `pi.typebox` | Compatibility shim for tools authored against the older TypeBox-style API. Prefer a current builder for new tools. |

Keep schemas as small as the operation allows. Use enums for finite actions, describe fields whose meaning is not obvious, and put defaults in the schema when omission has a safe meaning.

```ts
parameters: pi.zod.object({
  action: pi.zod.enum(["check", "summarize"]),
  path: pi.zod.string().describe("Repository-relative file path"),
  limit: pi.zod.number().int().positive().optional().default(20),
}),
```

## Execution, progress, and cancellation

The complete execution signature is:

```ts
async execute(toolCallId, params, onUpdate, ctx, signal) {
  // ...
}
```

| Argument | Use |
| --- | --- |
| `toolCallId` | Correlate logs or UI state for this invocation. |
| `params` | Validated, schema-typed arguments. |
| `onUpdate` | Optional callback for partial progress shown to the user. The model receives the final returned `content`, not these progress updates. |
| `ctx` | `CustomToolContext` for advanced session-aware tools. Ordinary tools should prefer the stable factory host API and avoid depending on session internals. |
| `signal` | Optional `AbortSignal`. Check it in long-running work and forward it to cancellable operations. |

The factory host exposes the session working directory as `pi.cwd` and a cancellation-aware process helper as `pi.exec(command, args, options?)`:

```ts
async execute(_id, params, onUpdate, _ctx, signal) {
  onUpdate?.({
    content: [{ type: "text", text: `Checking ${params.path}…` }],
  });

  const result = await pi.exec("git", ["status", "--short", "--", params.path], {
    cwd: pi.cwd,
    signal,
  });

  if (result.code !== 0) {
    throw new Error(result.stderr || "git status failed");
  }

  return { content: [{ type: "text", text: result.stdout || "No changes" }] };
}
```

Interactive UI methods are available through `pi.ui` only when `pi.hasUI` is true. Print, RPC, and other headless modes do not provide an interactive UI, so every tool intended for those modes must have a non-interactive path.

## Results and errors

Return an `AgentToolResult`:

```ts
return {
  content: [
    { type: "text", text: "Check complete." },
    { type: "image", mimeType: "image/png", data: pngBase64 },
  ],
  details: { checked: 12 },
  isError: false,
};
```

- `content` is required. It contains text and/or base64 image blocks and is the result the model can use in its next step.
- `details` is optional structured state for UI rendering, logging, and history. It is not substituted for user-readable `content`.
- `isError: true` marks an expected, non-throwing failure while preserving a structured result.

Throw an `Error` for failures that prevent the operation from producing a useful result. omp converts a thrown or rejected error into a failed tool result for the model and shows the failure to the user. Use `isError: true` when your tool intentionally catches a domain failure and can return a clear, structured explanation itself. Never hide a failure behind successful-looking content.

Forward `signal` to `pi.exec` and other cancellable APIs. That allows the user's stop action to cancel subprocess work instead of leaving it running.

## Session lifecycle

Add `onSession(event, ctx)` only when the tool owns resources or state that must follow session changes. It may be synchronous or async.

```ts
onSession(event) {
  if (event.reason === "shutdown") {
    // Close resources created by this factory.
  }
},
```

`event` is a discriminated union. Current reasons are:

| Reasons | When they occur |
| --- | --- |
| `start`, `switch`, `branch`, `tree`, `shutdown` | Session creation, navigation, and teardown. These events carry `previousSessionFile`; it is populated for switch/branch and otherwise may be undefined. |
| `auto_compaction_start`, `auto_compaction_end` | Before and after automatic context compaction. |
| `auto_retry_start`, `auto_retry_end` | Before and after automatic retry handling. |
| `ttsr_triggered` | When runtime rules trigger. |
| `todo_reminder` | When a todo reminder is emitted. |

Lifecycle errors are logged as warnings and do not crash the session. Keep cleanup idempotent and keep durable state outside in-memory closures if it must survive process restarts.

## Troubleshooting

### `/tools` does not list the tool

1. Restart omp; direct custom-tool directories are scanned at session startup.
2. Confirm the project session was launched from the directory containing `.omp/tools`.
3. Confirm the module is a `.ts` or `.js` file and default-exports a function.
4. Check that the factory returns an object with `name`, `description`, `parameters`, and `execute`.
5. Look for `Custom tool load failed` in today's logs under `~/.omp/logs/`.

### The module loads, but this tool is missing

Its `name` probably collides with a built-in or a tool loaded earlier. Collisions are rejected; there is no override flag. Rename the tool and restart omp.

### The model does not choose it

Make the tool `description` say exactly when it should be used, describe ambiguous parameters, and narrow broad strings to enums or constrained schemas. During testing, name the tool explicitly in your natural-language prompt. Use `loadMode: "essential"` only when the tool must remain top-level on every request; otherwise keep the discoverable default.

### It works interactively but fails in print or RPC mode

The implementation probably assumes a TUI. Guard calls to `pi.ui` with `pi.hasUI` and provide a headless behavior, or return a clear error explaining that the operation requires an interactive session.

## Related

- [MCP](/docs/mcp) — expose tools served by an external process.
- [Extension authoring](/docs/extension-authoring) — package tools with commands and event behavior.
- [Hooks](/docs/hooks) — observe or change existing tool calls instead of adding a new capability.
- [Plugins](/docs/plugins) — distribute tools with other omp customizations.
