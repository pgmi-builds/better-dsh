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
The system SHALL provide `ast_edit` (staged structured codemod) and `ast_grep` (structured search) devices, vendored from the omp harness (MIT), backed by the published `@oh-my-pi/pi-natives` binding.

#### Scenario: ast_grep search over a workspace file
- **WHEN** the model writes `dvc://ast_grep` with a pattern and path
- **THEN** structured matches return from the AST search

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
