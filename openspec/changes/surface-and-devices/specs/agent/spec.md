## MODIFIED Requirements

### Requirement: Agent roster addressing
The system SHALL let bare `agent://` return the caller's family tree — its descendant subagents through the subagent service's descendant projection, mirroring native `list_agents` semantics: only continuable children are listed (one-shot children are omitted — they are not continuation candidates; discovery traverses them only to find grandchildren), never sessions outside the caller's family, and never a global superset. Columns: `id` (creation label when present, e.g. `doer-1`, else raw session id), `status` (`running`/`idle` from the live agent registry; `ready` when only persisted — resumable, not terminal), `parent`, `last activity`. A caller with no children gets an empty roster.

#### Scenario: Listing the caller's continuable children
- **WHEN** the model reads bare `agent://` while it has continuable children (live or persisted)
- **THEN** the roster returns one row per continuable child, labeled and with native status semantics

#### Scenario: One-shot children omitted from the listing
- **WHEN** the caller's only children are settled one-shot subagents
- **THEN** the roster is empty (their ids arrive from spawn return and settlement notices, as natively)

#### Scenario: No cross-family visibility
- **WHEN** another agent's session runs concurrently outside the caller's family
- **THEN** it does not appear in the caller's roster

### Requirement: Nested output addressing
The system SHALL let `agent://<id>/<child>` return a direct child's output artifact, with addressing scoped to the caller's own family: from the live store when the child is live, and from the persisted session log (final assistant output) when the child has settled (the URL analog of collecting a background run's result). Child addressing accepts the raw session id or the child's creation label (raw id takes precedence on conflict). Unknown children return `AGENT_UNKNOWN_ID`. Paths with more than two segments return `AGENT_BAD_PATH`.

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

## MODIFIED Requirements

### Requirement: Agent output addressing
The system SHALL let `agent://<id>` return that agent's output artifact: the rendered content of its last non-empty assistant message (matching `SubagentResult.output` semantics), or empty text when the agent produced no non-empty assistant output. Addressing is scoped to the caller's own family (the caller itself and its descendant children) — ids outside the family return `AGENT_UNKNOWN_ID`.

#### Scenario: Reading a completed agent's output
- **WHEN** the model reads `agent://<finished agent id>` from within its family
- **THEN** the system returns the rendered text of that agent's last non-empty assistant message

#### Scenario: Reading an unknown agent
- **WHEN** the model reads `agent://<unknown id>` (or an id outside the caller's family)
- **THEN** the system returns the structured `AGENT_UNKNOWN_ID` error

### Requirement: Agent transcript addressing
The system SHALL let `agent://<id>/transcript` return the agent's full derived message history in order, each message headed by its role (`assistant`, `user`, `tool result`, `system`), with tool calls rendered as `[tool: name] arguments` and errors as `[tool error] …`. Addressing follows the same family scoping as output addressing.

#### Scenario: Reading an agent's session history
- **WHEN** the model reads `agent://<id>/transcript` for an agent in the caller's family
- **THEN** the system returns every message of that session in order, role-headed
