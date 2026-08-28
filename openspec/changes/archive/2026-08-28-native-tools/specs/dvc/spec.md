## ADDED Requirements

### Requirement: lsp wired into write
The system SHALL close the write-feedback loop: after a `write` lands a file whose language has an available language server, the tool result SHALL include a diagnostics summary for that file (error/warning counts plus the first message detail when non-zero), and the content SHALL be formatted before the single native write when the language server provides formatting capability. Languages with no server available (absent binary or unsupported extension) SHALL behave exactly as before — the hook adds nothing and fails silently, and the native write receives the caller's arguments object unchanged when formatting changes nothing.

#### Scenario: Write surfaces the damage it just caused
- **WHEN** a write lands content that introduces a type error in a TypeScript file with a language server installed
- **THEN** the write result carries a diagnostics summary describing the EXACT content just written (never a stale earlier version), so the model learns of the breakage without a separate diagnostics call

#### Scenario: Format-before-write
- **WHEN** a write targets a file whose server provides formatting
- **THEN** the native write receives and stores the formatted content (one write, one audit), and the before/after pair stays truthful

#### Scenario: Serverless language unchanged
- **WHEN** a write targets a file whose language has no server available
- **THEN** the result is byte-identical to the pre-change behavior (no diagnostics block, no formatting, no error)
