<!--
source: https://omp.sh/docs/session-format
fetched: 2026-09-06
-->

# Session format

> Parse, archive, migrate, and inspect omp's saved JSONL sessions without confusing durable records with live runtime state.

omp saves a session as newline-delimited JSON (JSONL): one JSON object per physical line. You may encounter it when auditing a conversation, building an exporter, moving sessions between machines, or recovering a damaged file.

The safest first step is read-only inspection. Find sessions under the omp data directory, then copy the JSONL file before transforming it:

```bash
find ~/.omp/agent/sessions -name '*.jsonl' -print
jq -c . ~/.omp/agent/sessions/<project>/<session>.jsonl
```

On a default installation the root is `~/.omp/agent/sessions`. XDG or agent-directory configuration can relocate it. Project directory names are an implementation detail; discover files rather than constructing their paths. A normal interactive filename is `<filesystem-safe-timestamp>_<session-id>.jsonl`. Subagent sessions can instead appear beneath the parent session's sibling artifact directory.

Treat a live file as a journal: read it without locking, tolerate a final incomplete line, and retry that line after the turn finishes. For a durable archive or migration, close the owning omp process and copy the JSONL together with the blob store described under [Portability and redaction](#portability-and-redaction). Do not edit a session in place while omp is running. Although most records are appended, omp can rewrite a file during migration or maintenance, and its fixed-width title record is intentionally updated in place.

For user-facing resume, branch, and sharing workflows, see [Sessions](/docs/sessions).

## Physical file layout

A newly written version 3 file normally has this order:

1. an optional fixed-width `title` record (current omp writes it);
2. exactly one `session` header;
3. zero or more tree entries.

Each object occupies one line. Blank or malformed lines are not part of the format. omp's reader skips malformed records, but a writable resume can later rewrite the file without them, so repair a copy rather than relying on that recovery behavior.

### Mutable title record

The physical first line is 256 UTF-8 bytes including its newline. Padding lives inside the JSON string, so it is still valid JSON:
The `pad` value below is shortened for readability.

```json
{"type":"title","v":1,"title":"refactor importer","source":"user","updatedAt":"2026-05-14T10:14:22.000Z","pad":"                                  "}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"title"` | Physical title-slot discriminator. |
| `v` | `1` | Title-record format version, separate from the session schema version. |
| `title` | string | Current title; may be empty and may be truncated to fit the slot. |
| `source` | `"auto"` \| `"user"`? | Whether omp or the user selected it. |
| `updatedAt` | string | ISO 8601 update time. |
| `pad` | string | Space padding used to keep the record exactly 256 bytes. Ignore it. |

Legacy files can begin directly with the `session` header. A parser should recognize the title record by both `type: "title"` and `v: 1`, remove it from the logical entry stream, and overlay its `title` and `source` on the header metadata. Do not assume the first physical object is the header.

## Session header (version 3)

The current logical format version is **3**. The first logical object is:

```json
{"type":"session","version":3,"id":"019700f1-1a2b-7c3d-8e4f-aabbccddeeff","timestamp":"2026-05-14T10:12:03.000Z","cwd":"/Users/me/src/api","additionalDirectories":["/Users/me/src/shared"],"title":"refactor importer","titleSource":"user"}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `"session"` | Header discriminator. |
| `version` | number? | Schema version. Missing means version 1; current writers emit `3`. |
| `id` | string | Session identity. Current writers use a UUIDv7; treat it as opaque. |
| `timestamp` | string | ISO 8601 creation time. |
| `cwd` | string | Absolute primary working directory when saved. |
| `additionalDirectories` | string[]? | Absolute additional roots in a multi-root workspace. |
| `title` | string? | Header title, overridden logically by a recognized physical title record. |
| `titleSource` | `"auto"` \| `"user"`? | Source of the header title. |
| `parentSession` | string? | Lineage only: a source session ID for a full fork, or a source JSONL path for a branch copied into a new file. |
| `previousSessionFiles` | string[]? | Prior absolute JSONL locations recorded after successful moves. |
| `providerPromptCacheKey` | string? | Opaque provider replay/cache identity. Preserve but do not interpret or generate it. |

Version 1 had no `version` and was linear. Loading it assigns entry IDs and parent links. Version 2 already had the tree envelope; version 3 renamed the legacy `hookMessage` role during migration. omp migrates older files in memory and may rewrite them on the next writable operation. Reject a future version only if your integration cannot preserve unknown data; otherwise retain unknown fields and records.

## Tree entry envelope and branches

Every logical object after the header is an entry with this common envelope:

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | string | Entry discriminator. |
| `id` | string | Entry identity. Usually an 8-character hexadecimal ID, but the collision fallback and imported data mean parsers must treat it as an opaque non-empty string. |
| `parentId` | string \| `null` | Previous entry on this branch; `null` starts a root path. |
| `timestamp` | string | ISO 8601 persistence time. This differs from message-level timestamps, which are Unix milliseconds. |

The array order is journal order, not a flattened conversation. Build an `id → entry` map, then a `parentId → children` map. A branch is the ancestor chain obtained by following `parentId` from a chosen leaf to `null` and reversing the result. Multiple children of one parent are sibling branches.

The file does **not** persist a separate active-leaf field. On load, omp initially derives the leaf from the last logical entry in file order; interactive tree navigation can select a different leaf only in memory. The next appended entry uses that selected entry as its parent and then becomes the last record. Therefore:

- do not infer the current branch from timestamps alone;
- do not assume every record belongs to one linear transcript;
- detect duplicate IDs, missing parents, self-links, and longer cycles;
- preserve file order when round-tripping, because it supplies the initial leaf.

`parentSession` relates files, while `parentId` relates entries inside one file. Neither guarantees that the referenced source still exists.

## Message entries

A message entry wraps one durable agent message:

```jsonl
{"type":"message","id":"1f9d2a0b","parentId":null,"timestamp":"2026-05-14T10:12:05.000Z","message":{"role":"user","content":[{"type":"text","text":"refactor the importer to stream"}],"timestamp":1778753525000}}
{"type":"message","id":"1f9d2b0c","parentId":"1f9d2a0b","timestamp":"2026-05-14T10:12:06.000Z","message":{"role":"assistant","content":[{"type":"text","text":"Reading the file first."},{"type":"toolCall","id":"toolu_01","name":"read","arguments":{"path":"src/importer.ts"}}],"api":"anthropic-messages","provider":"anthropic","model":"claude-opus-4-6","usage":{"input":1200,"output":45,"cacheRead":0,"cacheWrite":0,"totalTokens":1245,"cost":{"input":0.01,"output":0.01,"cacheRead":0,"cacheWrite":0,"total":0.02}},"stopReason":"toolUse","timestamp":1778753526000}}
{"type":"message","id":"1f9d2c0d","parentId":"1f9d2b0c","timestamp":"2026-05-14T10:12:07.000Z","message":{"role":"toolResult","toolCallId":"toolu_01","toolName":"read","content":[{"type":"text","text":"file contents"}],"isError":false,"timestamp":1778753527000}}
```

### Message roles

| Role | Required shape | Common optional persisted data |
| --- | --- | --- |
| `user` | `content: string \| (text \| image)[]`, `timestamp: number` | `synthetic`, `steering`, `attribution`, opaque `providerPayload` |
| `developer` | same content and timestamp shape as user | `attribution`, opaque `providerPayload` |
| `assistant` | `content: block[]`, `api`, `provider`, `model`, `usage`, `stopReason`, `timestamp: number` | response/error IDs and details, duration/TTFT, context snapshot, retry recovery, disabled features, opaque `providerPayload` |
| `toolResult` | `toolCallId`, `toolName`, `content: (text \| image)[]`, `isError`, `timestamp: number` | `details`, `attribution`, `prunedAt`, `useless`, provider metadata |

Current `stopReason` values are `stop`, `length`, `toolUse`, `error`, and `aborted`. The assistant's `usage`, error metadata, provider payloads, signatures, and tool `details` evolve with providers and tools. Preserve unknown keys; consumers that only need a transcript can ignore them.

### Content blocks

| `type` | Where used | Core fields |
| --- | --- | --- |
| `text` | user, developer, assistant, tool result | `text: string`; optional opaque `textSignature` |
| `image` | user, developer, assistant, tool result | `data: string`, `mimeType: string`; optional `detail`, provider file reference, or URL |
| `thinking` | assistant | `thinking: string`; optional opaque `thinkingSignature` and `itemId` |
| `redactedThinking` | assistant | opaque `data: string` |
| `toolCall` | assistant | `id: string`, `name: string`, `arguments: object`; optional signatures, intent, raw/provider metadata |
| `fallback` | assistant | provider-specific `{ from: { model }, to: { model } }` boundary |
| `anthropicServerTool` | assistant | opaque, provider-native `block` retained for replay |

Pair a `toolResult` message with a `toolCall` block by `message.toolCallId === block.id`; adjacency is not sufficient on a branched path. A dangling call can be a live call, an interrupted turn, or a call whose result exists only on a sibling branch.

Message content can contain secrets, source text, command output, images, signed reasoning, and provider replay payloads. It is not a sanitized transcript.

## Non-message entry types

All of these include the common tree envelope.

| Type | Persisted payload and interpretation |
| --- | --- |
| `thinking_level_change` | `thinkingLevel?: string \| null`, `configured?: string \| null`. The latest value on the selected path affects later turns. |
| `model_change` | `model: "provider/model"`, optional `role`, optional `resolvedModelIsFallback`. Role defaults to `default`; `fallback` is an ephemeral retry role. |
| `service_tier_change` | `serviceTier: object \| null`. Preserve the provider-family mapping; do not assume one scalar tier. |
| `mode_change` | `mode: string` (`none` exits a mode), optional mode-specific `data`. |
| `compaction` | `summary`, `firstKeptEntryId`, `tokensBefore`; optional `shortSummary`, `tokensAfter`, `method`, replay marker, `details`, `preserveData`, `fromExtension`, `warning`. It records a context rewrite; it does not delete the older journal entries. |
| `branch_summary` | `fromId`, `summary`; optional `details`, `fromExtension`. It summarizes an abandoned path and is itself a child on the new path. |
| `reset_boundary` | No payload. `/clear` uses it as a durable boundary for rebuilt live context, while the complete persisted history remains available to transcript exports. |
| `label` | `targetId`, `label?: string`. A non-empty label sets/replaces the target label; an absent label removes it. Resolve labels in file order. |
| `title_change` | `title`, optional `previousTitle`, `source: "auto" \| "user"`, optional `trigger`. Append-only audit history; the physical title record supplies the current title efficiently. |
| `ttsr_injection` | `injectedRules: string[]`. Durable rule bookkeeping for the selected path. |
| `credential_pin` | `provider`, `hash`. This is a pseudonymous credential/scope digest used for replay affinity—not a secret and not anonymous. |
| `session_init` | Subagent replay/debug metadata: `systemPrompt`, `task`, `tools`, plus optional agent/model, schema, tool restriction, spawn, read-summary, and advisor fields. It can contain highly sensitive prompts and tasks. |

Some entries affect reconstructed model context (`message`, compaction and branch summaries, resets, mode/model/thinking changes); others are metadata. That behavior is runtime policy, not a promise that every persisted object will appear verbatim in the visible transcript.

## Extension-owned entries

Extensions have two public persistence shapes:

```jsonl
{"type":"custom","id":"a1b2c3d4","parentId":"1f9d2c0d","timestamp":"2026-05-14T10:12:08.000Z","customType":"com.example.review-state","data":{"approved":true}}
{"type":"custom_message","id":"b2c3d4e5","parentId":"a1b2c3d4","timestamp":"2026-05-14T10:12:09.000Z","customType":"com.example.policy","content":"Use the approved migration plan.","display":true,"details":{"policyVersion":2},"attribution":"agent"}
```

- `custom` has `customType: string` and optional JSON `data`. It persists extension state and does not enter model context.
- `custom_message` has `customType`, `content: string | (text | image)[]`, `display: boolean`, optional JSON `details`, and optional `attribution: "user" | "agent"`. It does participate in model context; `display` controls whether the TUI renders it.

Namespace `customType` (for example, with a reverse domain), version your payload inside `data` or `details`, and tolerate versions you do not understand. Third-party parsers should preserve unknown entry types instead of treating the current built-in list as exhaustive.

## Persistence limits and sidecar blobs

The JSONL is a durable replay journal, not always a byte-for-byte dump of runtime objects:

- most strings longer than 500,000 characters are truncated with a persistence notice;
- signed/encrypted/provider-native replay blocks are kept intact when truncating them would break replay;
- transient `jsonlEvents` data is stripped;
- sufficiently large image payloads are externalized from `image.data` (and some nested image fields) as `blob:sha256:<64-lowercase-hex>` references.

Blob bytes live in the omp blob store, normally `~/.omp/agent/blobs/<sha256>`. The hash is over raw binary bytes. A standalone JSONL copy can therefore be incomplete even though it parses correctly. Preserve the entire blob store or copy every referenced extensionless hash file. Reject malformed blob references rather than interpreting their suffix as a path.

## Portability and redaction

For a faithful migration:

1. stop or detach the process writing the session;
2. copy the JSONL without changing record order or opaque fields;
3. copy referenced blobs;
4. decide whether absolute paths in `cwd`, `additionalDirectories`, `parentSession`, and `previousSessionFiles` should be remapped;
5. open the copy from its new location and verify its tree before deleting the source.

The filename's session ID normally matches `header.id`, but importers should validate rather than derive identity solely from the filename. `parentSession` and previous file paths are provenance and may remain stale after a move.

Before sharing, assume sensitive data exists in all of these places:

- user/developer messages, tool arguments, tool results, and custom entries;
- assistant thinking, redacted/encrypted blocks, provider payloads, and error text;
- `session_init` system prompts and tasks;
- absolute paths and titles;
- image blobs and provider-native file/response identifiers;
- `credential_pin.hash`, which is linkable when its input is guessable.

Redaction can invalidate signed reasoning, encrypted replay history, tool-call/result pairing, compaction references, or blob hashes. Export a deliberately lossy transcript when replay is unnecessary. If replay matters, redact structurally on a copy, preserve IDs and parent links, remove whole sensitive block pairs where appropriate, and expect provider cache/replay metadata to become unusable.

## Validation and troubleshooting

A practical validator should report, rather than silently repair:

1. every nonblank physical line is a JSON object;
2. an optional first object is a valid `title` v1 record;
3. the first logical object is `type: "session"` with a string `id`;
4. the version is supported (missing is legacy v1; current is 3);
5. every later object has string `type`, string `id`, string `timestamp`, and `parentId` that is a string or `null`;
6. entry IDs are unique, and every non-null parent resolves;
7. parent traversal terminates without a cycle;
8. referenced `firstKeptEntryId`, `targetId`, and tool-call IDs resolve where their semantics require it;
9. every canonical blob reference has a corresponding hash file;
10. the final logical record is recorded as the default resume leaf.

Useful read-only checks:

```bash
# Parse every physical record and show its discriminator.
jq -r '.type' session.jsonl

# Keep file order while inspecting tree links.
jq -c 'select(.id and has("parentId")) | {type,id,parentId,timestamp}' session.jsonl

# List external blob references conservatively.
grep -o 'blob:sha256:[a-f0-9]\{64\}' session.jsonl | sort -u
```

If jq fails only on the last line of a live session, wait for the writer and retry. If omp reports malformed records, preserve the original, identify the bad physical lines, and repair a copy. If a session opens on an unexpected branch, inspect the last logical entry and its ancestor chain. If images are missing after migration, restore the referenced blob hashes. If an older file changes after resume, that can be the normal version/title-slot migration rather than evidence that JSONL is strictly append-only.

## Persisted data versus runtime state

Persisted and reconstructible:

- header/workspace metadata and file lineage;
- the ordered entry tree, messages, labels, reset boundaries, summaries, and extension records;
- recorded model, mode, thinking, tier, credential-affinity, usage, and provider replay metadata on each branch;
- the default leaf implied by the final logical record.

Not represented as stable file-format state:

- an interactively selected leaf that has not caused an append;
- in-flight streaming deltas, pending tool execution state, queues, locks, and open writer handles;
- the exact generated model context or visible TUI transcript (both are reconstructed according to current runtime policy);
- live authentication secrets, provider connections, extension code, tool implementations, and current configuration;
- guarantees that opaque provider metadata remains usable with another account, provider, or omp version.

Integrations should parse the durable tree and declared payloads, preserve what they do not understand, and avoid treating a saved file as a serialized session-manager process.
