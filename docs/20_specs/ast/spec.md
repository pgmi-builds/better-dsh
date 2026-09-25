# ast Specification

## Purpose
`ast` 是**纯 tool 设施**：无进程、无状态、无协议——文本进 → tree-sitter 语法树 → 结构匹配/改写 → 结果出。以 `dvc://ast` 设备面挂载（`ast_grep` 结构搜索 + `ast_edit` 结构改写，natives 懒加载），由 agent 在工具循环里主动调用；不设任何运行时拦截点、不订阅文件事件、不参与文本同步。与 hash-edit/LSP 的分工：结构问题归 ast，语义问题（类型/跨文件引用/诊断）归 LSP，锚点编辑归 hash-edit。

## Requirements

### Requirement: Pure tool semantics
The ast device SHALL behave as a stateless function: every call carries its inputs (pattern, paths, content) and returns its result; no server process, no document mirror, no cross-call state SHALL exist.

#### Scenario: Stateless call
- **WHEN** the agent invokes `ast_grep` twice with identical inputs
- **THEN** both calls parse independently and return identical results, with no cached tree or warm process in between

### Requirement: Lazy natives, zero startup cost
Parser natives SHALL load lazily on first use (natives-loader); host start and agent session start SHALL NOT spawn anything or load grammar binaries.

#### Scenario: Cold session
- **WHEN** a session ends without ever invoking the ast device
- **THEN** no native library was loaded and no subprocess was created for it

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
