# url-schema Specification — Delta

## MODIFIED Requirements

### Requirement: FS-shaped tools accept and route scheme URLs
The scheme registry SHALL be owned by the `dsh-url-schemes` cordis service (renamed from `dsh-url-schema`), which SHALL contain the `UrlResolver` and scheme handlers only (no tool registrations inside the service). The URL-aware read/write/grep/glob tools SHALL be tool-layer consumers. read SHALL accept `scheme://` URLs and resolve them end-to-end through the scheme registry; grep/glob SHALL translate or materialize the resource for the native search; write SHALL dispatch to a structured per-scheme write channel (all rejected this wave).

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
The system SHALL implement read/write/grep/glob as delegation shells over the definition registered under the same semantic name at capture time, captured once per agent via `ctx.tools.get(name, agent)` strictly before the wrappers register on the agent's own scope layer (`read` included — its captured delegate MAY be another feature's wrapper). Non-URL inputs SHALL be forwarded verbatim to `captured.execute(args, exec)`, preserving the native write-intent policy gate, sandbox resolution, ripgrep search semantics, and any outer-layer behavior already present. The shells SHALL honor per-feature config gates `Config = { urlSchemes?: boolean = true, hashline?: boolean = true }` from the patch-line `config:` block: with `urlSchemes: false`, scheme paths SHALL fall through to the captured definition (native failure semantics are honest); with `hashline: false`, file reads SHALL delegate without hashline anchoring.

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
- **THEN** the definitions under `read`/`write`/`grep`/`glob` are captured strictly before any wrapper registers on that agent's scope layer, so the captured reference is the pre-existing tool rather than the wrapper (no self-recursion)

#### Scenario: URL capability disabled by gate
- **WHEN** the patch line sets `urlSchemes: false` and the model reads `ctx://session`
- **THEN** the wrapper delegates to the captured read definition and the native failure surfaces

## ADDED Requirements

### Requirement: Read chassis with ordered transforms
The `read` tool registration SHALL be owned by a single chassis inside `dsh-url-schemes`: an ordered transform chain (URL transform, hashline anchor transform, …) with a terminal delegate to the captured read definition. Additional read-side features SHALL register transforms into the chassis rather than registering competing `read` definitions (same-layer same-name registration is a registry error); a read-interested feature SHALL fall back to its own minimal wrapper only when the chassis is absent.

#### Scenario: Transforms compose deterministically
- **WHEN** both the URL transform and the hashline anchor transform are registered and the model reads a filesystem path
- **THEN** the path flows URL transform (no match) → anchor transform (anchors applied) → captured native read

### Requirement: General syntax guidance section
The service SHALL render a gated `url-schema:general` system-prompt section whose text is loaded once at module load from the package-root `url-schemes-section.md` (shipped via the package.json `files` array — an unlisted file is omitted from the published package and the module-load `readFileSync` fails plugin boot, the 0.2.3-d ENOENT lesson). The section is the SINGLE surfacing point of the URL scheme set to the model: the read/grep/glob/write tool descriptions SHALL carry NO `scheme://` mentions, so the model cannot believe only some tools accept URLs. The section SHALL cover: the general URL grammar (`scheme://<path>[:selector]`); all six schemes (`skill://`, `agent://`, `dsh://`, `ctx://`, `dvc://`, `http(s)://`) with first-level resource coverage per scheme; the bare-root-as-help behavior; the selector set including the composite `:raw:N-M` clause; the per-scheme variance disclaimer; and the read-only disclaimer (only `dvc://<device>` is writable). The section renders only while the URL capability is enabled.

#### Scenario: Gated disclosure
- **WHEN** the URL capability is enabled and an agent session starts
- **THEN** the system prompt contains the section text loaded from `url-schemes-section.md` with the grammar, selector, variance, and read-only coverage

#### Scenario: Tool descriptions stay scheme-silent
- **WHEN** the model inspects any read/grep/glob/write tool description on the wire
- **THEN** no description carries a `scheme://` mention — the `url-schema:general` section is the only place the scheme set is surfaced

## REMOVED Requirements

- **Requirement: read's file branch stays vendored hashline** — superseded by the read chassis with ordered transforms: hashline anchoring becomes a registered transform and the file branch delegates to the captured read definition (see ADDED "Read chassis with ordered transforms").
