# agent Specification

## Purpose

Let the model address the agent roster, output artifacts, and full transcripts via `agent://` URLs — the single home for what upstream split across roster tools and a separate `history://` scheme.

## Requirements

### Requirement: Agent roster addressing
The system SHALL let bare `agent://` return the roster of every live session, oldest first, as a five-column table: `id`, `status`, `kind`, `parent`, `last activity`. `status` comes from the live agent registry (`idle`/`running`; `-` when the session has no live agent); `kind` is the session header's `origin` (default `main`); `parent` is the delegating parent session id (`-` at top level); `last activity` is the last session event's time in ISO 8601 (`-` when the session has no events).

#### Scenario: Listing all agents
- **WHEN** the model reads bare `agent://`
- **THEN** the system returns one row per live session with all five columns, e.g. `id  status  kind  parent  last activity`

#### Scenario: Session without a live agent
- **WHEN** a roster row's session has no entry in the live agent registry
- **THEN** its `status` column renders `-`

### Requirement: Agent output addressing
The system SHALL let `agent://<id>` return that agent's output artifact: the rendered content of its last non-empty assistant message (matching `SubagentResult.output` semantics), or empty text when the agent produced no non-empty assistant output. Unknown ids return `AGENT_UNKNOWN_ID`.

#### Scenario: Reading a completed agent's output
- **WHEN** the model reads `agent://<finished agent id>`
- **THEN** the system returns the rendered text of that agent's last non-empty assistant message

#### Scenario: Reading an unknown agent
- **WHEN** the model reads `agent://<unknown id>`
- **THEN** the system returns the structured `AGENT_UNKNOWN_ID` error

### Requirement: Agent transcript addressing
The system SHALL let `agent://<id>/transcript` return the agent's full derived message history in order, each message headed by its role (`assistant`, `user`, `tool result`, `system`), with tool calls rendered as `[tool: name] arguments` and errors as `[tool error] …`.

#### Scenario: Reading an agent's session history
- **WHEN** the model reads `agent://<id>/transcript`
- **THEN** the system returns every message of that session in order, role-headed

### Requirement: Nested output addressing
The system SHALL let `agent://<id>/<child>` return a direct child's output artifact, resolving the child only through the parent's enumerated children. Unknown children, or children not live in the session store, return `AGENT_UNKNOWN_ID`. Paths with more than two segments return `AGENT_BAD_PATH`.

#### Scenario: Reading a nested child output
- **WHEN** the model reads `agent://<parent id>/<child id>` and the child is a direct child of that parent
- **THEN** the system returns the child's output artifact

#### Scenario: Child not enumerable from the parent
- **WHEN** the model reads `agent://<id>/<non-child id>`
- **THEN** the system returns the structured `AGENT_UNKNOWN_ID` error

### Requirement: history has no scheme of its own
The system SHALL provide transcript history only under `agent://<id>/transcript`. There is no `history://` handler and no special-case error for it: `history://` produces the generic `URL_UNREGISTERED_SCHEME` error like any other unregistered scheme.

#### Scenario: history scheme is unregistered
- **WHEN** the model reads `history://<id>`
- **THEN** the system returns the structured `URL_UNREGISTERED_SCHEME` error listing the registered schemes (history not among them)
