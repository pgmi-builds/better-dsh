# ast Specification

## Purpose
`ast` 是**纯 tool 设施**：无进程、无状态、无协议——文本进 → tree-sitter 语法树 → 结构匹配/改写 → 结果出。以 `dvc://ast` 设备面挂载（`ast_grep` 结构搜索 + `ast_edit` 结构改写，natives 懒加载），由 agent 在工具循环里主动调用；不设任何运行时拦截点、不订阅文件事件、不参与文本同步。与 hash-edit/LSP 的分工：结构问题归 ast，语义问题（类型/跨文件引用/诊断）归 LSP，锚点编辑归 hash-edit。

## Requirements

### Requirement: Pure tool semantics
The ast device SHALL behave as a stateless function: every call carries its inputs (pattern, paths, content) and returns its result; no server process, no document mirror, no cross-call state SHALL exist.

#### Scenario: Stateless call
- **WHEN** the agent invokes `ast_grep` twice with identical inputs
- **THEN** both calls parse independently and return identical results, with no cached tree or warm process in between

### Requirement: Lazy in-package engine, zero startup cost
The ast device's WASM engine SHALL load lazily on first use; host start and agent session start SHALL NOT parse anything or load grammar binaries. The engine and its grammars SHALL ship inside the package (`lib/ast-assets/`) and SHALL require no network access, no npm resolution, and no `.vendor` provisioning at call time.

#### Scenario: Cold session
- **WHEN** a session ends without ever invoking the ast device
- **THEN** no WASM engine was instantiated and no grammar binary was loaded

#### Scenario: Offline first use
- **WHEN** the device is first invoked with no network access and no `.vendor` directory
- **THEN** the search still completes from the in-package engine

### Requirement: dvc scheme surface only
The ast capability SHALL expose exclusively through the `dvc://ast` write/read contract (bare `dvc://` roster lists it; `dvc://ast` read returns its doc; `dvc://ast` write dispatches). No dedicated tool name, no scheme branches in read/grep/glob, and no hook into read/write/edit flows SHALL be added.

#### Scenario: Surface inventory
- **WHEN** the model-facing tool surface is enumerated
- **THEN** ast appears only as the `dvc://ast` device — its invocation is an ordinary `write` the agent decides to make

### Requirement: Structural semantics boundary
The ast device SHALL provide structural matching/rewriting only. It makes no claim about types, cross-file references, or diagnostics; a deployment wanting semantics SHALL use the lsp capability instead.

#### Scenario: No semantic answers
- **WHEN** the agent asks the ast device for type information or project diagnostics
- **THEN** no such capability exists on the device surface (the call is not offered)

### Requirement: Diagnostic fields (deliberate divergence from the native predecessor)
The ast devices SHALL surface failure modes that the native predecessor swallowed silently (0.2.6 contract addition). `ast_grep` results SHALL carry `patternErrors?: string[]` — present (non-empty) iff at least one supplied pattern failed to compile as a single-root AST node, one entry per failing pattern formatted `pattern <index> ("<pattern text>"): <underlying message>`; multi-root patterns land here and matches from the remaining patterns still return — and `pathNotFound?: boolean` — `true` only when the resolved target path does not exist on disk, absent otherwise. `ast_edit` results SHALL carry the same `patternErrors` semantics over `ops[].pat` (a failing op contributes no edits), `overlapping?: number` — the count of edits dropped by the overlap guard, present only when greater than zero — and the same `pathNotFound` semantics (true when at least one resolved target root does not exist on disk). Patterns that fail with a hard syntax compile error SHALL still throw through as `DVC_DEVICE_ERROR`. The devices perform no workspace boundary check — the boundary is the approval/policy layer — and `ast_edit` writes whatever paths it is given. All pre-existing fields keep their names and semantics.

#### Scenario: Multi-root pattern is reported, not swallowed
- **WHEN** `ast_grep` runs a multi-root pattern (e.g. `"alpha": $V`) that fails to compile as a single-root AST node
- **THEN** the result carries `patternErrors` with one entry naming the pattern index, the pattern text, and the underlying message, and zero matches from that pattern — instead of an indistinguishable empty result

#### Scenario: Missing path is distinguishable from zero matches
- **WHEN** the resolved target path does not exist on disk
- **THEN** the result carries `pathNotFound: true` with `filesSearched: 0`, so "nothing there" is no longer confused with "pattern matched nothing"

#### Scenario: Overlap-guard drops are counted
- **WHEN** `ast_edit` ops produce edits that overlap an already accepted edit
- **THEN** the first-registered op wins, the shadowed edit is dropped, and the result reports the dropped-edit count in `overlapping` instead of dropping it silently

#### Scenario: Hard syntax errors still throw
- **WHEN** a pattern fails with a hard syntax compile error (e.g. `$$$`)
- **THEN** the device throws and the caller receives the structured `DVC_DEVICE_ERROR`, exactly as before
