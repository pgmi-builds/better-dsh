## MODIFIED Requirements

### Requirement: Hashline edit family registered on the agent's own layer

The system SHALL register the vendored hashline edit family on each agent's own scope layer at session start — `edit` (hash-anchored ordered edit tuples, shadowing the preset's built-in edit by nearest-layer resolution, no mask entry needed) and `undo_last_edit` (revert of the most recent hashline edit) — alongside the URL-aware read/write/grep/glob wrappers, unwinding with the agent. The write tool SHALL remain the upstream full-file write with its native confirmation envelope: no hook SHALL append a hashline preview to write results, and the hashline guidance SHALL NOT promise post-write anchors (the model MAY edit directly using anchors derived from the content it just wrote, or read first). The hashline guidance sections SHALL shadow the preset's built-in tool guidance on the same layer (compiled defaults when no agentPresets service or a failing override — never a failed install).

#### Scenario: A hash-anchored edit lands and is reversible

- **WHEN** the model calls `edit` with anchored edit tuples on a file whose current content matches the anchors
- **THEN** the edit applies atomically (drift-checked against current content), and a subsequent `undo_last_edit` reverts it

#### Scenario: A write result stays upstream-native

- **WHEN** the model calls `write` and it succeeds
- **THEN** the result content is the upstream confirmation envelope with no auto-read/anchor section appended, and no read is required before the next anchored `edit` on that file

#### Scenario: The shadow replaces the built-in edit without masking

- **WHEN** an agent session starts under DASHR
- **THEN** the `edit` the model sees is the hashline tool (own-layer shadow), the preset's built-in edit is unreachable for that agent, and no deny-list entry names `edit`

## ADDED Requirements

### Requirement: Hashline edit verification is content-anchored

The system SHALL verify each edit tuple's anchors against the CURRENT file content before consulting any ledger: an anchor SHALL be accepted when its hash locates a unique, consistently pairable position in the current canonical line hashes; the served ledger SHALL be advisory (echo/undo attribution) and keyed by canonical absolute path with no session identity, so anchors survive session-tree forks and continuation without a re-read. Genuine drift SHALL still fail closed with nothing written, batch atomicity SHALL be unchanged, and a multi-tuple batch failure SHALL instruct reading the file once and resubmitting the whole batch.

#### Scenario: An edit across a forked session lands without a re-read

- **WHEN** a file is written or read in one session node, the conversation continues in a forked node (new session identity), and the model submits anchored edit tuples derived from that earlier content
- **THEN** the edit applies without any intervening `read`, because verification matched current content

#### Scenario: A drifted line still fails closed

- **WHEN** an anchor's hash no longer exists in the current file (content changed or line removed externally)
- **THEN** the tuple is rejected with a drift error stating the content changed and a read is needed, and nothing is written

#### Scenario: An ambiguous anchor falls back before failing

- **WHEN** an anchor's hash occurs at multiple current positions and the served ledger cannot disambiguate the span
- **THEN** the tuple is rejected with nothing written, and the error names the ambiguity

#### Scenario: Multi-tuple failure copy is actionable

- **WHEN** any tuple in a multi-tuple batch fails verification
- **THEN** the batch aborts with zero writes and the error instructs reading the file once, then resubmitting the whole batch

### Requirement: Hashline store centralized under DSH_HOME

The hashline store SHALL live at a single location — `$DSH_HOME/storages/dsh-better-edit/hash-store.sqlite` — for tool calls, previews, and tests alike, resolved through the harness home resolver so `DSH_HOME` isolates deployments; no per-workspace dot-directory SHALL be created. The served table SHALL be keyed by canonical absolute path (no session column), the 7-day TTL prune SHALL be retained, and the store schema version SHALL bump with a rebuild-on-mismatch gate that drops and recreates legacy session-keyed served tables.

#### Scenario: No dot-directory is created

- **WHEN** hashline tools run inside any workspace
- **THEN** state lands in the centralized store and no `<workspace>/.dsh_better_edit/` directory is created

#### Scenario: DSH_HOME isolates deployments

- **WHEN** the harness runs with a test `DSH_HOME` (e.g. the 4999 line)
- **THEN** its hashline store is a separate file under that home and never touches the production store

#### Scenario: Legacy session-keyed served tables rebuild

- **WHEN** the store opens with a schema version below the current one, or a served table still carrying a `session_id` column
- **THEN** the served table is dropped and recreated with the path-keyed schema, and the version marker is updated
