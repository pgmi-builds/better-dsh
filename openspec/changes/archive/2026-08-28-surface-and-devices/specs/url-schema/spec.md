## MODIFIED Requirements

### Requirement: URL search reuses the native engine
The system SHALL run grep/glob over URL-addressed resources through the native search engine: path-backed schemes (a handler-implemented `resolvePath` mapping the URL to a real disk location — `skill://` today) have the URL translated to the disk path before delegating; content-backed schemes (agent, ctx, `dsh://config`, http, …) have the resolved text materialized into a fresh RAM-backed tempfs directory (`/dev/shm` when available and writable; falling back to the OS temp dir when unavailable or when a single materialization exceeds 8 MiB) which is removed afterwards whatever the outcome.

#### Scenario: Searching a path-backed resource
- **WHEN** the model greps a `skill://name` URL
- **THEN** the URL is translated to the skill's real disk path and only the search root is rewritten before the native grep runs

#### Scenario: Searching a content-backed resource
- **WHEN** the model greps a content-backed URL (e.g. `ctx://model`)
- **THEN** the resolved text is written into a fresh temp dir under `/dev/shm` (or the OS temp dir on fallback) as `content.txt`, the native grep searches it, and the temp dir is removed whether the search succeeds or fails

#### Scenario: Listing a URL resource
- **WHEN** the model calls glob with a URL in `pattern`
- **THEN** a path-backed scheme globs the resource's real disk directory natively, and a content-backed scheme returns the resolved text's non-empty lines as the listing without a native call

#### Scenario: Fallback to the OS temp dir
- **WHEN** `/dev/shm` is unavailable or the content exceeds 8 MiB
- **THEN** materialization falls back to the OS temp dir and the search still completes
