# Chapter 15: Subsystems — Tool Execution (Shell, Sandbox, FS)

## Core Idea
`ctx.tools` (`ToolRuntime`) is the single registration/dispatch pipeline every tool call traverses (`tools/pre-execute` → guards → `tools/execute` → `tools/post-execute` → `finalizeContent` → `tools/result`), while each execution capability — shell, filesystem, subprocess, sandbox, LSP, code-runtime — is an optional **capability seam** (Service Definition + Provider + Consumer) whose provider can be swapped without changing tool schemas. Two independent knobs, sandbox mode (`sandbox/mode`) and approval policy (`approval/policy`), are resolved **per call** and fail closed.

## Frameworks Introduced
- **ToolRuntime dispatch pipeline**: registry + extensible waterfalls over one call.
  - When to use: register tools, gate calls, wrap dispatch, observe outcomes.
  - How: `ctx.tools.register(definition)` (global or agent scope); `execute(ToolExecutionInput)` materializes/freezes args, assigns an opaque `ToolExecutionToken`, then runs the waterfalls in fixed order; `schemas(scope)` projects an allowlist (`name`/`description`/`parameters` only) so `output`/`execute`/callbacks never leak into model requests.
- **Capability seam pattern**: abstract service (`ctx.shell`, `ctx.fs`, `ctx.subprocess`, `ctx.sandbox`, `ctx.lsp`, `ctx.codeRuntime`), one provider per context (a second throws, cordis duplicate-service behavior), and a tool Consumer owning the model-facing schema.
  - When to use: adding an alternate backend (remote fs, sandboxed bash) or a new tool-backed capability.
  - How: subclass the abstract seam, load as plugin; the seam — not the loop spine — owns the vocabulary.
- **`resolve()` request/spec split**: caller-facing request has optional fields; `resolve()` fills implementation defaults/caps into a fully-resolved spec.
  - When to use: "explicit > implicit at package boundaries" — never hide a `??` default inside the execution method. Used by `ctx.shell.resolve`, mirrored by `SubprocessSpawnSpec` (no defaults at all).
- **Observation policy (read-before-write)**: `dsh-fs-observation-policy` turns bare `write`/`edit` into guarded mutations via `fs/*` events.
  - How: tool dispatches `fs/write-intent`/`fs/edit-intent` (single-slot first-wins waterfalls) and emits `fs/observed` (sync, side-effect-only listener); policy keeps `WeakMap<owner(session), Map<targetKey, FsObservation>>`.
- **Per-call sandbox policy**: `ctx.sandboxPolicy.resolve({session, mode?})` — precedence: approved explicit mode > session's last `sandbox/mode` event > deployment default; workspace root = session's immutable cwd (fs-canonicalized before lexical normalization). `ctx.sandbox.confine(argv, policy)` returns wrapped argv or throws.
- **Fail-closed approval**: only `allowed-once` grants; everything else denies.

## Key Concepts
- **ToolDefinition**: `ToolSchema` + mandatory `output` (schema + `render` + optional `presentationMeta`), `execute(args, exec)`, optional `timeoutMs`, `isConcurrencySafe`, `finalizeContent`, `presentCall`/`presentResult`.
- **PreToolDecision**: `{allow}` / `{deny, reason}` / `{ask, reason?}` — `ask` proceeds only on `allowed-once`; arguments can never be rewritten (history/audit/UI/execution must agree).
- **ToolGuard**: monotonic post-waterfall check — returns a denial reason or `undefined`; no allow result, so ordering can't undo a denial.
- **PostToolDecision**: `accept` (replace content XOR value — value is revalidated and recomputes content) or `block` (feedback becomes `isError`).
- **ToolRestriction**: per-scope `{allow?, deny?}` over inherited global tools; restrictions intersect; own scoped registrations stay exempt (delegated children keep their tools).
- **ShellExecSpec / ShellRunResult**: resolved spec; orthogonal outcome fields (`timedOut` XOR `aborted`, `exitCode`, `signal`) so a killed run never reads as clean success.
- **ShellProcess**: background handle — `readOutput()` is incremental/consuming, `done` never rejects, `kill()` idempotent; no id/owner (generic job runtime owns identity).
- **CollectedOutput**: truncated stream keeps the **tail** in `text` + `spillPath` to the complete stream.
- **FsTarget / FsVersion**: opaque branded identity and freshness token — consumers must not parse `targetKey` or interpret versions; use `processPath`/`fileUrl`/`contains` for cross-capability coordinates.
- **ConfinedArgv**: wrapped argv + `enforcement` + `denialSignatures` (this backend's dialect) + `runnerFailureRules`.
- **ApprovalOutcome**: `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'` — closed; missing/throwing/non-conforming answerer normalizes to `unavailable`.
- **CodeBindingNamespace**: one program-visible global of async host functions; args/resolutions must be lossless JSON; names are hostile input (null-prototype, `__proto__` is an own property).

## Mental Models
- Think of tool dispatch as a **fixed waterfall with monotone permissions**: policy can only shrink access (pre-execute deny/ask → guard deny); post-execute can reshape results but never retro-authorize.
- Use `ask` when a call is conditionally safe — it is a denial unless an approval service returns `allowed-once`; prefer `deny` for never-safe and `allow` for always-safe.
- Think of the sandbox as an **argv wrapper, not a jail**: `confine()` swaps the argv and hands back classification dialects; the consumer spawns and attributes outcomes. Network/process visibility are outside the vocabulary.
- Treat FS authorization as **freshness, not windows**: any windowed read that emits a present `fs/observed` authorizes a later guarded write/edit iff the version is unchanged; there is deliberately no `FS_PARTIAL_OBSERVATION`.

## Anti-patterns
- **Silent unconfined passthrough**: illegal for a confined policy — no usable backend must surface as `SANDBOX_UNAVAILABLE` (foreground throw) or `runnerFailed` (settled background), never as an unsandboxed run.
- **Inferring denial from exit status or cross-backend stderr unions**: exit status never proves runner failure; match only the returned backend's own `denialSignatures` (EROFS/bwrap, EACCES/Landlock, EPERM/Seatbelt), and check `runnerFailureRules` (fatal signature + optional exit-code gate, informational lines excluded) first.
- **Parsing `targetKey`/`FsVersion` or host-path rules on LSP URIs**: both are branded opaque; use `processPath`, `contains`, and `resolvedWorkspaceUri`.
- **Adding a `timeoutMs` to fs reads**: the seam can't enforce a deadline on an in-progress `fsync`/`rename` — cancellation propagates via the execution signal only (bash/web/glob/grep are process-backed and do carry timeouts).
- **Treating `isolation` (`'worker-thread'|'process'|'container'`) as a security claim**: it's a diagnostic label; sandboxing is the sandbox seam's job.
- **Async listener in `fs/observed`**: must be synchronous and side-effect-free — a throw can replace a read error or surface after a successful mutation.

## Code Examples
```ts
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
type SandboxEnforcement = 'full' | 'partial';
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
type ApprovalPolicy = 'ask' | 'never';   // never: rejected before any answerer runs
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string };
type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover';
type CodeRunFailureKind =
  'exception' | 'timeout' | 'abort' | 'worker-exit' | 'invalid-output' | 'output-limit';
```
```ts
// Escalation path (one-shot, strictly wider):
const spec = ctx.shell.resolve({ command, workdir, sandboxPolicy:
  ctx.sandboxPolicy.resolve({ session, mode: 'workspace-write' }) });
// model-side: sandbox_permissions + justification on a denied call;
// ctx.approval must grant that exact call before anything executes.
```

## Reference Tables

| SandboxMode | File effects | Notes |
|---|---|---|
| `read-only` | denies writes; POSIX grants `/dev/null` sink | Windows ACL runner: no writable root, reports `partial` |
| `workspace-write` | workspace root + backend temp area | root = session immutable cwd |
| `danger-full-access` | bypass | consumer spawns original argv, never calls `ctx.sandbox` |

| FS state → decision | write | edit |
|---|---|---|
| unseen | `createIfAbsent` | `FS_NOT_OBSERVED` |
| absent | `createIfAbsent` | `FS_NOT_FOUND` |
| present@version | `replaceIfVersion` | version guard (checked **before** literal match) |

| Preset (default table) | sandbox | approval |
|---|---|---|
| `workspace-write` | workspace-write | ask |
| `danger-full-access` | danger-full-access | never |
| `custom` (derived-only) | — | — reserved key, never a switch target |

Key `FsErrorCode`s: `FS_NOT_OBSERVED` (no prior observation / create hit existing), `FS_STALE_VERSION`, `FS_SANDBOX_DENIED` (policy fence — distinct from kernel `FS_PERMISSION_DENIED`), `FS_TOO_LARGE`, `FS_AMBIGUOUS_EDIT`, `FS_EDIT_NOT_FOUND`, `FS_ABORTED`. LSP codes: `LSP_UNAVAILABLE`, `LSP_CONFLICT`, `LSP_INVALID_PROVIDER`, `LSP_DISPOSED`, `LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE`.

## Key Takeaways
1. Register via `defineTool` (validates/narrows args, infers return from `output.schema`); raw `ToolDefinition`s validate their own `args: unknown`. Mismatches throw `ToolArgsError` (`INVALID_ARGS`) / `ToolOutputError` (`INVALID_TOOL_OUTPUT`); invisible tools fail as `UNKNOWN_TOOL` without ending the turn.
2. `ctx.shell.run()` resolves on nonzero exit/timeout/abort (rejects only for infrastructure failures); `start()` returns a handle the tool adapts into `ctx.jobs` — the shell seam itself is task-free.
3. `DSH_*` env is a managed namespace: executors discard ambient values and merge `ctx.shellEnv`'s snapshot last, so caller `env` entries can never displace managed facts; `stdin`/`env`/`stdoutMaxBytes` are trusted-plugin-only, not model parameters.
4. `SubprocessHandle.terminate()` (SIGTERM→`graceMs`→SIGKILL, tree-scoped, also fired by the spec's abort signal) is the only termination verb; `waitForExit()` observes the whole tree; `done` carries exit facts only — cause classification (`timedOut`/`aborted`) belongs to the caller.
5. Approval `request()` requires an open turn and appends the `approval/asked`/`approval/decided` audit pair (log-only, outside the model transcript); abort → `cancelled`, late answers discarded.
6. Presets own no enforcement: `set()` writes through `setSandboxMode` + `setApprovalPolicy` only when a knob changes, after a log-only `permission/preset` event; requires a confining executor (with `sandboxMode` capability fact) or load fails.
7. `ctx.codeRuntime.run()` reports errors as result fields, never rejections; programs run as async-function bodies (top-level `await`/`return`); `language` is `'typescript'` (released) / `'python'` (experimental, private).

## Connects To
- **Ch 07**: capability seams — the Service Definition/Provider/Consumer split formalized here per capability.
- **Ch 11**: tool catalog — the concrete first-party tools (`bash`, `read`/`write`/`edit`, `lsp`, `run_code`) built on these seams.
- **Ch 14**: the agent loop drives `executionMode` (parallel/exclusive barriers from `isConcurrencySafe`) and commits `tool/call`/`tool/result` events.
- **Ch 10**: config keys (`sandbox/mode`, `approval/policy`, preset tables, executor defaults/caps).
- **Ch 16**: `fs/observed` state and audit/preset events are session-log-owned durable facts.
