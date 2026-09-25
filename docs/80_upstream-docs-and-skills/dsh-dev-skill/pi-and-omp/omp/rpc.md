<!--
source: https://omp.sh/docs/rpc
fetched: 2026-09-06
-->

# RPC mode

> Run omp as a long-lived subprocess and control it with newline-delimited JSON over stdin and stdout.

## Choose RPC when you own the host process

RPC mode is the lowest-common-denominator way to embed omp. Your program starts `omp`, sends one JSON object per line on stdin, and receives responses and streaming events as JSON lines on stdout. It works from any language with subprocess and JSON support.

| Surface | Choose it when… |
| --- | --- |
| Interactive omp | A person is working in the terminal and wants omp's editor, dialogs, and tool views. |
| One-shot `text` or `json` mode | A shell or CI job needs one prompt and then exits. `json` is an event stream, but it does not accept RPC commands. |
| [SDK](/docs/sdk) | Your TypeScript application can run omp in-process and wants typed, direct APIs instead of a process boundary. |
| [ACP](/docs/acp) | You are building an editor or client that already speaks the standardized Agent Client Protocol. |
| **RPC** | You need a long-lived omp session, streaming output, cancellation, state controls, or host callbacks from any language. |

Start with headless RPC and an ephemeral session:

```sh
omp --mode rpc --no-session
```

Omit `--no-session` to save the conversation under omp's normal session store. Normal model, provider, working-directory, and configuration options still apply; see the [CLI reference](/docs/cli). RPC rejects `@file` command-line arguments—send file references in the prompt instead.

`--mode rpc-ui` uses the same wire protocol but marks the embedded session as UI-capable and connects UI-dependent tool and extension surfaces to the RPC UI bridge. It does **not** launch a TUI or add a separate “tool card” frame type. Use it only when your host implements those UI behaviors. Either mode can emit `extension_ui_request` frames for features such as extension dialogs or login, so a complete host should understand that sub-protocol.

## Complete one prompt

Keep stdin open until the turn finishes. Read stdout continuously, keep stderr separate, and flush every command after its trailing newline.

This is a minimal valid exchange. Every displayed line is one complete JSON object; other events such as `available_commands_update` may be interleaved after `ready`.

```json
{"type":"ready","protocolVersion":1,"supportedProtocolVersions":[1,2],"maxFrameBytes":1048576,"maxReassembledFrameBytes":67108864}
{"id":"p1","type":"prompt","message":"Reply with only the word ok"}
{"id":"p1","type":"response","command":"prompt","success":true}
```

The first line is stdout from omp, the second is stdin from your host, and the third is a possible acknowledgment on stdout. The acknowledgment means “accepted,” not “finished.” The turn then streams events and finishes at an `agent_end` whose `isTerminal` is not `false`.

Here is a complete client using only the Python standard library. It deliberately remains on protocol v1 because its prompt produces a small response; production clients should negotiate v2 as described below.

```python
import json
import subprocess

proc = subprocess.Popen(
    ["omp", "--mode", "rpc", "--no-session"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True,
    bufsize=1,
)

assert proc.stdin is not None
assert proc.stdout is not None

ready = json.loads(proc.stdout.readline())
if ready.get("type") != "ready":
    raise RuntimeError(f"expected ready, got {ready!r}")

request_id = "p1"
proc.stdin.write(json.dumps({
    "id": request_id,
    "type": "prompt",
    "message": "Reply with only the word ok",
}) + "\n")
proc.stdin.flush()

accepted = False
finished = False
text_parts = []

for line in proc.stdout:
    frame = json.loads(line)

    if frame.get("type") == "response" and frame.get("id") == request_id:
        if not frame.get("success"):
            raise RuntimeError(frame.get("error", "RPC command failed"))
        if frame.get("command") == "prompt":
            accepted = True
            if frame.get("data", {}).get("agentInvoked") is False:
                finished = True

    if frame.get("type") == "message_update":
        event = frame.get("assistantMessageEvent", {})
        if event.get("type") == "text_delta":
            text_parts.append(event["delta"])

    if (frame.get("type") == "prompt_result"
            and frame.get("id") == request_id
            and frame.get("agentInvoked") is False):
        finished = True

    if (frame.get("type") == "agent_end"
            and frame.get("isTerminal") is not False):
        finished = True

    if accepted and finished:
        break

proc.stdin.close()
if proc.wait() != 0:
    raise RuntimeError(f"omp exited with {proc.returncode}")

print("".join(text_parts))
```

Do not assume the response arrives before the events: some prompt paths can begin emitting events first. Match command responses by `id`, and independently track prompt completion.

## Lifecycle, queues, and cancellation

### Process lifecycle

1. Spawn `omp --mode rpc` with separate stdin, stdout, and stderr streams.
2. Wait for `ready` before sending commands.
3. Read stdout continuously. A host callback or UI request can arrive while a command is outstanding.
4. Send commands as compact, unchunked JSON objects followed by `\n`.
5. Close stdin to disconnect. omp rejects pending UI/tool/URI callbacks, drains accepted commands, disposes the session, and exits with code `0`.

Stdout is exclusively the JSON protocol channel. Logs and diagnostics belong on stderr; never merge stderr into the JSON parser.

### Prompt completion

`prompt` and `abort_and_prompt` acknowledge scheduling immediately. A normal agent run is complete only when:

```text
frame.type == "agent_end" and frame.isTerminal != false
```

`isTerminal: false` means asynchronous delivery or maintenance will resume the session. An absent field is terminal-compatible.

A prompt may instead be handled locally—for example, by a slash command—and emit no `agent_end`. Detect that with either:

- `response.data.agentInvoked === false`, or
- a later `{ "type": "prompt_result", "id": …, "agentInvoked": false }`.

Local commands can also emit `command_output`. `agentInvoked: true` means agent lifecycle events will identify completion. If the field is absent, continue watching events and `prompt_result`.

### Sending work while a turn is active

- `steer` inserts a user message into the active run.
- `follow_up` queues a message for after the active run.
- A second `prompt` while streaming must include `streamingBehavior: "steer"` or `"followUp"` (camel-case `followUp`).
- Steering and follow-up queues default to `"one-at-a-time"`; their `set_*_mode` commands can switch to `"all"`.
- Interrupt mode defaults to `"immediate"`. `"wait"` defers steering until the turn finishes.

`bash` is the exception to normal command serialization: it runs concurrently so `abort_bash` can overtake it. Its response arrives when the command finishes, and may be out of order relative to other responses. Correlation by `id` is mandatory.

### Cancel safely

- Send `abort` to stop the active agent run. Wait for both the `abort` response and the terminal `agent_end` for the run.
- Send `abort_and_prompt` to abort and schedule a replacement prompt. It does not provide `data.agentInvoked` or `prompt_result`; rely on lifecycle events or a same-id scheduling error.
- Send `abort_retry` to stop an automatic retry delay.
- Send `abort_bash` to stop the current RPC-started shell command.
- Treat `host_tool_cancel`, `host_uri_cancel`, and UI `method: "cancel"` as cancellation of the referenced host-side operation.

## Errors and recovery

Command failures are ordinary response frames and usually leave the process usable:

```json
{"id":"m1","type":"response","command":"set_model","success":false,"error":"Model not found: provider/model"}
```

All failures have `type: "response"`, `success: false`, a string `command`, and a human-readable `error`. `code` is optional; `get_messages_page` currently uses `session_busy` and `stale_cursor`.

Important edge cases:

- Malformed JSON produces a recoverable failure with `command: "parse"` and no `id`; the next valid line is still processed.
- An unknown command currently returns no correlation id. Do not send another command until you have validated its `type` locally.
- A scheduled `prompt` or `abort_and_prompt` can acknowledge success and later emit a failure response with the same id if asynchronous scheduling fails.
- An extension runtime failure is an `extension_error` event, not a command response.
- A host that ignores `extension_ui_request`, `host_tool_call`, or `host_uri_request` can deadlock the operation that requested it. Dispatch these frames while other commands are pending.
- EOF is a deliberate disconnect. Unexpected process exit or broken stdout is a transport failure; any unresolved requests have unknown completion state.

## Transport versions and large frames

Protocol v1 is active at startup. It emits one JSON object per physical line and caps that line, including its newline, at the advertised `maxFrameBytes` (currently 1 MiB). Inbound frames are always single, unchunked JSONL objects and should stay below that limit.

Clients that can reassemble large outputs should negotiate v2 immediately after `ready`:

```json
{"id":"protocol-1","type":"negotiate_protocol","protocolVersion":2}
{"id":"protocol-1","type":"response","command":"negotiate_protocol","success":true,"data":{"protocolVersion":2}}
```

The success response itself is v1. Subsequent oversized logical stdout objects become an uninterrupted sequence of `rpc_chunk` frames:

```json
{"type":"rpc_chunk","chunkId":"rpc-1","index":0,"count":2,"byteLength":1200000,"data":"BASE64_DATA"}
```

For each sequence, validate that:

- `chunkId` is unchanged and non-empty;
- `index` starts at `0` and increments with no gaps;
- `count`, `byteLength`, and `chunkId` match on every chunk;
- no ordinary frame interrupts the sequence;
- decoded bytes do not exceed `maxReassembledFrameBytes` (currently 64 MiB);
- concatenated bytes equal `byteLength`, decode as strict UTF-8, and parse as one JSON object.

`data` is standard base64. Do not dispatch individual chunks as application events. A logical frame above the v2 ceiling becomes an explicit overflow frame instead.

In v1, oversized responses fail with `RPC response exceeded the transport limit`; other frames may be compacted or replaced by `rpc_frame_error`. An oversized `agent_end` can omit messages already delivered through `message_end` and add `messageCount`. Never use `agent_end.messages` as the only transcript store: collect message events or page history with `get_messages_page`.

## Public protocol reference

A `?` below means optional. All commands accept `id?: string`. If supplied, a normal response echoes it.

### Commands sent to stdin

| Area | `type` and fields | Successful `data` |
| --- | --- | --- |
| Protocol | `negotiate_protocol` — `protocolVersion: 2` | `{ protocolVersion: 2 }` |
| Prompt | `prompt` — `message: string`, `images?: ImageContent[]`, `streamingBehavior?: "steer" \| "followUp"` | optional `{ agentInvoked: boolean }` |
| Prompt | `steer` — `message`, `images?` | none |
| Prompt | `follow_up` — `message`, `images?` | none |
| Prompt | `abort` | none |
| Prompt | `abort_and_prompt` — `message`, `images?` | none |
| Session | `new_session` — `parentSession?: string` | `{ cancelled: boolean }` |
| State | `get_state` | `RpcSessionState` below |
| State | `set_fast_mode` — `enabled: boolean` | `{ enabled: boolean, active: boolean }` |
| State | `get_available_commands` | `{ commands: RpcAvailableSlashCommand[] }` |
| State | `set_todos` — `phases: TodoPhase[]` | `{ todoPhases: TodoPhase[] }` |
| Host | `set_host_tools` — `tools: RpcHostToolDefinition[]` | `{ toolNames: string[] }` |
| Host | `set_host_uri_schemes` — `schemes: RpcHostUriSchemeDefinition[]` | `{ schemes: string[] }` |
| Subagents | `set_subagent_subscription` — `level: "off" \| "progress" \| "events"` | `{ level }` |
| Subagents | `get_subagents` | `{ subagents: RpcSubagentSnapshot[] }` |
| Subagents | `get_subagent_messages` — `subagentId?: string`, `sessionFile?: string`, `fromByte?: number` | `RpcSubagentMessagesResult` |
| Model | `set_model` — `provider: string`, `modelId: string` | selected `Model` |
| Model | `cycle_model` | `{ model, thinkingLevel, isScoped } \| null` |
| Model | `get_available_models` | `{ models: Model[] }` |
| Thinking | `set_thinking_level` — `level: "inherit" \| "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"` | none |
| Thinking | `cycle_thinking_level` | `{ level: "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" } \| null` |
| Queue | `set_steering_mode` — `mode: "all" \| "one-at-a-time"` | none |
| Queue | `set_follow_up_mode` — same values | none |
| Queue | `set_interrupt_mode` — `mode: "immediate" \| "wait"` | none |
| Compaction | `compact` — `customInstructions?: string` | `CompactionResult` |
| Compaction | `set_auto_compaction` — `enabled: boolean` | none |
| Retry | `set_auto_retry` — `enabled: boolean` | none |
| Retry | `abort_retry` | none |
| Shell | `bash` — `command: string` | `BashResult` |
| Shell | `abort_bash` | none |
| Session | `get_session_stats` | `SessionStats` |
| Session | `export_html` — `outputPath?: string` | `{ path: string }` |
| Session | `switch_session` — `sessionPath: string` | `{ cancelled: boolean }` |
| Session | `branch` — `entryId: string` | `{ text: string, cancelled: boolean }` |
| Session | `get_branch_messages` | `{ messages: Array<{ entryId: string, text: string }> }` |
| Session | `get_last_assistant_text` | `{ text: string \| null }` |
| Session | `set_session_name` — `name: string` | none |
| Session | `handoff` — `customInstructions?: string` | `{ savedPath?: string } \| null` |
| Messages | `get_messages` | `{ messages: AgentMessage[] }` |
| Messages | `get_messages_page` — `cursor?: string`, `limit?: number` | `{ messages, nextCursor?, totalMessages }` |
| Login | `get_login_providers` | `{ providers: Array<{ id, name, available, authenticated }> }` |
| Login | `login` — `providerId: string` | `{ providerId: string }` |

`get_messages_page` defaults to 100 messages and accepts limits from 1 through 256. Follow the opaque `nextCursor` until absent. Paging is snapshot-based: restart from no cursor after `stale_cursor`; wait for streaming/compaction to stop after `session_busy`.

### Shared input objects

`ImageContent`:

| Field | Type |
| --- | --- |
| `type` | literal `"image"` |
| `data` | base64-encoded image bytes |
| `mimeType` | MIME string such as `image/png` |
| `detail?` | `"auto" \| "low" \| "high" \| "original"` |
| `providerFile?` | `{ provider: "openai" \| "anthropic" \| "google", id?: string, uri?: string, expiresAt?: number }` |
| `url?` | HTTPS mirror of exactly the bytes in `data` |

`TodoPhase` is `{ name: string, tasks: TodoItem[] }`. A `TodoItem` is `{ content: string, status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked", blocker?: string }`.

`RpcHostToolDefinition` is `{ name: string, label?: string, description: string, parameters: JSONSchemaObject, hidden?: boolean, loadMode?: "essential" | "discoverable" }`. Sending `set_host_tools` replaces the previous host-tool set.

`RpcHostUriSchemeDefinition` is `{ scheme: string, description?: string, writable?: boolean, immutable?: boolean }`. Supply a scheme without `://`. Names are normalized to lowercase; `security` is reserved. Sending the command replaces the previous set.

### Response envelope

Every command produces one of:

```text
Success: { id?, type: "response", command: string, success: true, data?: any }
Failure: { id?, type: "response", command: string, success: false, error: string, code?: string }
```

Useful result objects have these exact fields:

- `CompactionResult`: `{ summary, shortSummary?, firstKeptEntryId, tokensBefore, details?, preserveData? }`.
- `BashResult`: `{ output, exitCode: number | undefined, cancelled, timedOut?, truncated, totalLines, totalBytes, outputLines, outputBytes, artifactId?, workingDir? }`. JSON serialization omits fields whose value is `undefined`.
- `SessionStats`: `{ sessionFile?, sessionId, userMessages, assistantMessages, toolCalls, toolResults, totalMessages, tokens: { input, output, reasoning, cacheRead, cacheWrite, total }, premiumRequests, cost, contextUsage? }`.
- `Model` is the model catalog object. `provider` and `id` are the stable selection keys; preserve unknown additional model metadata for forward compatibility.

`RpcSessionState` contains:

| Field | Type |
| --- | --- |
| `model?` | `Model` |
| `thinkingLevel` | thinking-level string or omitted |
| `isStreaming`, `isCompacting` | boolean |
| `steeringMode`, `followUpMode` | `"all" \| "one-at-a-time"` |
| `interruptMode` | `"immediate" \| "wait"` |
| `sessionFile?`, `sessionId`, `sessionName?` | string |
| `autoCompactionEnabled` | boolean |
| `fastModeEnabled`, `fastModeActive` | boolean |
| `tokensPerSecond` | number or `null` |
| `messageCount`, `queuedMessageCount` | number |
| `todoPhases` | `TodoPhase[]` |
| `systemPrompt?` | `string[]` |
| `dumpTools?` | array of `{ name, description, parameters, examples? }` |
| `contextUsage?` | `{ tokens: number, contextWindow: number, percent: number }` |

`RpcAvailableSlashCommand` is `{ name, source, aliases?, description?, input?: { hint? }, subcommands?: Array<{ name, description?, usage? }> }`. `source` is `"builtin"`, `"skill"`, `"extension"`, `"custom"`, `"mcp_prompt"`, or `"file"`.

### Agent messages

Events and history responses carry `AgentMessage` objects. Consumers should switch on `role` and preserve unknown roles because extensions can add message variants.

| `role` | Core fields |
| --- | --- |
| `user` | `content: string \| (TextContent \| ImageContent)[]`, `timestamp`, plus optional attribution/transport metadata |
| `developer` | same content forms and `timestamp` |
| `assistant` | `content: ContentBlock[]`, `api`, `provider`, `model`, `usage`, `stopReason`, `timestamp`, plus optional error, timing, recovery, and provider metadata |
| `toolResult` | `toolCallId`, `toolName`, `content`, `isError`, `timestamp`, optional `details` |
| `bashExecution` | `command`, `output`, `exitCode?`, `cancelled`, `truncated`, `timestamp`, optional `meta`, `excludeFromContext` |
| `pythonExecution` | `code`, `output`, `exitCode?`, `cancelled`, `truncated`, `timestamp`, optional `meta`, `excludeFromContext` |
| `custom` | `customType`, `content`, `display`, `details?`, `timestamp` |
| `hookMessage` | legacy shape matching `custom` |
| `fileMention` | `files: Array<{ path, content, lineCount?, byteSize?, skippedReason?, image? }>`, `timestamp` |
| `branchSummary` | `summary`, `fromId`, `timestamp` |
| `compactionSummary` | `summary`, `shortSummary?`, `tokensBefore`, `tokensAfter?`, `method?`, `blocks?`, `images?`, `warning?`, `timestamp` |

The common content blocks are:

- `{ type: "text", text: string, textSignature?: string }`
- `{ type: "thinking", thinking: string, thinkingSignature?: string, itemId?: string }`
- `{ type: "redactedThinking", data: string }`
- `ImageContent`
- `{ type: "toolCall", id: string, name: string, arguments: object, intent?: string, …opaque replay metadata }`
- `{ type: "fallback", from: { model: string }, to: { model: string } }`
- `{ type: "anthropicServerTool", block: object }` for provider-native server tool replay

Provider-specific assistant blocks can also appear. Ignore blocks you do not render, but retain them if you persist and replay protocol data.
Assistant `usage` is `{ input, output, cacheRead, cacheWrite, totalTokens, contextTokens?, orchestration?, premiumRequests?, reasoningTokens?, cttl?, server?, cost: { input, output, cacheRead, cacheWrite, total } }`. `stopReason` is `"stop"`, `"length"`, `"toolUse"`, `"error"`, or `"aborted"`.

## Event and notification schema

### Agent lifecycle events

| `type` | Fields after `type` |
| --- | --- |
| `agent_start` | none |
| `agent_end` | `messages: AgentMessage[]`, `isTerminal?: boolean`, `telemetry?: object`, `coverage?: object`; transport compaction may also add `messageCount` |
| `turn_start` | none |
| `turn_end` | `message: AgentMessage`, `toolResults: ToolResultMessage[]` |
| `message_start` | `message: AgentMessage` |
| `message_update` | `message: AgentMessage`, `assistantMessageEvent: AssistantMessageEvent` |
| `message_end` | `message: AgentMessage` |
| `tool_execution_start` | `toolCallId`, `toolName`, `args`, `intent?` |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult` |
| `tool_execution_end` | `toolCallId`, `toolName`, `result`, `isError?` |

`AssistantMessageEvent` is one of:

| Event `type` | Other fields |
| --- | --- |
| `start` | `partial: AssistantMessage` |
| `text_start` | `contentIndex`, `partial` |
| `text_delta` | `contentIndex`, `delta: string`, `partial` |
| `text_end` | `contentIndex`, `content: string`, `partial` |
| `thinking_start` | `contentIndex`, `partial` |
| `thinking_delta` | `contentIndex`, `delta: string`, `partial` |
| `thinking_end` | `contentIndex`, `content: string`, `partial` |
| `image_end` | `contentIndex`, `content: ImageContent`, `partial` |
| `toolcall_start` | `contentIndex`, `partial` |
| `toolcall_delta` | `contentIndex`, `delta: string`, `partial` |
| `toolcall_end` | `contentIndex`, `toolCall`, `partial` |
| `done` | `reason: "stop" \| "length" \| "toolUse"`, `message: AssistantMessage` |
| `error` | `reason: "aborted" \| "error"`, `error: AssistantMessage` |

The spelling is `toolcall_*`, without an underscore between `tool` and `call`.

### Session events

| `type` | Fields after `type` |
| --- | --- |
| `auto_compaction_start` | `reason: "threshold" \| "overflow" \| "idle" \| "incomplete"`, `action: "context-full" \| "remote" \| "handoff" \| "shake" \| "snapcompact"` |
| `auto_compaction_end` | `action`, `result?: CompactionResult`, `aborted`, `willRetry`, `errorMessage?`, `skipped?` |
| `auto_retry_start` | `attempt`, `maxAttempts`, `delayMs`, `errorMessage`, `errorId?` |
| `auto_retry_end` | `success`, `attempt`, `finalError?`, `retryErrors?` |
| `retry_fallback_applied` | `from`, `to`, `role` |
| `retry_fallback_succeeded` | `model`, `role` |
| `model_changed` | none; call `get_state` if you need the new model |
| `thinking_level_changed` | `thinkingLevel?`, `configured?`, `resolved?` |
| `ttsr_triggered` | `rules: Rule[]` |
| `todo_reminder` | `todos: TodoItem[]`, `attempt`, `maxAttempts` |
| `todo_auto_clear` | none |
| `irc_message` | `message: CustomMessage` |
| `notice` | `level: "info" \| "warning" \| "error"`, `message`, `source?` |
| `goal_updated` | `goal: Goal \| null`, `state?: GoalModeState` |

### Other stdout frames

| `type` | Fields and action |
| --- | --- |
| `ready` | `protocolVersion: 1`, `supportedProtocolVersions: [1,2]`, `maxFrameBytes`, `maxReassembledFrameBytes` |
| `response` | command result envelope described above |
| `rpc_chunk` | `chunkId`, `index`, `count`, `byteLength`, `data`; reassemble before dispatch |
| `rpc_frame_error` | `error`, `originalType?`; a logical output could not fit the active transport |
| `prompt_result` | `id?`, `agentInvoked: boolean`; currently emitted for local-only completion |
| `available_commands_update` | `commands: RpcAvailableSlashCommand[]`; emitted at startup and when metadata changes |
| `command_output` | `text: string`; output from a locally handled slash command |
| `session_info_update` | `title?`, `sessionId`; session metadata changed |
| `config_update` | `model?`, `thinkingLevel?`; a local command changed configuration |
| `extension_error` | `extensionPath`, `event`, `error` |
| `extension_ui_request` | UI sub-protocol below |
| `host_tool_call`, `host_tool_cancel` | host-tool sub-protocol below |
| `host_uri_request`, `host_uri_cancel` | host-URI sub-protocol below |
| `subagent_lifecycle`, `subagent_progress`, `subagent_event` | subscription-gated subagent frames below |

Unknown event types should be ignored or logged, not treated as a fatal protocol error. New optional fields and event types can be added without changing the transport version.

## Extension UI sub-protocol

All requests have `type: "extension_ui_request"` and an `id`. Only `select`, `confirm`, `input`, and `editor` expect a value response. Fire-and-forget presentation methods need no response.

| `method` | Request fields |
| --- | --- |
| `select` | `title`, `options: string[]`, `optionDetails?: Array<{ description?: string }>`, `timeout?` |
| `confirm` | `title`, `message`, `timeout?` |
| `input` | `title`, `placeholder?`, `timeout?` |
| `editor` | `title`, `prefill?`, `promptStyle?` |
| `cancel` | `targetId` |
| `notify` | `message`, `notifyType?: "info" \| "warning" \| "error"` |
| `setStatus` | `statusKey`, `statusText?` |
| `setWidget` | `widgetKey`, `widgetLines?: string[]`, `widgetPlacement?: "aboveEditor" \| "belowEditor"` |
| `setTitle` | `title`; suppressed unless `PI_RPC_EMIT_TITLE=1` |
| `set_editor_text` | `text` |
| `open_url` | `url`, `launchUrl?`, `instructions?`; prefer `launchUrl` as the copy/open target when supplied |

Reply on stdin with the same `id`:

```text
Text/select/editor: { type: "extension_ui_response", id, value: string }
Confirmation:       { type: "extension_ui_response", id, confirmed: boolean }
Cancel/timeout:      { type: "extension_ui_response", id, cancelled: true, timedOut?: boolean }
```

An unknown response id is ignored. When a request carries `timeout`, the host should enforce it and return the cancellation form with `timedOut: true`.

OAuth `login` emits `open_url`, may emit notification frames, and can then ask for a pasted redirect or code with `input`. Providers that require interactive input before producing a URL are rejected in RPC mode; log in through interactive omp instead.

## Host tools and host URIs

After `set_host_tools`, omp can ask your process to execute a registered tool:

```json
{"type":"host_tool_call","id":"host-1","toolCallId":"toolu-1","toolName":"lookup_ticket","arguments":{"id":42}}
```

You may stream zero or more updates, then must complete the same id:

```json
{"type":"host_tool_update","id":"host-1","partialResult":{"content":[{"type":"text","text":"looking up ticket"}]}}
{"type":"host_tool_result","id":"host-1","result":{"content":[{"type":"text","text":"ticket 42 is open"}]}}
```

`partialResult` and `result` are `{ content: Array<TextContent | ImageContent>, details?: any, isError?: boolean, providerMetadata?: object, useless?: boolean }`. Set top-level `isError: true` on `host_tool_result` to reject the pending call and surface the returned content as a tool error. `host_tool_cancel` is `{ type, id, targetId }`; stop the operation identified by `targetId`.

After `set_host_uri_schemes`, omp routes reads and allowed writes of those schemes to your process:

```text
Read:  { type: "host_uri_request", id, operation: "read", url }
Write: { type: "host_uri_request", id, operation: "write", url, content }
Cancel:{ type: "host_uri_cancel", id, targetId }
```

Reply with:

```text
Success read:  { type: "host_uri_result", id, content, contentType?, notes?, immutable? }
Success write: { type: "host_uri_result", id }
Failure:       { type: "host_uri_result", id, isError: true, error?: string, content?: string }
```

`contentType` is `"text/markdown"`, `"application/json"`, or `"text/plain"` and defaults to plain text. Successful reads require `content`. A result-level `immutable` overrides the registered scheme for that read. The `edit` tool does not edit host URIs; register the scheme as writable to let full-replacement writes use the `write` path.

## Subagent frames

Forwarding defaults to `off`:

- `progress` emits `subagent_lifecycle` and `subagent_progress`.
- `events` also emits every nested `subagent_event`.

`subagent_lifecycle.payload` is `{ id, agent, agentSource, description?, status: "started" | "completed" | "failed" | "aborted", sessionFile?, parentToolCallId?, index, detached? }`.

`subagent_progress.payload` is `{ index, agent, agentSource, task, parentToolCallId?, assignment?, progress, sessionFile?, detached? }`. `progress` includes identity/status, recent tool/output summaries, counts, tokens, cost, duration, model selection, and optional retry state. Treat newly added progress metrics as optional.

`subagent_event.payload` is `{ id, event: AgentSessionEvent }`, where `event` uses the same lifecycle schema above.

`RpcSubagentSnapshot` returned by `get_subagents` is `{ id, index, agent, agentSource, description?, status, task?, assignment?, sessionFile?, lastUpdate, progress?, parentToolCallId? }`.

`RpcSubagentMessagesResult` is `{ sessionFile, fromByte, nextByte, reset, entries, messages }`. Select by `subagentId` or `sessionFile`; `fromByte` enables incremental reads. If the transcript shrank beneath `fromByte`, the server restarts at byte zero and sets `reset: true`.

## Host implementation checklist

A robust language-neutral client should:

1. Spawn one process per independently controlled session and wait for `ready`.
2. Keep stdin writes serialized, newline-terminated, and flushed.
3. Continuously read stdout while requests are pending; never wait for one response before servicing callbacks.
4. Generate unique string ids and correlate responses by id, not arrival order.
5. Track prompt acceptance separately from terminal or local-only completion.
6. Negotiate v2 and strictly reassemble chunks when large messages are possible.
7. Dispatch extension UI, host tool, and host URI requests without blocking the reader.
8. Preserve unknown fields, message roles, content blocks, and event types for forward compatibility.
9. Close stdin, then wait for process exit during orderly shutdown.
