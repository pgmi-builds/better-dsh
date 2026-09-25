# escalation-guidance Specification

## Purpose
在 workspace-write 沙箱模式下，向模型的运行时上下文注入 per-call 升级能力的精简披露：受限操作可被拒/已拒后按调用以 `sandbox_permissions` + 一行 `justification` 升级（runtime 提示 user 审批，审批/拒绝均为 per-call，无会话级预算措辞）。该注入只披露能力、不劝导行为，且不依赖 upstream 源码修改。

## Requirements

### Requirement: Escalation guidance injected under workspace-write only

The system SHALL inject an escalation-guidance context entry into the model-facing system prompt when the session's effective sandbox mode is `workspace-write`, and SHALL NOT inject it when the effective mode is `read-only` or `danger-full-access`. The guidance SHALL state the per-call escalation semantics in the approved wording: a sandbox-deniable or sandbox-denied call MAY be escalated with `sandbox_permissions` and a one-line `justification`; the runtime SHALL prompt the user for approval; escalation and its approval/denial SHALL be per-call. The guidance text SHALL NOT contain quota wording (`retried once`, `once`, allowed-once) or any claim of a session-level escalation budget.

#### Scenario: Workspace-write session sees the guidance

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

### Requirement: Guidance is minimal disclosure, not behavioral coaching
The system SHALL keep the injected guidance text limited to disclosing the escalation capability — it SHALL NOT instruct the model to attempt restricted operations, SHALL NOT instruct it to refrain, and SHALL NOT restate or claim the sandbox is immutable. Whether to attempt an out-of-box operation SHALL remain the model's own decision.

#### Scenario: Text states the lever only
- **WHEN** the escalation-guidance entry renders under `workspace-write`
- **THEN** its text discloses the single-call escalation path and contains no imperative coaching sentence (no "do not refuse", no "go try", no "you are sandboxed and cannot change it")

### Requirement: Guidance rides the runtime-context snapshot
The system SHALL render the escalation guidance inside the same runtime-context snapshot region as the sandbox and approval policy entries (positioned after the approval-policy entry), so it is adjacent to the policy statements the model already reads. The injection SHALL register through the plugin system-prompt context API (`ctx.systemPrompt.context`) without modifying upstream DSH source.

#### Scenario: Guidance sits beside the policy entries
- **WHEN** a `workspace-write` session renders the system prompt
- **THEN** the escalation-guidance entry appears in the runtime-context snapshot, ordered after the `approval:policy` entry and before any later context entries
