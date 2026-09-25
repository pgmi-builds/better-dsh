<!--
source: https://omp.sh/docs/extension-authoring
fetched: 2026-09-06
-->

# Authoring extensions

> Build a TypeScript or JavaScript package that adds tools, slash commands, event behavior, and other omp capabilities, then load it locally or distribute it as a plugin.

## Build your first extension

An extension is a TypeScript or JavaScript module that omp loads into the session process. Use one when a capability needs executable behavior: a tool the model can use, a slash command for the user, a policy around tool calls, a custom UI, or a provider integration.

A distributable extension package can also bundle declarative capabilities such as skills, prompt templates, rules, hooks, custom tools, and MCP server configuration. The extension factory and those sibling folders are discovered together, so users install one package.

Start with two files. omp runs TypeScript directly, so a build step is optional.

```text
hello-extension/
├── package.json
└── src/
    └── index.ts
```

```json
{
  "name": "hello-extension",
  "version": "1.0.0",
  "type": "module",
  "files": ["src"],
  "omp": {
    "extensions": ["./src/index.ts"]
  }
}
```

`omp.extensions` is an array, and every entry is relative to the package root. Installed-plugin entries may be `.ts`, `.js`, `.mjs`, or `.cjs`. The older `pi.extensions` field remains compatible, but new packages should use `omp.extensions`.

Install omp's package as a development dependency for current TypeScript types and editor completion:

```bash
cd hello-extension
bun add --dev @oh-my-pi/pi-coding-agent
```

Now create `src/index.ts`:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function helloExtension(pi: ExtensionAPI) {
  const z = pi.zod;

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("hello-extension loaded", "info");
  });

  pi.registerCommand("hello", {
    description: "Greet someone",
    handler: async (args, ctx) => {
      const name = args.trim() || "there";
      ctx.ui.notify(`Hello, ${name}!`, "info");
    },
  });

  pi.registerTool({
    name: "greet_person",
    label: "Greet Person",
    description: "Create a short greeting for a person",
    parameters: z.object({
      name: z.string().describe("Person to greet"),
    }),
    approval: "read",
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: { name: params.name },
      };
    },
  });
}
```

The default export is the public factory contract:

```ts
export type ExtensionFactory = (
  pi: ExtensionAPI,
) => void | Promise<void>;
```

Register commands, tools, handlers, renderers, flags, and providers inside the factory. Runtime actions such as `pi.sendMessage()` are not available while the factory is loading; call them later from an event handler, command handler, or tool execution.

## Load and test it

From the directory containing `hello-extension`, start a one-off development session:

```bash
omp --extension ./hello-extension
# -e is the short form
```

In the TUI:

1. The `hello-extension loaded` notification confirms that the factory ran.
2. Enter `/hello Ada` to test the user-facing command.
3. Ask **“Use the greeting tool to greet Ada.”** to exercise the tool through a normal prompt.
4. Open `/extensions` to inspect the discovered capability items and their enablement state.

Extension factories are initialized at session startup. After changing `src/index.ts`, exit and start a new session to load the new code.

### Keep it enabled while developing

Link the package into your user plugin set:

```bash
omp plugin link ./hello-extension
# Equivalent for a local path:
omp install ./hello-extension
```

A local install is a symlink, so edits are present the next time omp starts; it does not hot-reload a running extension factory. Use `omp plugin list` to confirm the link and `omp plugin doctor` to check installed plugin health.

For a package you do not want to install, add its absolute path to the user config instead:

```yaml
# ~/.omp/agent/config.yml
extensions:
  - /absolute/path/to/hello-extension
```

A relative configured path is resolved from the directory where omp starts, not from the config file. Project-specific configuration belongs in `<project>/.omp/config.yml`. Loose modules can also be placed directly in `<project>/.omp/extensions/` or `~/.omp/agent/extensions/`; automatic directory scans find `.ts` and `.js` files plus one level of `index.ts` or `index.js` subdirectories.

## Bundle more capabilities

A package root loaded through `--extension`, `extensions:`, or the plugin manager can contain these conventional paths:

```text
hello-extension/
├── package.json
├── src/index.ts
├── skills/release-notes/SKILL.md
├── commands/release.md
├── rules/commit-policy.md
├── prompts/review.md
├── hooks/
│   ├── pre/block-dangerous.ts
│   └── post/audit.ts
├── tools/
│   └── changelog/index.ts
└── .mcp.json
```

| Path | What omp discovers |
| --- | --- |
| `skills/<name>/SKILL.md` | On-demand skills |
| `commands/*.md` | User slash commands |
| `rules/*.{md,mdc}` | Project or workflow rules |
| `prompts/*.md` | Prompt templates |
| `hooks/pre/*`, `hooks/post/*` | Pre- and post-tool hooks |
| `tools/*` | Custom tools in the supported script, Markdown, JSON, TS, or JS formats |
| `.mcp.json` or `mcp.json` | MCP server definitions |

These folders need no fields in `package.json`. Include them in the package's `files` list when publishing. See [Skills](/docs/skills), [Hooks](/docs/hooks), [Custom tools](/docs/custom-tools), and [MCP](/docs/mcp) for each file format.

A package can expose more than one runtime factory:

```json
{
  "omp": {
    "extensions": ["./src/policy.ts", "./src/tools.ts"]
  }
}
```

Use separate entries only when they are meaningfully independent. A single factory can register every public extension surface.

## Package and distribute it

Extensions run with the same filesystem, network, environment, and process privileges as omp. They are not sandboxed. Keep the package auditable, avoid unnecessary dependencies, and tell users what external access it needs.

### Publish to npm

Make sure `files` includes every factory and bundled capability directory, then inspect the tarball before publishing:

```bash
npm pack --dry-run
npm publish
```

Users install a published package by npm name:

```bash
omp install @acme/hello-extension
```

The package manager installs its dependencies and reads `omp.extensions` from the published `package.json`. Start a new omp session after installing or upgrading an extension module.

### Install from Git

A public repository can be installed without a marketplace:

```bash
omp install github:acme/hello-extension#v1.0.0
```

Use an immutable tag or commit for reproducible installs.

### Publish through a marketplace

A marketplace is a Git repository containing `.omp-plugin/marketplace.json`. `.claude-plugin/marketplace.json` is the Claude Code-compatible fallback. A minimal repository can keep the extension in `plugins/hello-extension/` and use this catalog:

```json
{
  "name": "acme-extensions",
  "owner": { "name": "Acme" },
  "plugins": [
    {
      "name": "hello-extension",
      "description": "A greeting command and tool",
      "version": "1.0.0",
      "source": "./plugins/hello-extension",
      "category": "productivity"
    }
  ]
}
```

After pushing the repository, users run:

```bash
omp plugin marketplace add acme/omp-extensions
omp plugin install hello-extension@acme-extensions
```

When releasing an update, tag the repository, update the catalog version and source pin as appropriate, and ask users to run `omp plugin marketplace update` followed by `omp plugin upgrade hello-extension@acme-extensions`. See [Marketplace](/docs/marketplace) for catalog source formats, pinning, scopes, and update behavior, and [Plugins](/docs/plugins) for installation and feature management.

## Public extension interfaces

The installed `@oh-my-pi/pi-coding-agent` TypeScript declarations are the canonical signature reference. Import public types from the package root:

```ts
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  ExtensionFactory,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
```

### `ExtensionAPI`

| Surface | Public members |
| --- | --- |
| Schema and host access | `zod`, `arktype`, `typebox`, `logger`, `pi` |
| Events | `on(event, handler)`, shared `events` bus |
| Registration | `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerMessageRenderer`, `registerAssistantThinkingRenderer`, `registerComposerShape` |
| Provider integration | `registerProvider`, `unregisterProvider` |
| Host filesystem fallbacks | `registerFileWriteFallback`, `registerFileDeleteFallback` |
| Messages and execution | `sendMessage`, `sendUserMessage`, `appendEntry`, `exec` |
| Tools and commands | `getActiveTools`, `getAllTools`, `setActiveTools`, `getCommands` |
| Session choices | `setModel`, `getThinkingLevel`, `setThinkingLevel`, `getServiceTiers`, `setServiceTier`, `getSessionName`, `setSessionName` |
| Metadata and flags | `setLabel`, `getFlag` |

Use `pi.zod` or `pi.arktype` for new tool schemas. `pi.typebox` exists for compatibility with older extensions.

### Commands, shortcuts, and flags

```ts
pi.registerCommand("deploy", {
  description: "Deploy the current project",
  getArgumentCompletions: (prefix) => [
    { value: "staging", label: "staging" },
    { value: "production", label: "production" },
  ].filter((item) => item.value.startsWith(prefix)),
  handler: async (args, ctx) => {
    // args is the text after /deploy
  },
});

pi.registerShortcut("ctrl+shift+d", {
  description: "Open deployment controls",
  handler: async (ctx) => {
    ctx.ui.notify("Deployment controls", "info");
  },
});

pi.registerFlag("deployment-target", {
  description: "Default deployment target",
  type: "string",
  default: "staging",
});
```

Command names must not collide with built-in slash commands. Shortcut keys use the same IDs described in [Keybindings](/docs/keybindings); reserved terminal and core chords cannot be replaced. Read a registered flag with `pi.getFlag("deployment-target")`.

### Tools

A `ToolDefinition` requires `name`, `label`, `description`, `parameters`, and an async `execute` function. The full optional surface is:

| Field | Purpose |
| --- | --- |
| `hidden` | Exclude the tool unless explicitly selected |
| `defaultInactive` | Register it without initially activating it |
| `loadMode` | `"discoverable"` by default; use `"essential"` to keep it top-level |
| `approval` | `"read"`, `"write"`, or `"exec"`; defaults to `"exec"` |
| `deferrable` | Allow staged changes that require resolve or discard |
| `strict` | Opt in or out of provider structured-output grammar |
| `onSession` | Initialize or clean up state on start, switch, branch, tree navigation, or shutdown |
| `renderCall`, `renderResult` | Provide TUI components for custom presentation |
| `mcpServerName`, `mcpToolName` | Add discovery metadata when the tool fronts MCP |

`execute(toolCallId, params, signal, onUpdate, ctx)` returns an agent tool result with a `content` array and optional typed `details`. Respect `signal` for cancellation and use `onUpdate` for meaningful streamed progress.

### Runtime and command contexts

Every event handler and tool receives `ExtensionContext`. Command handlers receive the larger `ExtensionCommandContext`.

| `ExtensionContext` member | Purpose |
| --- | --- |
| `cwd`, `mode`, `hasUI`, `ui` | Current directory and user-interface surface |
| `model`, `models`, `modelRegistry` | Current model and read-only model discovery/resolution |
| `sessionManager` | Read-only session access |
| `getContextUsage()`, `getAsyncJobSnapshot()` | Current context and background-job snapshots |
| `isIdle()`, `hasPendingMessages()`, `abort()`, `shutdown()` | Session state and lifecycle controls |
| `compact()`, `getSystemPrompt()` | Context operations |
| `memory` | Configured structured-memory runtime, when available |
| `setInterval`, `setTimeout`, `clearTimer` | Managed background callbacks |
| `invokeTool` | Delegate to the native implementation when replacing the same built-in tool |
| `localProtocolOptions` | Calling session's local-protocol mapping, when present |
| `isProjectTrusted()` | Compatibility check; omp currently trusts loaded project inputs |

Command handlers additionally receive `waitForIdle()`, `newSession()`, `switchSession()`, `branch()`, `navigateTree()`, and `reload()`.

`ctx.ui` includes notifications, selection/confirmation/input dialogs, editor access, status and widgets, header/footer controls, themes, custom TUI components, and autocomplete registration. Check `ctx.hasUI` or `ctx.mode === "tui"` before depending on interactive-only behavior; print and RPC sessions do not have an interactive terminal.

Use `ctx.setInterval()` and `ctx.setTimeout()` instead of raw timers. Managed callbacks contain thrown errors, do not keep the process alive, and are cleared on session shutdown.

### Events

Subscribe with `pi.on(name, handler)`. The event object and allowed return value are inferred from the event name.

| Group | Event names |
| --- | --- |
| Resource discovery | `resources_discover` |
| Session lifecycle | `session_start`, `session_before_switch`, `session_switch`, `session_before_branch`, `session_branch`, `session_before_compact`, `session.compacting`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown` |
| Prompt and provider | `input`, `before_agent_start`, `before_provider_request`, `after_provider_response`, `context` |
| Agent and messages | `agent_start`, `agent_end`, `session_stop`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end` |
| Tool lifecycle | `tool_call`, `tool_result`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `tool_approval_requested`, `tool_approval_resolved` |
| User commands and MCP | `user_bash`, `user_python`, `mcp_notification` |
| Compaction and retry | `auto_compaction_start`, `auto_compaction_end`, `auto_retry_start`, `auto_retry_end`, `retry_fallback_applied`, `retry_fallback_succeeded`, `ttsr_triggered` |
| Session services | `todo_reminder`, `goal_updated`, `credential_disabled` |

Pre-events can cancel or replace their documented operation, `tool_call` can block a call, and `tool_result` can replace its result. Let TypeScript enforce the exact return shape rather than returning fields intended for a different event.

## Troubleshooting

### The package does not load

- Confirm that each `omp.extensions` path exists and is relative to `package.json`.
- Confirm the entry default-exports a function, not an already-created object.
- Run `omp --extension /absolute/path/to/package` to remove config and working-directory ambiguity.
- Check `/extensions` and the structured logs under `~/.omp/logs/` for the capability's discovery state. Runtime factory import errors include the failing path in the structured logs under `~/.omp/logs/`.
- If the extension imports runtime dependencies, run the package manager before loading it and declare those dependencies in `dependencies`, not only `devDependencies`.

One failed extension does not prevent other extension paths from loading.

### It loads, but a capability is missing

- Restart omp after changing an extension factory or installing a package.
- Make sure bundled folders are at the package root, beside `package.json`, and included in the published tarball.
- Use `/reload-plugins` for changed skills, slash commands, and MCP servers. Tools, hooks, and extension modules require a new session.
- Check whether the item was disabled in `/extensions` or by `disabledExtensions` in config. A runtime factory's ID is `extension-module:<filename>`; an `index.ts` entry uses its parent directory name.

### It crashes or behaves differently outside the TUI

Extensions are in-process and unsandboxed. Catch failures from your own detached promises, use managed context timers, honor abort signals, and release resources on `session_shutdown`. Guard custom terminal UI with `ctx.mode === "tui"` and provide a non-interactive behavior when the extension must also work in print, RPC, or ACP sessions.
