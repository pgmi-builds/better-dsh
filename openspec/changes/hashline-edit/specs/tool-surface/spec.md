## ADDED Requirements

### Requirement: Hashline edit family registered on the agent's own layer
The system SHALL register the vendored hashline edit family on each agent's own scope layer at session start — `edit` (hash-anchored ordered edit tuples, shadowing the preset's built-in edit by nearest-layer resolution, no mask entry needed) and `undo_last_edit` (revert of the most recent hashline edit) — alongside the URL-aware read/write/grep/glob wrappers, unwinding with the agent. A write-side hook SHALL append the fresh hashline preview to successful write results, and the hashline guidance sections SHALL shadow the preset's built-in tool guidance on the same layer (compiled defaults when no agentPresets service or a failing override — never a failed install).

#### Scenario: A hash-anchored edit lands and is reversible
- **WHEN** the model calls `edit` with anchored edit tuples on a file a prior hashline `read` served
- **THEN** the edit applies atomically against the served hash state (drift-checked), and a subsequent `undo_last_edit` reverts it

#### Scenario: The shadow replaces the built-in edit without masking
- **WHEN** an agent session starts under DASHR
- **THEN** the `edit` the model sees is the hashline tool (own-layer shadow), the preset's built-in edit is unreachable for that agent, and no deny-list entry names `edit`

### Requirement: Lsp feedback rides edit results
The system SHALL attach the same write-feedback diagnostics contract to successful edits: after a landed `edit` with an explicit path, the result content carries the diagnostics summary computed from the exact landed content (didSave freshness, timeout degradation, span guard — the `dvc` write-feedback requirement's terms apply verbatim). Anchor-only edits (path inferred from anchors) and non-edit tools pass through untouched; the write tool's feedback stays with its wrapper (no double pull).

#### Scenario: An edit that introduces a type error reports it
- **WHEN** an edit lands content introducing a type error in a file with a language server and its check completes within the budget
- **THEN** the edit result text carries the diagnostics summary for the exact landed content
