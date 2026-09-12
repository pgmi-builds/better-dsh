## ADDED Requirements

### Requirement: FS-gate scheme resolution
The system SHALL mount a scheme-aware filesystem backend (`better-dsh/fs-aware-sandbox`, extending the stock sandboxed backend) in place of the `fs-sandbox` row via a same-id home-layer patch row (`name` re-point = whole-plugin replacement with automatic rollback). While `urlSchemes` is enabled, every `ctx.fs` consumer — including the platform's native read/write/edit tools with no tool-layer wrapping — SHALL resolve file-type scheme URLs (`skill://`, `dsh://`, `dvc://`, `http(s)://`) through the URL resolver: `resolve` returns a virtual target keyed by the URL, `stat` answers a synthesized file entry, and `readText` dereferences the resolved text.

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
`ctx://` and `agent://` require live-session semantics the filesystem layer does not have. The backend SHALL answer them with a structured error naming the session-layer read path, and the wrapped read tool's scheme branch SHALL continue to serve them with the calling agent's context.

#### Scenario: Native read of ctx:// names the boundary
- **WHEN** the model reads a `ctx://` URL through a consumer that has no live-agent resolver environment
- **THEN** the backend returns a structured error explaining that `ctx://` is served by the session-layer read, instead of a raw filesystem failure

### Requirement: Gate disables resolution transparently
When `urlSchemes` is `false`, the backend SHALL short-circuit every override to the inherited stock behavior — scheme paths fail as ordinary native paths, real-path semantics are untouched, and the deployment behaves bit-for-bit like the stock `fs-sandbox` row.

#### Scenario: Stock degradation
- **WHEN** the deployment sets `urlSchemes: false` on the mounted row and a consumer reads a scheme URL
- **THEN** the call fails as it would under the stock backend (no scheme interception anywhere)
