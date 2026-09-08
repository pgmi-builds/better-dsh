## MODIFIED Requirements

### Requirement: Escalation guidance injected under workspace-write only

The system SHALL inject an escalation-guidance context entry into the model-facing system prompt when the session's effective sandbox mode is `workspace-write`, and SHALL NOT inject it when the effective mode is `read-only` or `danger-full-access`. The guidance SHALL state the per-call escalation semantics in the approved wording: a sandbox-deniable or sandbox-denied call MAY be escalated with `sandbox_permissions` and a one-line `justification`; the runtime SHALL prompt the user for approval; escalation and its approval/denial SHALL be per-call. The guidance text SHALL NOT contain quota wording (`retried once`, `once`, allowed-once) or any claim of a session-level escalation budget.

#### Scenario: Workspace-write session sees the per-call guidance

- **WHEN** a DASHR agent session runs with effective sandbox mode `workspace-write`
- **THEN** the runtime-context snapshot contains the escalation-guidance entry stating the deniable/denied per-call escalation path (`sandbox_permissions` + one-line `justification`, user approval prompted by the runtime)

#### Scenario: Guidance contains no quota wording

- **WHEN** the escalation-guidance entry renders under `workspace-write`
- **THEN** its text contains none of `retried once` / allowed-once / per-session budget claims, and states that escalation and its approval/denial are per-call

#### Scenario: Read-only session skips the guidance

- **WHEN** a DASHR agent session runs with effective sandbox mode `read-only`
- **THEN** the runtime-context snapshot contains no escalation-guidance entry from DASHR (the upstream read-only policy sentence already teaches the escalation guidance)

#### Scenario: Danger-full-access session skips the guidance

- **WHEN** a DASHR agent session runs with effective sandbox mode `danger-full-access`
- **THEN** the runtime-context snapshot contains no escalation-guidance entry (there is no restricted operation to escalate)
