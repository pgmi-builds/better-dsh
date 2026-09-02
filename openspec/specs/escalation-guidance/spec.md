# escalation-guidance Specification

## Purpose
在 workspace-write 沙箱模式下，向模型的运行时上下文注入单次升级（allowed-once）能力的精简披露：受限操作可按调用以 `sandbox_permissions` 升级（经用户审批）。该注入只披露能力、不劝导行为，且不依赖 upstream 源码修改。

## Requirements

### Requirement: Escalation guidance injected under workspace-write only
The system SHALL inject an escalation-guidance context entry into the model-facing system prompt when the session's effective sandbox mode is `workspace-write`, and SHALL NOT inject it when the effective mode is `read-only` or `danger-full-access`. The guidance SHALL state that restricted operations may be retried once with `sandbox_permissions` for single-call escalation, pending user approval.

#### Scenario: Workspace-write session sees the guidance
- **WHEN** a DASHR agent session runs with effective sandbox mode `workspace-write`
- **THEN** the runtime-context snapshot contains the escalation-guidance entry stating the single-call escalation path with `sandbox_permissions` pending user approval

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
