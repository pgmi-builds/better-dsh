# dvc Specification

## Purpose

Reserve DASHR's device I/O surface under `dvc://` (renamed from the earlier `xd://` placeholder — no `xd` name remains anywhere): a read = device list/document view, a write = device dispatch entry. No device provider is mounted this wave, so both views are placeholders that fix the URL shapes and the structured write error for whatever device layer lands later.

## Requirements

### Requirement: Device roster placeholder
`dvc://` SHALL return the mounted-device roster listing every registered device name. With no device modules loaded the roster is the placeholder text `no devices mounted`; once devices are registered it lists their names.

#### Scenario: Listing mounted devices
- **WHEN** the model reads bare `dvc://`
- **THEN** the system returns the roster of registered device names (or `no devices mounted` when none)

### Requirement: Unknown device placeholder
The system SHALL let `dvc://<device>` return placeholder text `unknown device: <name>` — no device provider exists to answer with a real document.

#### Scenario: Reading an unmounted device
- **WHEN** the model reads `dvc://<any device name>`
- **THEN** the system returns `unknown device: <name>`

### Requirement: Write dispatch is a structured no-op
Every write to `dvc://<device>` SHALL dispatch to the registered device's execute with the JSON-args payload; with no devices mounted the structured `DVC_NO_DEVICE` error stands, and an unknown device name remains a structured error.

#### Scenario: Writing with no devices
- **WHEN** the model writes to `dvc://<device>` and no device module is registered
- **THEN** the system returns the structured `DVC_NO_DEVICE` error and dispatches nothing

### Requirement: Device dispatch contract
The system SHALL implement the device write contract: `write dvc://<device>` with a JSON-args content executes the device and returns its result; a non-JSON content or a device-reported failure returns a structured error carrying the device name.

#### Scenario: Executing a registered device
- **WHEN** the model writes `dvc://ast_edit` with valid JSON args
- **THEN** the device executes and its result returns to the caller

### Requirement: ast devices
The system SHALL provide `ast_edit` (staged structured codemod) and `ast_grep` (structured search) devices, backed by the official ast-grep engine compiled to WebAssembly plus an in-package tree-sitter grammar set (`lib/ast-assets/`), with no OMP and no native binary.

#### Scenario: ast_grep search over a workspace file
- **WHEN** the model writes `dvc://ast_grep` with a pattern and path
- **THEN** structured matches return from the AST search

### Requirement: Diagnostic fields (deliberate divergence from the native predecessor)
The ast devices SHALL surface failure modes that the native predecessor swallowed silently (0.2.6 contract addition). `ast_grep` results SHALL carry `patternErrors?: string[]` — present (non-empty) iff at least one supplied pattern failed to compile as a single-root AST node, one entry per failing pattern formatted `pattern <index> ("<pattern text>"): <underlying message>`; multi-root patterns land here and matches from the remaining patterns still return — and `pathNotFound?: boolean` — `true` only when the resolved target path does not exist on disk, absent otherwise. `ast_edit` results SHALL carry the same `patternErrors` semantics over `ops[].pat` (a failing op contributes no edits), `overlapping?: number` — the count of edits dropped by the overlap guard, present only when greater than zero — and the same `pathNotFound` semantics (true when at least one resolved target root does not exist on disk). Patterns that fail with a hard syntax compile error SHALL still throw through as `DVC_DEVICE_ERROR`. The devices perform no workspace boundary check — the boundary is the approval/policy layer — and `ast_edit` writes whatever paths it is given. All pre-existing fields keep their names and semantics.

#### Scenario: Multi-root pattern is reported, not swallowed
- **WHEN** `ast_grep` runs a multi-root pattern (e.g. `"alpha": $V`) that fails to compile as a single-root AST node
- **THEN** the result carries `patternErrors` with one entry naming the pattern index, the pattern text, and the underlying message, and zero matches from that pattern — instead of an indistinguishable empty result

#### Scenario: Missing path is distinguishable from zero matches
- **WHEN** the resolved target path does not exist on disk
- **THEN** the result carries `pathNotFound: true` with `filesSearched: 0`, so "nothing there" is no longer confused with "pattern matched nothing"

#### Scenario: Overlap-guard drops are counted
- **WHEN** `ast_edit` ops produce edits that overlap an already accepted edit
- **THEN** the first-registered op wins, the shadowed edit is dropped, and the result reports the dropped-edit count in `overlapping` instead of dropping it silently

#### Scenario: Hard syntax errors still throw
- **WHEN** a pattern fails with a hard syntax compile error (e.g. `$$$`)
- **THEN** the device throws and the caller receives the structured `DVC_DEVICE_ERROR`, exactly as before

### Requirement: browser device
The system SHALL provide a `browser` device (open/close/run over real browser tabs) vendored from the omp harness, using puppeteer-core against the system Chrome; when no browser can launch, the device returns a structured error.

#### Scenario: Opening a page headlessly
- **WHEN** the model writes `dvc://browser` with an open action and URL
- **THEN** a headless tab opens and the action result returns

### Requirement: lsp device
The system SHALL provide an `lsp` device (definition/references/diagnostics/actions) vendored from the omp harness; languages whose server binary is absent degrade gracefully per language.

#### Scenario: Diagnostics for an installed language server
- **WHEN** the model writes `dvc://lsp` requesting diagnostics for a file whose language server is installed
- **THEN** the device returns the diagnostics

#### Scenario: Missing language server degrades
- **WHEN** the requested language's server binary is not installed
- **THEN** the device reports the missing server without crashing the session

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
