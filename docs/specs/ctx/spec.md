# ctx Specification

## Purpose

Let the model read a curated, read-only snapshot of its calling environment via `ctx://` URLs — small, static, agent-derived facts (who am I, what model, what cwd) addressable like any other resource, plus a recallable-context navigation surface over the live session's event log. This replaces the v0.1.8c design that mapped `ctx://` onto persistent-kernel variables; see design.md D4 for why that semantics was wrong (the kernel namespace is the model's own REPL scratchpad, not its environment).

## Requirements

### Requirement: Coordinate invariant
Every number the system shows the model SHALL be either directly usable as a selector in the same URL family, or explicitly labeled metadata with its unit. The two coordinates are `seq` (event sequence, for `[<label|n>]` addressing) and `line` (transcript line, for `:N-M` windows and `grep` on `ctx://session/transcript`); both SHALL be labeled wherever shown. An unlabeled number that is not an addressable coordinate SHALL NOT appear.

#### Scenario: Labeled coordinates in the manifest
- **WHEN** the model reads `ctx://session/compactions`
- **THEN** every episode row carries `seq=<start>..<end>` and `lines=<start>..<end>` (or `lines=<none>` for an empty span), never a bare range that could be misread as the other unit

### Requirement: Curated snapshot keys
The system SHALL resolve `ctx://session` as the recallable-context statistics snapshot: the prepared default face SHALL carry the session header (absorbing the former identity fields `id`/`status`/`origin`/`delegationDepth`), storage facts, totals using native DSH field names, per-compaction segments plus a `live` tail segment (each with `seq_start`/`seq_end` and `lines`), the inline compactions manifest (label, checkpoint_seq, compactionId, `seq_start`/`seq_end`, `lines`, shadowedItems, shadowedTokenCount, `fidelity`, `replaces_checkpoint`, and an 8-section × ≤100-char summary preview per episode), an `asOf` card (max seq and transcript line at read time, with a note that totals are live values), and a `system_prompt` info card. The canonical face (see `:raw`) SHALL be the full session transcript. The first-level keys `model` and `cwd` SHALL be removed — their information SHALL appear only as info-card fields inside the snapshot. Any other first-level key SHALL return the structured `CTX_UNKNOWN_KEY` error listing the known keys and sub-paths.

#### Scenario: Reading session identity
- **WHEN** the model reads `ctx://session` from a delegated subagent session
- **THEN** the snapshot header carries the agent id, status, origin, and delegation depth

#### Scenario: Reading the model configuration
- **WHEN** the model reads `ctx://session`
- **THEN** the snapshot info card carries the provider, model, and maxTokens of the calling agent's request options

#### Scenario: Reading the working directory
- **WHEN** the model reads `ctx://session`
- **THEN** the session's creation working directory appears as an info-card field, not as a separate key

#### Scenario: Staleness is self-evident
- **WHEN** the model reads `ctx://session` and caches the snapshot
- **THEN** the `asOf` card tells it the seq and line the snapshot was taken at, so it cannot mistake a cached snapshot for live totals

#### Scenario: Unknown key
- **WHEN** the model reads `ctx://<other key>`
- **THEN** the system returns the structured `CTX_UNKNOWN_KEY` error naming the known keys and sub-paths

### Requirement: Bare listing
The system SHALL let bare `ctx://` return the roster of available resources and usage entry points (one per line), including the `session` root, the sub-path grammar pointer (naming the composite `:raw:N-M` form), and the `transcript`/`compactions`/`user_prompts`/`tool_calls`/`agent_responses`/`thinking`/`system`/`injections` sub-paths; the static portion SHALL not require a live agent, and the roster SHALL stay within its line budget (its previous size plus the three collection entries).

#### Scenario: Listing keys
- **WHEN** the model reads bare `ctx://`
- **THEN** the system returns the roster naming `session`, its sub-paths (including `thinking` and `system`), and the addressing-grammar pointer

### Requirement: Snapshot requires a live agent
The system SHALL read every snapshot value from the calling agent supplied in the resolver env; an env with no live agent returns the structured `CTX_NO_AGENT` error on any value read.

#### Scenario: No agent in the context
- **WHEN** a ctx:// value read runs with no live agent in the resolver env
- **THEN** the system returns the structured `CTX_NO_AGENT` error

### Requirement: ctx is strictly read-only
The system SHALL reject every write to `ctx://` with the structured `URL_READ_ONLY` error explaining the scheme is a curated read-only snapshot. There is no kernel-variable write channel and no variable mutation of any kind.

#### Scenario: Writing to a snapshot key
- **WHEN** the model writes to `ctx://<any key>`
- **THEN** the system returns the structured `URL_READ_ONLY` error and changes nothing

### Requirement: Session sub-path grammar
The system SHALL resolve `ctx://session/…` sub-paths: `transcript` (full transcript), `compactions` (manifest), `compactions[<label|ordinal>]` (the episode summary), `user_prompts[<n|seq>]`, `tool_calls[<n|seq>]`, `agent_responses[<n|seq>]`, `thinking[<n|seq>]` (reasoning blocks), and `system[<n|seq>]` (system messages). The former `compactions[<label|n>]/original` sub-path SHALL be removed — it was identical to `:raw` and is superseded by composing the `:raw` / `:N-M` selectors directly on the episode; a path using it SHALL be rejected with the structured `CTX_BAD_PATH` error echoing the URL. Bracket resolution SHALL match the label (the element's immutable seq coordinate) exactly first, and SHALL fall back to the 0-based ordinal on miss. The system SHALL support `:raw`, line windows (`:N`, `:N-M`, `:N+K`, `:N-`, comma-separated ranges), `:path/<dot-path>`, and `?q=<query>` on every resolved resource; the composite `:raw:<lines>` form SHALL be valid everywhere and SHALL equal `:<lines>` (the `:raw` prefix is redundant in a line-window context but MUST parse). Line windows on a compaction episode SHALL interpret numbers as transcript line coordinates (identical to the same window on `transcript`), and `:path/`/`?q=` SHALL apply to the bare (prepared) face.

#### Scenario: Drilling into a compaction episode by label
- **WHEN** the model reads `ctx://session/compactions[221217]`
- **THEN** the system returns that episode's structured summary (all 8 sections verbatim) or, for the latest episode, the navigation block (see digest residence)

#### Scenario: Ordinal fallback
- **WHEN** the model reads `ctx://session/compactions[0]` and no episode carries the label `0`
- **THEN** the system returns the first-recorded episode (0-based)

#### Scenario: Transcript-relative episode window
- **WHEN** the model reads `ctx://session/compactions[<label>]:5300-5310`
- **THEN** the system returns transcript lines 5300–5310 — the same bytes as `ctx://session/transcript:5300-5310`

#### Scenario: Composite raw selector
- **WHEN** the model reads `ctx://session/compactions[221217]:raw:500-560`
- **THEN** the system returns the same lines as `ctx://session/compactions[221217]:500-560`

#### Scenario: Removed /original sub-path
- **WHEN** the model reads `ctx://session/compactions[221217]/original`
- **THEN** the system returns the structured `CTX_BAD_PATH` error echoing the URL and naming the `:raw` / `:N-M` selectors as the replacement

### Requirement: Canonical and prepared content faces
The system SHALL treat every resource as having one canonical content: `:raw` SHALL return the canonical full content, line windows SHALL always apply to the canonical content, and the bare URL SHALL return the prepared default face when one is prepared (session → statistics snapshot; compaction episodes → digest/navigation block; `thinking`/`system`/`injections` and the element collections → index lists) or the canonical content when none is. `:raw:<lines>` SHALL equal `:<lines>` — the composite form is accepted on every resource. A line window that reaches past a resource's canonical extent SHALL return an explicit boundary note (e.g. `[ctx:// note: … span is transcript lines <s>-<e>]`) rather than silently returning a truncated or empty view.

#### Scenario: Line windows ignore the prepared face
- **WHEN** the model reads `ctx://session/compactions[221217]:500-560`
- **THEN** the system returns transcript lines 500–560 of the episode's original shadowed span, not of the summary

#### Scenario: Out-of-span window is explicit
- **WHEN** the model reads `ctx://session/compactions[221217]:5500` and the episode span ends before transcript line 5500
- **THEN** the system returns the boundary note naming the episode's span instead of an empty string

#### Scenario: Over-read notes, open tail does not
- **WHEN** the model reads a window whose upper bound exceeds the canonical extent (e.g. `transcript:1940-2000` on a 1947-line transcript)
- **THEN** the system returns the available lines plus the boundary note naming the canonical end — a partial over-read is still an over-read, because otherwise the model cannot tell "empty" from "does not exist"
- **WHEN** the model reads the open-tailed `transcript:1940-`
- **THEN** the system returns to the end of the content with no boundary note (an open tail is a deliberate read-to-end, not an over-read)

### Requirement: Episode digest residence
The system SHALL render the prepared face of the **latest** compaction episode as a navigation block (NOT the digest text, which is already resident in the model's live context as the compact-checkpoint message): it SHALL name the episode's `lines`/`seq`/items/tokens, its `fidelity`, the transcript lines where the resident digest lives (`digest resident at transcript:<start>-<end> (seq=<checkpointSeq>)`), and the landmark roster. The prepared face of every **older** episode SHALL return that episode's full digest (`summaryText`) followed by the same pointer block. `:raw` on any episode SHALL always return the full shadowed span, so a digest is never lost.

#### Scenario: Latest episode is a pointer, not a dump
- **WHEN** the model reads the bare URL of the most recent compaction episode
- **THEN** the system returns the navigation block with the digest's transcript location and landmarks, and does NOT repeat the digest text

#### Scenario: Older episode returns its digest
- **WHEN** the model reads the bare URL of a non-latest compaction episode
- **THEN** the system returns that episode's full digest followed by its pointer block

### Requirement: Landmark roster
The system SHALL include, in each compaction episode's navigation/pointer block, a direction-marker roster computed over that episode's shadowed events, every marker expressed as transcript line coordinates directly usable with `:N-M`: user-turn lines, failure lines (tool results with `message.isError` true or a present error), touched file paths with occurrence counts (best-effort, from tool-call arguments), and the count of prior checkpoints absorbed in the span. Rosters SHALL be capped to a screen and SHALL tail with `… +N more` when capped.

#### Scenario: Locating user turns and failures
- **WHEN** the model reads a compaction episode's prepared face
- **THEN** the landmark block lists user-turn lines and failure lines as transcript line numbers

#### Scenario: Locating touched files
- **WHEN** the model reads a compaction episode whose span contains file tool calls
- **THEN** the landmark block lists each touched path with its occurrence count

### Requirement: Fidelity signal
The system SHALL include, per compaction episode, a `fidelity=<user_turns>:<tool_calls>` figure (in the manifest, the snapshot, and the episode pointer block) so the model can judge whether the digest is trustworthy: a tool-heavy span's digest is trustworthy and detail is regenerable, while a user-intent-heavy span must be drilled into.

#### Scenario: Reading fidelity
- **WHEN** the model reads `ctx://session/compactions` or a compaction episode's prepared face
- **THEN** each episode carries its `fidelity` ratio

### Requirement: Thinking, system, and injections collections
The system SHALL expose three index-faced collections under `ctx://session/`, all following the canonical/prepared face model (bare URL = prepared index; `:raw` / `:N-M` = canonical full text):

- `thinking` — the reasoning blocks of `assistant/message` events (`message.content` blocks of `type: "reasoning"`, in event order; a message may carry several). The bare URL SHALL return an index list, one line per block: 0-based ordinal, event seq, turn/step, and a ≤100-char single-line preview. `[<n|seq>]` SHALL return that block's full text (label = the block's event seq, exact match first, 0-based ordinal fallback). `:raw` SHALL return all blocks' full text joined in event order with a blank line between blocks, and line windows SHALL index that canonical text.
- `system` — the session's `system/message` events (text from `data.text` when present, else the message content blocks; source kind/plugin from `data.source` when present). The bare URL SHALL return an index list, one line per message: event seq, source kind/plugin, and a ≤100-char single-line preview. `[<n|seq>]` SHALL return that message's full text. `:raw` SHALL return all messages' full text joined with a blank line between messages, and line windows SHALL index that canonical text.
- `injections` — the session's injected `user/message` events, i.e. every `user/message` whose `source.kind` is not `user` (agent instructions, runtime-context snapshots, …; the exact complement of the `user_prompts` collection). The bare URL SHALL return an index list, one line per message: event seq, source kind, and a ≤100-char single-line preview. `[<n|seq>]` SHALL return that message's full text rendered as `[<zero-padded seq>] INJECTED <kind>` followed by the content. `:raw` SHALL return all messages' full text joined with a blank line between messages, and line windows SHALL index that canonical text.

#### Scenario: Index then drill into a reasoning block
- **WHEN** the model reads `ctx://session/thinking` and then `ctx://session/thinking[2]`
- **THEN** the index lists one line per reasoning block (ordinal, seq, turn/step, preview) and the drilled read returns the third block's full text

#### Scenario: Canonical window over the joined blocks
- **WHEN** the model reads `ctx://session/thinking:10-20`
- **THEN** the system returns lines 10–20 of the reasoning blocks' full text joined with blank lines, ignoring the index face

#### Scenario: System message by seq label
- **WHEN** the model reads `ctx://session/system[7]` where event seq 7 is a system message
- **THEN** the system returns that message's full text

#### Scenario: Injections complement user_prompts
- **WHEN** the model reads `ctx://session/injections` in a session whose `user/message` events carry both `source.kind: "user"` and non-`user` sources (agent instructions, runtime snapshots)
- **THEN** the index lists only the non-`user` messages (seq, source kind, preview), `ctx://session/injections[<n|seq>]` returns one message's full text, and `ctx://session/user_prompts` continues to list only the real prompts

#### Scenario: Injection message by ordinal or seq
- **WHEN** the model reads `ctx://session/injections[0]` or `ctx://session/injections[<seq>]`
- **THEN** the system returns that injected message's full text with its `INJECTED <kind>` header line

### Requirement: Element collections carry index faces
The system SHALL give `user_prompts`, `tool_calls`, and `agent_responses` the same prepared-index/canonical model: the bare URL SHALL return an index list (one line per element: event seq and a ≤100-char preview; the long `tool_calls`/`agent_responses` collections SHALL cap the bare index at a screen and tail with `… +N more — use :raw for all, ?q= to filter, [n|seq] for one`); `[<n|seq>]` SHALL return that element's full text; `:raw` SHALL return all elements' full text joined; line windows SHALL index that canonical text. The error for an unaddressed or out-of-range element SHALL name the collection and its count and SHALL NOT echo an empty-bracket URL.

#### Scenario: Browsing user prompts
- **WHEN** the model reads `ctx://session/user_prompts`
- **THEN** the system returns an index list of the real user prompts (seq + preview)

#### Scenario: Addressing a tool call
- **WHEN** the model reads `ctx://session/tool_calls[<seq>]`
- **THEN** the system returns that call's name, arguments, and result — where a present result's text is rendered from either the flat or the nested content-block shape, never silently empty

### Requirement: Unknown key echoes known keys
The `CTX_UNKNOWN_KEY` error SHALL list the currently known first-level keys and the sub-path pointer, so the model can self-correct without leaving the read tool.

#### Scenario: Unknown key with roster echo
- **WHEN** the model reads `ctx://bogus`
- **THEN** the system returns `CTX_UNKNOWN_KEY` naming `session` and the sub-path roster

