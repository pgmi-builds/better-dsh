## ADDED Requirements

### Requirement: FS-gate scheme resolution
The system SHALL resolve file-type scheme URLs (`dsh://`, `dvc://`, `http(s)://`) at the filesystem service seam by wrapping the LIVE `ctx.fs` instance in place (instance-level method wrap of its five public methods; symbol-idempotent, re-applied per boot, every added behavior gated behind `urlSchemes`; a wrap failure degrades to the stock service, never a failed boot). Every `ctx.fs` consumer — including the platform's native read/write/edit tools with no tool-layer wrapping — SHALL thus resolve these URLs through the URL resolver: `resolve` returns a virtual target keyed by the URL, `stat` answers a synthesized file entry, and `readText` dereferences the resolved text.
#### Scenario: Native read of a static scheme without tool-layer participation
- **WHEN** the hashline tool gate is disabled (the wrapped read delegates to the captured native read) and the model reads `dsh://docs/<doc>`
- **THEN** the native read resolves the document through the filesystem backend and returns its text — no tool-layer scheme code participated

#### Scenario: Real-path passthrough
- **WHEN** any consumer resolves, reads, or mutates a real filesystem path
- **THEN** every operation delegates to the inherited sandboxed backend unchanged (containment, observation events, atomic writes, read-match-write critical section)

### Requirement: Virtual targets are read-only
The backend SHALL refuse mutations that target a virtual scheme path with the structured `FS_VIRTUAL_READONLY` error before any policy or filesystem work, while `urlSchemes` is enabled. Real-path mutations keep the stock fence.

#### Scenario: Native write against a virtual target
- **WHEN** the model writes to a scheme path that has no write channel at the FS layer
- **THEN** the call fails with `FS_VIRTUAL_READONLY` and no file is created

### Requirement: Session-layer schemes stay at the tool layer
`ctx://`, `agent://`, and `skill://` require live-agent semantics the filesystem layer does not have: the first two read session state, and `skill://` must consult the host skill registry's layered catalog — whose discovery (which roots load: project/user/preset/custom/bundled, scan depth, rank and scope merge) is business logic owned by the host `skill-filesystem` provider and resolves only against a calling agent. The backend SHALL answer all three with a structured session-layer boundary error naming the sanctioned channel (the native `skill` tool for skill loading), and SHALL NOT re-implement or approximate skill discovery (no own root parsing, no cwd heuristics, no scope guessing). The wrapped read tool's scheme branch SHALL continue to serve `ctx://`/`agent://` with the calling agent's context, and the skill handler at the tool layer SHALL mirror the native tool's lookup exactly (`cwd` from the agent's session header, the agent as viewing scope).
#### Scenario: Native read of ctx:// names the boundary
- **WHEN** the model reads a `ctx://` URL through a consumer that has no live-agent resolver environment
- **THEN** the backend returns a structured error explaining that `ctx://` is served by the session-layer read, instead of a raw filesystem failure

#### Scenario: Native read of skill:// names the session-layer boundary
- **WHEN** the model reads any `skill://` URL through a filesystem-layer consumer (no calling agent)
- **THEN** the backend returns the structured session-layer boundary error pointing at the native `skill` tool — never a registry verdict (such as "unknown skill") guessed from a deployment-declared cwd
### Requirement: Gate disables resolution transparently
When `urlSchemes` is `false`, the backend SHALL short-circuit every override to the inherited stock behavior — scheme paths fail as ordinary native paths, real-path semantics are untouched, and the deployment behaves bit-for-bit like the stock `fs-sandbox` row.

#### Scenario: Stock degradation
- **WHEN** the deployment sets `urlSchemes: false` on the mounted row and a consumer reads a scheme URL
- **THEN** the call fails as it would under the stock backend (no scheme interception anywhere)
