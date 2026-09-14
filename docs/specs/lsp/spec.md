# lsp Specification

## Purpose
`lsp` 是**双模**语言服务能力：passive push 模（插件订阅 dsh 文件事件流，替 agent 向 per-session LSP server 子进程做 `didOpen/didChange/didSave` 文本同步，缓存 server 推回的 `publishDiagnostics`）+ proactive tool 模（agent 经 `dvc://lsp` 主动要 `diagnostics`/`format`/`definition` 等）。工作单位 = agent session（cwd 即 workspace root 候选）；**每 session 每语言一个 server 子进程**，不跨 session 共享。生命周期三级供给，类比 repl kernel：host start 零重物、session-start 登记零子进程、首用 lazy spawn。

## Requirements

### Requirement: Root-marker probing (lspMarker)
Server availability and project-root determination SHALL follow the per-language marker table（`pyrightconfig.json`/`pyproject.toml`、`tsconfig.json`/`jsconfig.json`、`Cargo.toml`、`go.mod` …配置驱动，不发明 `lsp.json`）——编辑器侧工程惯例，非 LSP 协议标准。Marker 缺席不阻断：server 仍可 spawn，root 退化为 mutation 文件所在目录。

#### Scenario: Marker present
- **WHEN** a session's cwd contains a language marker file and the language's server is locally available
- **THEN** the manager resolves project root to the marker's directory and reports availability for that language

#### Scenario: Marker absent
- **WHEN** no marker exists for the mutated file's language
- **THEN** availability is `unknown`, not `unavailable` — the gate below still offers opt-in

### Requirement: One-time gate with explicit opt-in (on/off)
When a session performs its first file mutation (edit/write 落盘) in a language with server availability `available` or `unknown` and the session gate is `unasked`, the tool result SHALL append exactly ONE notice: lsp 可用，可用 `dvc://lsp` 开（on）/关（off）。裁决后 SHALL NOT nag again（裁决存 session 态；repo marker `​.dashr/lsp.json` 仅作为 on 时的持久化偏好写入，off 不落任何 repo 文件）。

#### Scenario: First mutation nags once
- **WHEN** the agent edits its first `.py` file in a session with gate `unasked` and Python server available
- **THEN** that edit's tool result carries the one-line availability notice and no later mutation repeats it

#### Scenario: Explicit on
- **WHEN** the agent sets `dvc://lsp` on
- **THEN** the session gate becomes `on`, the manager spawns the language server lazily per Requirement below, and `.dashr/lsp.json` records the preference

#### Scenario: Explicit off
- **WHEN** the agent sets `dvc://lsp` off
- **THEN** the gate becomes `off`, no server spawns, the notice is muted for the session, and no repo marker is written

### Requirement: Lazy spawn, session lifetime
Server subprocesses SHALL spawn lazily on first post-on use（已有 `.dashr/lsp.json` marker 时，on 语义可由 marker 预置——首个 mutation 即视为 opt-in）, one subprocess per (session, language), registered under the agent's own tool effect so agent dispose unwinds them via `shutdown`+`exit`; an idle timeout reclaims servers of still-live sessions.

#### Scenario: Per-session isolation
- **WHEN** two sessions work in different cwd/repo simultaneously
- **THEN** each owns independent server subprocesses with its own workspace root and document mirrors

### Requirement: Text synchronization is post-hoc, never intercepting
The plugin SHALL feed document sync (`didOpen`/`didChange` full-text + `didSave`) from AFTER-THE-FACT dsh events only — `tools/post-execute` on successful read/edit/write, mirroring the exact landed content（EXACT content, didSave freshness, span guard）— and SHALL NOT intercept, wrap, or delay any dsh read/write/edit flow. The version ledger follows the host fs observation policy's read-before-edit accounts; no second version book is kept.

#### Scenario: Landed content is the mirror
- **WHEN** an edit lands and lsp is on for that language
- **THEN** the server receives a full-text `didChange` + `didSave` with the exact written content before diagnostics are requested, so line numbers match what the model just wrote

### Requirement: Dual-mode results
Proactive mode (`dvc://lsp` write: `diagnostics`/`format`/`definition`/…) and passive mode (cached `publishDiagnostics` attached to tool results, e.g. hashline edit 的 post-edit summary，经注入回调而非模块内依赖) SHALL both be served from the same session manager. Every failure — no server, no marker, cold-start noise, gate off — SHALL read as "no feedback": a serverless mutation is byte-identical to stock behavior.

#### Scenario: Diagnostics ride the edit result
- **WHEN** lsp is on, an edit lands, and the server answers diagnostics
- **THEN** the edit's tool result carries the diagnostics summary; when the server is absent or slow, the result is unchanged

### Requirement: Orthogonality and injection boundaries
The lsp capability SHALL be a self-contained module: no url-schemes/hashline imports; per-feature attachments (edit-result diagnostics, availability notices) arrive as injected callbacks from composition roots. Host start SHALL NOT probe markers or spawn processes — all discovery is per-session, on demand.

#### Scenario: Host boot cost
- **WHEN** the host starts with the lsp capability mounted
- **THEN** no subprocess spawns, no marker probing runs, and nothing on the boot path can fail because of lsp
