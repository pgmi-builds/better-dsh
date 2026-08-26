## Purpose

Give DASHR one uniform URL resource-addressing layer: read/write/grep/glob accept `scheme://` URLs, route by scheme to a handler, apply one selector syntax uniformly, and keep non-URL behavior byte-identical to the native tools via delegation.

## ADDED Requirements

### Requirement: FS-shaped tools accept and route scheme URLs
The system SHALL let read/write/grep/glob accept `scheme://` URLs. read resolves the URL end-to-end through the scheme registry; grep/glob translate or materialize the resource for the native search; write dispatches to a structured per-scheme write channel (all rejected this wave).

#### Scenario: Reading a registered scheme
- **WHEN** the model calls read with a registered scheme URL (e.g. `skill://foo`)
- **THEN** the system returns the handler-resolved content with the selector applied, not a filesystem read

#### Scenario: Reading an unregistered scheme
- **WHEN** the model calls read with a URL whose scheme has no registered handler (including `history://` — no special case exists)
- **THEN** the system returns the structured `URL_UNREGISTERED_SCHEME` error listing the registered schemes

#### Scenario: URL without a scheme prefix
- **WHEN** a resolver-layer caller passes a string without `scheme://`
- **THEN** the system returns the structured `URL_NO_SCHEME` error

### Requirement: Delegation shells preserve native non-URL behavior
The system SHALL implement write/grep/glob as delegation shells over the captured native tool definitions: before the wrappers register on an agent's own scope layer, the native definitions are captured once per agent (`ctx.tools.get(name, agent)`); non-URL inputs are forwarded verbatim to `native.execute(args, exec)`, preserving the native write-intent policy gate, sandbox resolution, and ripgrep search semantics.

#### Scenario: Ordinary write keeps the policy gate
- **WHEN** the model writes to an ordinary file path
- **THEN** the call runs through the captured native write definition — the write-intent policy gate, sandbox resolution, and observation events behave exactly as before the URL schema existed

#### Scenario: Ordinary grep/glob keep ripgrep semantics
- **WHEN** the model greps or globs over ordinary paths
- **THEN** the call delegates to the captured native definition with args untouched, returning native-shaped results

#### Scenario: Missing native delegate fails loudly
- **WHEN** a host did not deploy the native write/grep/glob and the corresponding wrapper is invoked on a non-URL input
- **THEN** the system returns the structured `NATIVE_WRITE_UNAVAILABLE` / `NATIVE_GREP_UNAVAILABLE` / `NATIVE_GLOB_UNAVAILABLE` error instead of reimplementing the tool

#### Scenario: Capture happens before registration
- **WHEN** an agent session starts and the URL-aware tools are installed
- **THEN** the native definitions are captured strictly before any wrapper registers on that agent's scope layer, so the captured reference is the native tool rather than the wrapper (no self-recursion)

### Requirement: URL search reuses the native engine
The system SHALL run grep/glob over URL-addressed resources through the native search engine: path-backed schemes (a handler-implemented `resolvePath` mapping the URL to a real disk location — `skill://` today) have the URL translated to the disk path before delegating; content-backed schemes (agent, ctx, `dsh://config`, http, …) have the resolved text materialized into a fresh temp directory which is removed afterwards whatever the outcome.

#### Scenario: Searching a path-backed resource
- **WHEN** the model greps a `skill://name` URL
- **THEN** the URL is translated to the skill's real disk path and only the search root is rewritten before the native grep runs

#### Scenario: Searching a content-backed resource
- **WHEN** the model greps a content-backed URL (e.g. `ctx://model`)
- **THEN** the resolved text is written into a fresh temp dir as `content.txt`, the native grep searches it, and the temp dir is removed whether the search succeeds or fails

#### Scenario: Listing a URL resource
- **WHEN** the model calls glob with a URL in `pattern`
- **THEN** a path-backed scheme globs the resource's real disk directory natively, and a content-backed scheme returns the resolved text's non-empty lines as the listing without a native call

### Requirement: URL writes are rejected per scheme
The system SHALL reject every `scheme://` write with a scheme-specific structured error: `dvc://` → `DVC_NO_DEVICE` (no device mounted), `ctx://` → `URL_READ_ONLY` (curated read-only snapshot), any other registered scheme → `URL_WRITE_UNSUPPORTED`, unregistered scheme → `URL_UNREGISTERED_SCHEME`.

#### Scenario: Writing to a read-only scheme
- **WHEN** the model writes to `ctx://model`
- **THEN** the system returns the structured `URL_READ_ONLY` error explaining the scheme is a read-only snapshot

#### Scenario: Writing to the device placeholder
- **WHEN** the model writes to `dvc://<device>`
- **THEN** the system returns the structured `DVC_NO_DEVICE` error (no devices mounted to route the write to)

### Requirement: Unified selector syntax
The system SHALL parse selectors once (`:N-M` comma-lists, `:raw`, `:path/…`, `?q=`) and apply them uniformly to every handler's full text after resolution. Handlers return full text with no default line truncation; only explicit selectors page. Malformed selectors return the structured `URL_BAD_SELECTOR` error.

#### Scenario: Scheme URL with a line range
- **WHEN** the model reads `skill://foo:50-100`
- **THEN** the system resolves the full skill body and returns lines 50–100, exactly as it would slice a plain file

#### Scenario: JSON path and query selectors
- **WHEN** the resolved text is JSON and the URL carries `:path/a.b` or `?q=a.b`
- **THEN** the system navigates the JSON by dot-path; for non-JSON text `?q=` keeps the lines containing the query string

### Requirement: read's file branch stays vendored hashline
The system SHALL keep the ordinary-file branch of read on the vendored hashline pipeline (HASH│content anchors plus the snapshot store the vendored edit tools depend on), reading through the sandboxed filesystem and the fs observation policy gate — read delegates to no native definition.

#### Scenario: Plain file read returns hashline anchors
- **WHEN** the model reads an ordinary file path
- **THEN** the system returns hashline-anchored lines via the vendored pipeline and records the observation with the fs policy gate, so follow-up edit calls see the version just read
