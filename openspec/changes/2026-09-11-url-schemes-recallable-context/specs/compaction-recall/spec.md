# compaction-recall Specification — Delta

## ADDED Requirements

### Requirement: Compaction manifest with nested chain
The system SHALL expose the compaction manifest of the live session, one entry per successful compaction episode, each carrying: `label` (the `compaction/summary` event seq), `checkpoint_seq` (summary seq + 1), `compactionId`, timestamp, `shadowedRange`, `shadowedItems`, `shadowedTokenCount`, `replaces_checkpoint` (the previous episode's checkpoint seq when absorbed, else null), and an 8-section summary preview (≤100 chars per section).

#### Scenario: Manifest reflects nested compaction
- **WHEN** a session has two successful compactions where the second absorbed the first's checkpoint
- **THEN** the manifest lists both episodes and the second entry carries `replaces_checkpoint` equal to the first episode's checkpoint seq

### Requirement: Label resolution precedes ordinal
For any bracket-addressed collection, the system SHALL match the label (the element's immutable seq coordinate) exactly first, and SHALL fall back to the 0-based ordinal only when no label matches. Compaction episodes SHALL use the `compaction/summary` event seq as label; failed compactions SHALL NOT appear in any collection because they never emit a summary event.

#### Scenario: Failed compaction is not addressable
- **WHEN** a compaction attempt fails (summary not smaller than shadowed content) and the model reads the compactions manifest
- **THEN** the failed episode is absent from the manifest and has no addressable label

### Requirement: Canonical and prepared faces for compaction episodes
For `ctx://session/compactions[<label>]`, the bare URL SHALL return the episode's structured summary (all 8 sections verbatim) as the prepared default face, and `:raw` SHALL return the episode's canonical content — the original shadowed span derived from `shadowedSeqs` (role + content per item). Line windows SHALL always apply to the canonical content, and the composite `:raw:<lines>` form SHALL be valid and equal `:<lines>`. The former `/original` sub-path SHALL be removed — it was identical to `:raw` and is superseded by composing the `:raw` / `:N-M` selectors directly on the episode; a path using it SHALL be rejected with the structured `CTX_BAD_PATH` error echoing the URL. When an unwindowed `:raw` read of the canonical face exceeds 65536 chars, the system SHALL append an actionable note naming `:N-M` line-window paging; windowed reads (`:N-M`, `:raw:N-M`) and the bare prepared face SHALL NOT carry the note.

#### Scenario: Recall of the original span behind a summary
- **WHEN** the model reads `ctx://session/compactions[221217]:raw` after the episode shadowed 559 items
- **THEN** the system returns the original message-level content of all shadowed items, including tool results and assistant messages

#### Scenario: Chained recall to pre-previous originals
- **WHEN** the model reads `ctx://session/compactions[109245]:raw` (the first episode in a nested chain)
- **THEN** the system returns the first span's original content even though later compactions shadowed its checkpoint

#### Scenario: Unwindowed raw recall of an oversized span pages explicitly
- **WHEN** the model reads `ctx://session/compactions[221217]:raw` and the span exceeds 65536 chars
- **THEN** the system returns the full span followed by a note naming `:N-M` line-window paging, while `:raw:N-M` / `:N-M` return the windowed lines without the note

#### Scenario: Removed /original sub-path
- **WHEN** the model reads `ctx://session/compactions[221217]/original`
- **THEN** the system rejects the path with `CTX_BAD_PATH`, echoing the URL

### Requirement: Recall is read-only and lazily materialized
The system SHALL serve all recall resources strictly read-only, SHALL build the episode index lazily from the session log (zstd-decompressed, single-pass seq index) with invalidation on session-file change, and SHALL NOT impose truncation on canonical content beyond the tool layer's own limits, surfacing an actionable truncation note instead.

#### Scenario: Oversized original request
- **WHEN** the model reads an original span exceeding the tool-layer response cap
- **THEN** the system returns the truncated head (or the requested line window) with a note naming the `:raw`/line-window addressing for the remainder
