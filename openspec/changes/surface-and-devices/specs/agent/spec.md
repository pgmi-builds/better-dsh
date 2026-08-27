## MODIFIED Requirements

### Requirement: Agent roster addressing
The system SHALL let bare `agent://` return the roster of every live session plus every child subagent discoverable for those sessions (live or settled one-shot, via the subagent service's live-preferred merge), oldest first, as a five-column table: `id`, `status`, `kind`, `parent`, `last activity`. The `id` column shows a child's durable creation label when it has one (e.g. `doer-1`), else the raw session id. `status` comes from the live agent registry (`idle`/`running`; `-` when the session has no live agent; settled children render their settled state); `kind` is the session header's `origin` (default `main`; children `subagent`); `parent` is the delegating parent session id (`-` at top level); `last activity` is the last session event's time in ISO 8601 (`-` when the session has no events).

#### Scenario: Listing all agents
- **WHEN** the model reads bare `agent://`
- **THEN** the system returns one row per live session and per discoverable child, with all five columns

#### Scenario: Session without a live agent
- **WHEN** a roster row's session has no entry in the live agent registry
- **THEN** its `status` column renders `-`

#### Scenario: Settled one-shot child appears in the roster
- **WHEN** one of the caller's one-shot subagents has already settled
- **THEN** the roster contains a row for that child with the parent's id in the `parent` column and a settled status

#### Scenario: Roster without children stays a single row
- **WHEN** the caller has never spawned a subagent
- **THEN** the roster shows only the caller's row with `parent` as `-`

### Requirement: Nested output addressing
The system SHALL let `agent://<id>/<child>` return a direct child's output artifact, resolving the child only through the parent's enumerated children: from the live store when the child is live, and from the persisted session log (final assistant output) when the child has settled. Child addressing accepts the raw session id or the child's creation label (raw id takes precedence on conflict). Unknown children return `AGENT_UNKNOWN_ID`. Paths with more than two segments return `AGENT_BAD_PATH`.

#### Scenario: Reading a nested child output
- **WHEN** the model reads `agent://<parent id>/<child id>` and the child is a direct child of that parent
- **THEN** the system returns the child's output artifact

#### Scenario: Addressing a child by its creation label
- **WHEN** the model reads `agent://<parent>/<doer-1>` and the child was admitted with label `doer-1`
- **THEN** the system resolves the label to the child (raw session id takes precedence on conflict)

#### Scenario: Child not enumerable from the parent
- **WHEN** the model reads `agent://<id>/<non-child id>`
- **THEN** the system returns the structured `AGENT_UNKNOWN_ID` error

#### Scenario: Settled one-shot child output retrievable
- **WHEN** the model reads `agent://<parent>/<child>` after the one-shot child completed
- **THEN** the child's final assistant message is returned from the persisted log
