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

### Requirement: Gated notice with explicit per-session opt-in (on/off)
The manager at session start SHALL check local availability of each language server in its table（Python/TypeScript 为必备，缺失即安装；Rust/Go 保留 nag 检测，server 缺失时按需安装）. When a session performs file mutations (edit/write 落盘) in a language with availability `available` or `unknown` and the session gate is `unasked`, the tool result MAY append the availability notice (lsp 可用，`dvc://lsp` 开/关) **at most 10 times per session**（防刷屏上限）. Both `on` and `off` are PER-SESSION state — the manager handles everything, and SHALL write NO repo artifact or marker file in either direction（无 `.dashr/lsp.json`，无任何落盘偏好）.

#### Scenario: Mutation nag capped
- **WHEN** the agent edits `.py` files repeatedly in a session with gate `unasked`
- **THEN** at most 10 tool results carry the notice; afterwards mutations stay silent until the gate is decided

#### Scenario: Explicit on (per session)
- **WHEN** the agent sets `dvc://lsp` on
- **THEN** the session gate becomes `on` and the manager warm-starts the language server; nothing is written to the repo

#### Scenario: Explicit off (per session)
- **WHEN** the agent sets `dvc://lsp` off
- **THEN** the gate becomes `off`, no server spawns, the notice is muted for the session, and no repo marker is written

### Requirement: Must-have servers installed, niche on demand
At session start the manager SHALL verify Python and TypeScript servers and INSTALL a missing one (pip/npm, pinned, fail-soft — 安装失败降级为该语言 `unavailable`)；Rust/Go servers SHALL NOT be installed proactively — they stay in the nag-detection table and install only when the agent turns lsp on for that language.

#### Scenario: Missing pyright on a fresh host
- **WHEN** a session starts and no Python language server is installed
- **THEN** the manager installs it in the background and reports availability `available` once done（安装期间 `unknown`，nag 照常）

#### Scenario: Rust opted in on demand
- **WHEN** the agent sets lsp on in a session touching Rust files and rust-analyzer is absent
- **THEN** the manager installs rust-analyzer then spawns it — never before the opt-in

### Requirement: Lazy spawn, session lifetime
Server subprocesses SHALL spawn lazily on first post-on use, one subprocess per (session, language), registered under the agent's own tool effect so agent dispose unwinds them via `shutdown`+`exit`; an idle timeout reclaims servers of still-live sessions.

#### Scenario: Per-session isolation
- **WHEN** two sessions work in different cwd/repo simultaneously
- **THEN** each owns independent server subprocesses with its own workspace root and document mirrors

### Requirement: Text synchronization is post-hoc, never intercepting
The plugin SHALL feed document sync (`didOpen`/`didChange` full-text + `didSave`) from AFTER-THE-FACT dsh events only — `tools/post-execute` on successful read/edit/write, mirroring the exact landed content（EXACT content, didSave freshness, span guard）— and SHALL NOT intercept, wrap, or delay any dsh read/write/edit flow. The version ledger follows the host fs observation policy's read-before-edit accounts; no second version book is kept.

#### Scenario: Landed content is the mirror
- **WHEN** an edit lands and lsp is on for that language
- **THEN** the server receives a full-text `didChange` + `didSave` with the exact written content before diagnostics are requested, so line numbers match what the model just wrote

### Requirement: Dual-mode results
Proactive mode (`dvc://lsp` write: `diagnostics`/`format`/`definition`/…) and passive mode (cached `publishDiagnostics` attached to tool results, e.g. hashline edit 的 post-edit summary，经注入回调而非模块内依赖) SHALL both be served from the same session manager. Every failure — no server, gate off, cold-start noise — SHALL read as "no feedback": a serverless mutation is byte-identical to stock behavior.

#### Scenario: Diagnostics ride the edit result
- **WHEN** lsp is on, an edit lands, and the server answers diagnostics
- **THEN** the edit's tool result carries the diagnostics summary; when the server is absent or slow, the result is unchanged

### Requirement: Spin-up latency is absorbed, never blocking
Server cold-start（spawn + `initialize` + 首轮索引）SHALL be handled by three means: (1) **warm-start at opt-in** — gate on 即后台 spawn，不等首个请求; (2) **fire-and-attach** — diagnostics 请求带超时，超时/未就绪读作"no feedback"，server 稍后推回的 `publishDiagnostics` 缓存并附到**下一个** mutation 的 tool result（延迟附挂，不丢不阻塞）; (3) **read 预热** — session 内首个某语言文件 read 即提前 `didOpen`，使首个 edit 命中已初始化的 server. The mutation path SHALL NEVER wait on server readiness — worst case is a summary arriving one tool call late.

#### Scenario: First edit on a cold server
- **WHEN** the gate turns on and the very next mutation hits an uninitialized server
- **THEN** the edit result carries no diagnostics (no feedback), and when the server finishes indexing the diagnostics attach to the next mutation's result

#### Scenario: Read pre-warms
- **WHEN** the agent reads a `.ts` file before editing it and lsp gate is on for TypeScript
- **THEN** the read triggers `didOpen` and server initialization, so the subsequent edit usually gets same-call diagnostics

### Requirement: Orthogonality and injection boundaries
The lsp capability SHALL be a self-contained module: no url-schemes/hashline imports; per-feature attachments (edit-result diagnostics, availability notices) arrive as injected callbacks from composition roots. Host start SHALL NOT probe markers or spawn processes — all discovery is per-session, on demand.

#### Scenario: Host boot cost
- **WHEN** the host starts with the lsp capability mounted
- **THEN** no subprocess spawns, no marker probing runs, and nothing on the boot path can fail because of lsp

## Surface syntax (`dvc://lsp`)

The dvc contract is uniform: **bare read = roster, `<device>` read = doc/status, `<device>` write = action dispatch**. Gate state is per-session — the write dispatcher injects the calling agent's session id automatically; agents never type it.

Read-vs-write follows GET/PUT semantics — **reads never mutate, writes always do**:

- `read dvc://lsp` — the device doc: actions, args, current contract.
- `read dvc://lsp/status` — the calling session's gate (session injected from the read env; no session → an explicit pointer note).
- `read dvc://lsp/diagnostics?file=<path>&all=1` — fan-out query (read-only; spawning a lazily-managed server is the side effect of asking, not a mutation).
- `read dvc://lsp/definition?file=&line=&character=|&symbol=` (also `references`, `hover`) — position queries, 1-based.
- `write dvc://lsp` `{"action":"on"}` / `{"action":"off"}` — per-session gate decision; ack describes the effect. No repo artifact in either direction.
- `write dvc://lsp` `{"action":"reload"}` — restart the server (config re-read).
- `write dvc://lsp` `{"action":"rename",...}` / `{"action":"code_actions",...,"apply":N}` / `{"action":"format","file":...}` — workspace-mutating operations.

The write surface retains `status` for symmetry with the session-injected dispatcher, but the read form is canonical for all queries. Path-mutation forms (`dvc://lsp/on`) are NOT part of the contract: mutation never rides a read URL.

### Requirement: Session transport is out-of-band
The per-session gate addressing SHALL ride the dvc write dispatcher's `execute(args, { session })` context — NOT the args payload — so devices with strict argument validators (browser) are unaffected; the lsp device reads `ctx.session` with a legacy in-args fallback for direct callers. The read surface receives the calling session through the resolver env the same way (`dvc://lsp/status` returns the calling session's gate).

#### Scenario: Strict-validator device unaffected
- **WHEN** the model writes `dvc://browser` with `{"action":"open","url":…}` from a session
- **THEN** the browser device's validator sees only its declared fields and the action executes (the session rides the dispatcher's out-of-band ctx)

#### Scenario: Status read is session-aware
- **WHEN** the model turns lsp on and then reads `dvc://lsp/status` from the same session
- **THEN** the status reports that session's gate (`"gate":"on"`)

## OMP parity progress

The device vendored a trimmed upstream oh-my-pi (`packages/coding-agent/src/lsp`) surface; parity is being completed in stages, each keeping the module boundary (nothing imports hash-edit/ast/url-schemes internals):

1. ✅ `rename` / `code_actions` / `reload` actions (apply/preview WorkspaceEdit over `changes` + `documentChanges`; code action apply by index; reload = shutdown + evict).
2. ✅ Workspace-wide diagnostics (`{"action":"diagnostics","file":"*"}` — aggregate cached publishDiagnostics across all live servers, per-file E/W counts) + `documentDiagnostic` pull for servers advertising `diagnosticProvider` (pull wins over last push on the saved path).
3. ✅ Per-file fan-out: `{"action":"diagnostics","file":...,"all":true}` queries every registered server covering the file and merges results tagged per server (single-coverage falls through to the primary path).
4. ✅ `symbol` / `symbol#N` position resolution on definition/references/rename/hover (word-bounded exact first, case-insensitive fallback, structured `LSP_SYMBOL_NOT_FOUND`; explicit `character` wins).
5. ✅ Must-have installer: registry `installServer()` runs the package-manager command (npm/pip/go/rustup, 5 min timeout, fail-soft) for missing python/ts/js primaries once per session at first nag; niche languages stay install-on-opt-in.

All five stages are in-tree; residual deltas vs upstream (lspmux, deferred-diagnostics ledger, writethrough editor integration) are IDE-side facilities without a dsh counterpart and are tracked as out of scope by the lsp spec's post-hoc sync ruling.
