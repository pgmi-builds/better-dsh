## Purpose

Let the model address skill bodies and internal skill resources via `skill://` URLs, with discovery tied to the same workspace source that advertises skills, and replace the skill tool's body-loading role on the REPL surface.

## ADDED Requirements

### Requirement: Skill body addressing
The system SHALL let read accept `skill://<name>` and return that skill's SKILL.md body in full text (no default truncation; only explicit selectors page).

#### Scenario: Reading an existing skill
- **WHEN** the model reads `skill://<registered skill name>`
- **THEN** the system returns the skill's body text in full

#### Scenario: Reading an unknown skill
- **WHEN** the model reads `skill://<unregistered name>`
- **THEN** the system returns the structured `URL_SKILL_NOT_FOUND` error ("unknown or no longer available")

### Requirement: Skill internal resource addressing
The system SHALL let read accept `skill://<name>/<path>` and return the named file inside the skill's resource directory, loaded through the sandboxed filesystem (same containment/audit rules as host reads). A skill without a filesystem resource directory returns `URL_SKILL_NO_RESOURCE_BASE`; a subpath escaping the directory returns `URL_SKILL_RESOURCE_ESCAPE`.

#### Scenario: Reading a referenced skill file
- **WHEN** the model reads `skill://foo/references/x.md`
- **THEN** the system returns the content of `references/x.md` inside foo's resource directory

#### Scenario: Resource path escapes the skill directory
- **WHEN** the model reads `skill://foo/../../etc/passwd`
- **THEN** the system returns the structured `URL_SKILL_RESOURCE_ESCAPE` error and reads nothing

### Requirement: Workspace-cwd-sensitive discovery
The system SHALL pass the calling agent's session cwd (`{cwd: agent.session.header.cwd}`) to every skill-registry lookup — the same source `dsh-tool-skill` uses to render `<available_skills>` — so `skill://` can address exactly the skills the catalog advertises for the current workspace.

#### Scenario: Skill visible in the current workspace
- **WHEN** the model reads `skill://foo` from a session whose cwd is inside a project root that provides foo
- **THEN** the lookup succeeds and the body resolves

#### Scenario: Skill outside the workspace is unknown
- **WHEN** a skill's project roots do not cover the session cwd
- **THEN** the lookup misses and the system returns `URL_SKILL_NOT_FOUND`, matching what `<available_skills>` advertised

### Requirement: Path-backed search view
The system SHALL expose the handler's `resolvePath`: `skill://<name>` maps to the skill's resource-directory root and `skill://<name>/<subpath>` to the joined file (same escape guard), letting grep/glob search the real files; unmappable URLs (unknown skill, non-directory resource base, escaping subpath) resolve to `undefined` so callers fall back to text resolution with its structured error.

#### Scenario: grep searches the skill's real directory
- **WHEN** the model greps a `skill://foo` URL
- **THEN** the search runs natively over foo's on-disk resource directory

### Requirement: Skill tool masked on the REPL surface only
The system SHALL mask the upstream `skill` tool presentation-only (ADR-0002): it disappears from the REPL `tool.*` binding names and the dashr tool-catalog section, while the host-layer native `skill` tool stays registered and executable and the `<available_skills>` discovery catalog is retained.

#### Scenario: Skill absent from the REPL surface
- **WHEN** the model inspects the kernel tool bindings or the tool-catalog text
- **THEN** neither contains `skill`, and `skill://` URLs remain the addressing path for skill content

#### Scenario: Host-native skill tool survives
- **WHEN** any host-plane consumer dispatches the native `skill` tool directly
- **THEN** the tool remains registered and executable — the mask touched only presentation surfaces
