# hash-edit Specification

## Purpose
DASHR 的哈希锚点读写/edit 契约：`read` 以 `HASH│content` 行锚点呈现文件；`edit`/`undo_last_edit` 以锚点定位做单文件原子编辑；served 账本（schema v7，path 主键，集中存储于 `$DSH_HOME/storages/dsh-better-edit/`）保证锚点跨会话可验证。hash-edit 是自包含模块（`src/hashline/`），对 url-schemes 零出向引用；与 url-schemes 的组合只发生在 `url-schemes/index.ts` 组合根（read 链：scheme wrapper → hashline read → captured native）。

## Requirements

### Requirement: Anchored read presentation
The hashline read doer SHALL present every served text file as `HASH│content` rows (3-char hash anchors for later edit calls), with paging via `offset`/`limit` on file reads.

#### Scenario: Anchored read
- **WHEN** the agent calls `read` on a filesystem path with hashline enabled
- **THEN** each line returns as `HASH│content` and the served rows persist to the centralized store keyed by absolute path

### Requirement: Content-anchored edit with single-file atomicity
The `edit` tool SHALL apply the payload `{ path: string|null, edits: [[remove_from, remove_to, replacement_text], ...] }` as a single-file atomic batch; `null` path infers via anchors; `undo_last_edit` reverts the last edit on a file. Edit verification is content-anchored: a range whose bounds are unseen by the served ledger MAY pass via the content fast-path; `E_RANGE_STALE`/`E_RANGE_UNSERVED` semantics are preserved.

#### Scenario: Atomic batch
- **WHEN** an edit payload contains multiple edits and one anchor fails to resolve
- **THEN** no edit from the batch is written and the failing range is echoed back with fresh anchors

### Requirement: Host guard independence
The host `dsh-fs-observation-policy`'s `E_NOT_OBSERVED` (read-before-edit) SHALL remain an independent design-intent guard for cross-session edits; hash-edit verification complements, never replaces, it.

#### Scenario: Cross-session edit
- **WHEN** a session edits a file it never read and no served rows exist for its bounds
- **THEN** the host observation policy still denies or the content fast-path rules, per its own contract — hash-edit does not silently relax it

### Requirement: Module orthogonality
The hashline module SHALL NOT import anything from `url-schemes` (or any scheme surface). Its standalone entries — `initHashlineRuntime()`, `createHashlineReadTool()`, `installHashline()` — SHALL work with url-schemes absent; per-agent features it does not own (e.g. lsp edit feedback) arrive only as injected callbacks.

#### Scenario: Standalone mount
- **WHEN** a deployment mounts hashline without url-schemes
- **THEN** anchored read + edit/undo + guidance register and function; no scheme branch exists anywhere in the module

### Requirement: Shared sandbox controller
When co-mounted with a write wrapper, the `FsSandboxController` instance SHALL be created by the composition root and injected into both the hashline edit family and the write wrapper, so escalation advertisement and per-call policy stamping share one controller.

#### Scenario: Shared escalation surface
- **WHEN** a confining sandbox backend is mounted and both hashline and the write wrapper are active
- **THEN** `edit` and `write` escalate through the same controller with the session workspace root stamped
