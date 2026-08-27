## Purpose

Let the model read a curated, read-only snapshot of its calling environment via `ctx://` URLs — small, static, agent-derived facts (who am I, what model, what cwd) addressable like any other resource. This replaces the v0.1.8c design that mapped `ctx://` onto persistent-kernel variables; see design.md D4 for why that semantics was wrong (the kernel namespace is the model's own REPL scratchpad, not its environment).

## ADDED Requirements

### Requirement: Curated snapshot keys
The system SHALL resolve exactly three snapshot keys: `ctx://session` → JSON `{id, status, origin, delegationDepth}` (undefined optional header fields omitted); `ctx://model` → JSON `{provider, model, maxTokens}` (undefined option fields omitted); `ctx://cwd` → the session's creation working directory as a bare string (`''` when the header has none). Any other key returns the structured `CTX_UNKNOWN_KEY` error listing the known keys.

#### Scenario: Reading session identity
- **WHEN** the model reads `ctx://session` from a delegated subagent session
- **THEN** the system returns JSON with the agent id, status, origin, and delegation depth

#### Scenario: Reading the model configuration
- **WHEN** the model reads `ctx://model`
- **THEN** the system returns JSON with the provider, model, and maxTokens of the calling agent's request options

#### Scenario: Reading the working directory
- **WHEN** the model reads `ctx://cwd`
- **THEN** the system returns the session cwd as a bare string, not JSON

#### Scenario: Unknown key
- **WHEN** the model reads `ctx://<other key>`
- **THEN** the system returns the structured `CTX_UNKNOWN_KEY` error naming the known keys

### Requirement: Bare listing
The system SHALL let bare `ctx://` return the snapshot key names, one per line, without requiring a live agent.

#### Scenario: Listing keys
- **WHEN** the model reads bare `ctx://`
- **THEN** the system returns the key names `session`, `model`, `cwd` one per line

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
