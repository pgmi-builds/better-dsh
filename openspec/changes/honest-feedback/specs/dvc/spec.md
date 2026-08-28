## MODIFIED Requirements

### Requirement: lsp wired into write
The system SHALL close the write-feedback loop: after a `write` lands a file whose language has an available language server, the tool result SHALL include a diagnostics summary for that file (error/warning counts plus the first message detail when non-zero), and the content SHALL be formatted before the single native write when the language server provides formatting capability. The diagnostics pipeline SHALL be honest about freshness: the feedback path syncs the exact written content, then signals the standard save notification (`textDocument/didSave`) so save-triggered checkers (e.g. rust-analyzer's flycheck) re-run, and waits for the refreshed diagnostics under a bounded timeout. When the wait times out, save-triggered compiler-source diagnostics (which are provably stale at that point) SHALL be dropped while immediately-computed diagnostics are kept — under-reporting beats mis-reporting. As a final guard, any diagnostic whose line lies beyond the just-written content's line count SHALL be dropped: it cannot refer to what was written. Languages with no server available (absent binary or unsupported extension) SHALL behave exactly as before — the hook adds nothing and fails silently, and the native write receives the caller's arguments object unchanged when formatting changes nothing.

#### Scenario: Write surfaces the damage it just caused
- **WHEN** a write lands content that introduces a type error in a file with a language server installed and its check-on-save pipeline completes within the timeout
- **THEN** the write result carries a diagnostics summary describing the EXACT content just written (never a stale earlier version), so the model learns of the breakage without a separate diagnostics call

#### Scenario: A fixed error stops being reported
- **WHEN** a write replaces content that previously had a type error with correct content
- **THEN** the write result no longer reports the old error — the save-triggered checker re-ran on the new content, and any compiler-source diagnostic still describing the old content is either refreshed or dropped

#### Scenario: Slow checks degrade honestly
- **WHEN** the save-triggered check does not complete within the bounded timeout
- **THEN** compiler-source diagnostics are dropped from the summary (they are provably stale), immediately-computed diagnostics remain, and the result never reports an error that refers to content other than what was just written

#### Scenario: Out-of-range spans are dropped
- **WHEN** a published diagnostic references a line beyond the just-written content's line count
- **THEN** that diagnostic is excluded from the summary and the counts reflect only the retained set

#### Scenario: Format-before-write
- **WHEN** a write targets a file whose server provides formatting
- **THEN** the native write receives and stores the formatted content (one write, one audit), and the before/after pair stays truthful

#### Scenario: Serverless language unchanged
- **WHEN** a write targets a file whose language has no server available
- **THEN** the result is byte-identical to the pre-change behavior (no diagnostics block, no formatting, no error)
