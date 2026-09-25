<!--
source: https://omp.sh/docs/hooks
fetched: 2026-09-06
-->

# Hooks

> Run trusted TypeScript at well-defined points in an omp session: prevent risky actions, transform context or tool results, and react to lifecycle events.

## Start with a force-push guard

Hooks let you apply a local policy every time omp works: stop a dangerous command before it runs, redact output before it reaches the model, add context to a turn, or record session activity. A hook is a trusted TypeScript or JavaScript module that subscribes to public events.

This project hook blocks `git push --force` while still allowing `--force-with-lease`:

```ts
// .omp/hooks/pre/force-push.ts
import {
  isToolCallEventType,
  type ExtensionAPI,
} from "@oh-my-pi/pi-coding-agent";

const FORCE_PUSH = /\bgit\s+push\b[^\n]*(?:--force(?:\s|$)|(?:^|\s)-f(?:\s|$))/;

export default function forcePushGuard(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.notify("Force-push guard active", "info");
  });

  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!FORCE_PUSH.test(event.input.command)) return;

    return {
      block: true,
      reason: "Blocked git push --force; use --force-with-lease after reviewing the remote branch.",
    };
  });
}
```

Create the directory, save the file, and start a new `omp` session from that project. The startup notification confirms the handler ran. Open `/extensions` to see the resolved file and its source.

To test a loose file without installing it, pass it explicitly:

```sh
omp --hook /absolute/path/to/force-push.ts
```

Then ask:

> Run `git push --force` in this throwaway repository.

The command must not run. omp shows the hook's reason as the tool error, and the agent can choose a safer next step. Use a throwaway repository for policy tests in case the hook contains a mistake.

> Hooks execute as your user and can inspect prompts, tool inputs, results, credentials metadata, and session state. Only load code you trust.

## Install a loose hook

omp automatically discovers direct `.ts` and `.js` files in these directories:

| Scope | Directory |
| --- | --- |
| Current project | `.omp/hooks/pre/` and `.omp/hooks/post/` under the session's working directory |
| Current user profile | `~/.omp/profiles/<name>/agent/hooks/pre/` and `post/` for a named profile; `~/.omp/agent/hooks/pre/` and `post/` for the default profile |

Discovery is not recursive. A file such as `.omp/hooks/pre/team/guard.ts` is ignored. Start a new session after adding or changing a hook.

`pre` and `post` are organization and discovery namespaces; they do not automatically select an event or tool. A file in `pre/` may subscribe to any event, and a filename such as `bash.ts` does not automatically filter calls. Register the event and perform any `toolName` check in code. Conventionally, put gates and input transforms in `pre/`, and observers or result transforms in `post/`.

For a one-session load, use either `--hook <path>` or `--extension <path>`; the flags feed the same module-loading surface. A relative path resolves from the session working directory. To keep an explicit hook enabled, add its absolute path to `extensions` in `~/.omp/agent/config.yml`:

```yaml
extensions:
  - /absolute/path/to/force-push.ts
```

Check the effective set with `/extensions` interactively or `omp -p '/extensions'` from the shell.

## The module contract

A current hook module default-exports a synchronous or asynchronous factory that receives `ExtensionAPI`. Register handlers while the factory loads:

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function myHook(pi: ExtensionAPI) {
  pi.on("turn_end", async (event, ctx) => {
    pi.logger.debug("turn completed", {
      cwd: ctx.cwd,
      turn: event.turnIndex,
    });
  });
}
```

The handler receives `(event, ctx)`. `event` is the typed payload in the tables below. Frequently useful context members are:

| Member | Meaning |
| --- | --- |
| `ctx.cwd` | Current session working directory. |
| `ctx.mode` | `"tui"`, `"rpc"`, `"json"`, or `"print"`. |
| `ctx.hasUI`, `ctx.ui` | Whether interactive UI is available, plus notifications, prompts, status, widgets, and other UI methods. Guard interactive calls with `hasUI` or `mode === "tui"`. |
| `ctx.model`, `ctx.models` | Current model and the read-only model query surface. |
| `ctx.sessionManager` | Read-only session access. Use `pi.sendMessage()` or `pi.appendEntry()` for supported writes. |
| `ctx.isIdle()`, `ctx.hasPendingMessages()`, `ctx.abort()` | Current run state and cancellation control. |
| `ctx.getContextUsage()`, `ctx.getSystemPrompt()` | Current context usage and effective system-prompt lines. |
| `ctx.setTimeout()`, `ctx.setInterval()`, `ctx.clearTimer()` | Session-owned timers whose errors are contained and which are cleared at shutdown. |

Use the exported TypeScript types rather than copying nested payload types into your hook. In particular, tool inputs and details are discriminated unions; `isToolCallEventType("bash", event)` narrows a built-in tool safely.

## Events that can change behavior

Payload columns list the public top-level fields in addition to `type`. A bare return leaves behavior unchanged.

| Event | Payload | Handler return and combination behavior |
| --- | --- | --- |
| `resources_discover` | `cwd`, `reason: "startup" \| "reload"` | `{ skillPaths?, promptPaths?, themePaths? }`. Paths from every handler are accumulated. |
| `input` | `text`, `images?`, `source: "interactive" \| "rpc" \| "extension"` | `{ text?, images?, handled? }`. Transforms chain; `handled: true` stops normal input processing and later handlers. |
| `user_bash` | `command`, `excludeFromContext`, `cwd` | `{ result }` to replace execution. The first handler that returns a result wins. This observes user-entered `!`/`!!` commands, not model tool calls. |
| `user_python` | `code`, `excludeFromContext`, `cwd` | `{ result }` to replace execution. The first handler that returns a result wins. This observes user-entered `$`/`$$` code. |
| `tool_call` | `toolName`, `toolCallId`, typed `input` | `{ block?, reason?, input? }`. The first block stops dispatch. Otherwise the last returned result wins; all handlers see the original event input. Replacement `input` on a model-issued call is revalidated and becomes what omp displays, approves, persists, and executes. It is ignored for blocked calls and not applied to `computer` calls. |
| `tool_result` | `toolName`, `toolCallId`, `input`, `content`, `details`, `isError` | `{ content?, details?, isError? }`. Changes chain field by field, and later handlers see earlier changes. A hook may rewrite success or failure output and may change the final error state. |
| `context` | `messages` about to be sent to the model | `{ messages }`. Replacements chain. This changes only that model call, not stored session messages. |
| `before_provider_request` | opaque `payload` | Return the replacement provider payload directly. Replacements chain. This is an advanced provider-specific seam; a malformed payload can break the request. |
| `before_agent_start` | `prompt`, `images?`, current `systemPrompt` lines | `{ message?, systemPrompt? }`. Every returned message is added; system-prompt replacements chain. The custom message is persisted and visible according to its `display` field. |
| `session_before_switch` | `reason: "new" \| "resume" \| "fork"`, `targetSessionFile?` | `{ cancel: true }` stops the switch. First cancellation wins. |
| `session_before_branch` | `entryId` | `{ cancel?, skipConversationRestore? }`. First cancellation wins; otherwise the latest returned result applies. |
| `session_before_compact` | `preparation`, `branchEntries`, `customInstructions?`, `signal` | `{ cancel?, compaction? }`. Cancel or provide a complete custom compaction result; first cancellation wins, otherwise the latest result applies. |
| `session.compacting` | `sessionId`, `messages` | `{ context?, prompt?, preserveData? }`. The latest returned result replaces earlier results. Use this to customize normal compaction without constructing a complete compaction result. |
| `session_before_tree` | `preparation`, `signal` | `{ cancel?, summary? }`. First cancellation wins; otherwise the latest result applies. A custom summary is used only when `preparation.userWantsSummary` is true. |
| `session_stop` | `messages`, `turn_id`, `last_assistant_message?`, `session_id`, `session_file?`, `stop_hook_active`, `signal` | `{ continue: true, additionalContext }` or `{ decision: "block", reason }` requests one model-visible continuation. The first actionable continuation with non-empty context/reason wins. |

### Tool interception details

`tool_call` is the pre-execution policy seam. Its `event.input` is a normalized view intended for inspection; an `input` returned by the handler must instead be the complete raw argument object the tool executes. Do not copy normalized, gate-only fields into a replacement. If you only need to deny an action, return `block` and avoid rewriting input.

A revised call still goes through the normal tool schema and approval policy. The user therefore approves the arguments that will actually run. Hooks supplement omp's approval settings; they do not bypass them.

`tool_result` runs after both successful and failed executions. Text and image blocks live in `content`; tool-specific metadata lives in `details`. Prefer returning new content objects rather than mutating the event in place.

## Notification events

Returns from these events are ignored. The payload is still typed, so a hook can log, update UI, persist its own state, or enqueue a supported message.

### Session and agent lifecycle

| Event | Payload and timing |
| --- | --- |
| `session_start` | No additional fields; initial session load. |
| `session_switch` | `reason`, `previousSessionFile`; after a new, resumed, or forked session becomes active. |
| `session_branch` | `previousSessionFile`; after branching. |
| `session_compact` | `compactionEntry`, `fromExtension`; after compaction. |
| `session_tree` | `newLeafId`, `oldLeafId`, `summaryEntry?`, `fromExtension?`; after tree navigation. |
| `session_shutdown` | No additional fields; process shutdown. Use it for short cleanup only. |
| `agent_start` | No additional fields; once per submitted prompt when an agent loop begins. |
| `agent_end` | `messages`, `willContinue?`; loop end. `willContinue` means an automatic continuation is already scheduled. |
| `turn_start` | `turnIndex`, `timestamp`; start of one model/tool turn. |
| `turn_end` | `turnIndex`, final `message`, `toolResults`; end of one turn. |
| `message_start` | `message`; a user, assistant, or tool-result message started. |
| `message_update` | current `message`, `assistantMessageEvent`; streaming assistant updates. This can be high-volume. |
| `message_end` | detached `message` snapshot; notification only. Mutating it does not rewrite model or session context. |

### Tool execution and approvals

| Event | Payload and timing |
| --- | --- |
| `tool_execution_start` | `toolCallId`, `toolName`, `args`, `intent?`; execution begins after pre-call processing. |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult`; streaming progress. This can be high-volume. |
| `tool_execution_end` | `toolCallId`, `toolName`, `result`, `isError`; execution completed. Use `tool_result`, not this event, to rewrite what the model receives. |
| `tool_approval_requested` | `sessionId`, `toolCallId`, `toolName`, `reason?`, `approvalMode`; omp is about to ask for approval. |
| `tool_approval_resolved` | `sessionId`, `toolCallId`, `toolName`, `approved`, `reason?`; approval was accepted or denied. |

### Maintenance, retry, and integrations

| Event | Payload and timing |
| --- | --- |
| `auto_compaction_start` | `reason`, `action`; automatic compaction began. |
| `auto_compaction_end` | `action`, `result`, `aborted`, `willRetry`, `errorMessage?`, `skipped?`; automatic compaction settled. |
| `auto_retry_start` | `attempt`, `maxAttempts`, `delayMs`, `errorMessage`, `errorId?`; a retry wait began. |
| `auto_retry_end` | `success`, `attempt`, `finalError?`, `retryErrors?`; retry sequence settled. |
| `retry_fallback_applied` | `from`, `to`, `role`; retry switched model/provider. |
| `retry_fallback_succeeded` | `model`, `role`; a request succeeded on the fallback. |
| `ttsr_triggered` | matched `rules`; generation was interrupted by a TTSR rule. |
| `todo_reminder` | `todos`, `attempt`, `maxAttempts`; unfinished-todo reminder logic ran. |
| `goal_updated` | `goal` or `null`, `state?`; goal-mode state changed. |
| `credential_disabled` | `provider`, `disabledCause`; omp automatically soft-disabled a failing credential. It is not emitted for a user removal or credential deduplication. |
| `mcp_notification` | raw configured `server` name, JSON-RPC `method`, opaque `params`; emitted after omp handles known MCP notifications and also for server-specific methods. |
| `after_provider_response` | `status`, `headers`, `requestId?`, `metadata?`; response metadata is available before the stream body is consumed. There is no response body in this event. |

## Ordering, timeouts, and errors

Within one module, handlers run in registration order. Except for `session_shutdown`, event handlers are awaited one at a time. Across modules, handlers follow the resolved load order, but directory enumeration and capability deduplication are not a public priority mechanism. Do not use filename prefixes such as `00-` and `99-` to build correctness dependencies across hook files; combine dependent handlers in one module instead.

A duplicate discovered hook key can shadow a lower-priority provider's hook. Use distinctive filenames in packages. An explicitly listed path is deduplicated by its resolved absolute path, so the same module is not intentionally loaded twice.

Most handlers have a 30-second active-work budget. `tool_call` uses the configurable `extensionHandlers.toolCallTimeoutMs` setting, also 30 seconds by default:

```yaml
extensionHandlers:
  toolCallTimeoutMs: 10000
```

A `tool_call` exception or timeout fails closed: omp blocks the call and reports which extension failed or timed out. Other event exceptions and timeouts are reported as extension errors, that handler contributes no result, and later handlers continue. `session_shutdown` handlers run concurrently with a two-second budget so cleanup cannot hold the process open.

At load time, a syntax/import error, a thrown factory, or a missing default factory prevents that module from loading; omp continues loading other modules. Use `/extensions` to identify the missing path, then restart with `--log-level debug` for the load error.

## Package and share hooks

For a reusable hook-only package, keep the conventional directory and declare the hook as a package entry. This makes direct directory loading work while installed-plugin discovery can also find the `hooks/` surface:

```text
force-push-guard/
  package.json
  hooks/
    pre/
      force-push.ts
```

```json
{
  "name": "@acme/force-push-guard",
  "version": "1.0.0",
  "omp": {
    "extensions": ["./hooks/pre/force-push.ts"]
  }
}
```

Test the directory before publishing:

```sh
omp --hook ./force-push-guard
```

For regular local use, install it as a plugin:

```sh
omp install ./force-push-guard
# Project scope instead of user scope:
omp install -l ./force-push-guard
```

`omp install` accepts local paths, npm packages, Git repositories, and marketplace entries. Package imports must be resolvable from the installed package, and every runtime file must be included in the published artifact. Keep secrets and machine-specific policy in user or project configuration rather than committing them into a public package.

See [Authoring extensions](/docs/extension-authoring) for multi-entry packages and [Plugins](/docs/plugins) for installation, scope, updates, and publishing.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Hook missing from `/extensions` | The file must be a direct `.ts` or `.js` child of `hooks/pre` or `hooks/post`, or be passed explicitly. Project discovery uses the session's working directory; user discovery uses the active profile. |
| Hook appears but a handler never runs | Directory and filename do not select events. Confirm the exact `pi.on("event_name", ...)` registration and any `toolName` filter. |
| Startup reports an invalid extension | Export one default factory function and fix its import/syntax error. Run with `--log-level debug` to see the failing path. |
| UI calls disappear in print or RPC mode | Check `ctx.hasUI` or `ctx.mode` before prompting or rendering. Use logging or persisted state for headless modes. |
| A tool is blocked with an extension failure | A `tool_call` handler threw or exceeded its timeout. Fix the hook rather than raising the timeout first; gates fail closed by design. |
| Two hooks disagree | Put ordering-dependent logic in one module. For independent modules, remember: first block wins, result/context transforms chain as documented above, and many session result events use the latest returned result. |
