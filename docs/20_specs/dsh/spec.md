# dsh Specification

## Purpose

Let the model read the harness's own documentation and its effective configuration via `dsh://` URLs — runtime self-description, shipped with the package so it resolves in source, built, and installed layouts alike.

## Requirements

### Requirement: Documentation addressing
The system SHALL let `dsh://docs` return the sorted recursive listing of readable harness docs as JSON, and `dsh://docs/<doc>` return that document's content. A missing docs tree returns `URL_DOCS_UNAVAILABLE`; a missing document, a path escaping the docs directory, or a non-file target returns `URL_DOC_NOT_FOUND`. Any other root resource returns `URL_UNKNOWN_RESOURCE`.

#### Scenario: Browsing the doc listing
- **WHEN** the model reads `dsh://docs`
- **THEN** the system returns the JSON array of doc paths relative to the docs root

#### Scenario: Reading a specific document
- **WHEN** the model reads `dsh://docs/<doc>`
- **THEN** the system returns that document's content

#### Scenario: Path traversal is rejected
- **WHEN** the model reads `dsh://docs/../secrets`
- **THEN** the system returns the structured `URL_DOC_NOT_FOUND` error (path escapes the docs directory) and reads nothing

### Requirement: Docs tree resolves in every layout
The system SHALL locate the docs tree by a nearest-first walk-up from the module's own location (`docs-dir.ts`), and the package SHALL ship the docs (`prebuild` copies the repo `docs/` into the package; the `files` array includes it) so source-tree, bundled-lib, and installed-`node_modules` layouts all resolve the package's own docs first.

#### Scenario: Installed package resolves its own docs
- **WHEN** the plugin runs from `node_modules/<dashr>/lib/index.js`
- **THEN** `dsh://docs` serves the docs shipped inside that package, not an ancestor directory's

### Requirement: Effective config addressing
The system SHALL let `dsh://config` return the current resolved settings as JSON keyed by namespace, and `dsh://config/<ns>` return one namespace. A missing settings service returns `URL_SETTINGS_UNAVAILABLE`; an unknown namespace returns `URL_UNKNOWN_SETTINGS_NAMESPACE`.

#### Scenario: Reading the effective config
- **WHEN** the model reads `dsh://config`
- **THEN** the system returns the resolved (not documented-default) configuration, namespace by namespace

#### Scenario: Reading one namespace
- **WHEN** the model reads `dsh://config/<known namespace>`
- **THEN** the system returns that namespace's resolved value as JSON

### Requirement: Config never leaks secrets
The system SHALL strip secrets from every config response: schema-declared `role('secret')` redaction plus a defensive key-name denylist matched against normalized key names (credential/env/API-key material), applied recursively.

#### Scenario: Config hides keys
- **WHEN** the model reads `dsh://config` or `dsh://config/<ns>` and a resolved field is an API key or other secret-named field
- **THEN** the returned JSON does not contain the secret value
