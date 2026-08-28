# Better Dsh — Dashr

DASHR is a persistent-kernel REPL for the DeepSeek Harness (dsh): a
**stateful `ctx.replRuntime` provider** (one persistent IPython kernel
subprocess **per session**, the run's `principal`, held in a map inside the
one service instance per mount). Each `run()` is one cell on the calling
session's kernel; variables, imports, and definitions assigned in run N
survive into run N+1 — *state codification* (blueprint §1.1 channel ②),
deliberately NOT the per-run isolation a one-shot execution backend
provides — and two sessions sharing one service instance never see each
other's variables.

Naming (v0.1.5 layer model): the runtime class is **`DashrRuntime`** — the
standing-mount-layer component (one instance per mount holding the
cross-session kernel map), and therefore the de facto daemon while the
profile-level `DashrDaemon` concept stays an empty shell; the session layer
is the ipykernel subprocess itself, a pure interpreter with no harness
awareness.

The presentation half — the `eval` transport tool, the Python SDK renderer,
and the tool→binding bridge — lives in the SAME package (merged in v0.1.8;
the pre-merge `dsh-rlm-mode`/`dashr-presentation` sibling split is gone).
The runtime registers the service key `replRuntime` through its own vendored
Service Definition (see `src/vendored/repl-runtime.ts`), so it carries **zero
dsh runtime package dependencies**: only `@deepseek-ai/cordis` (peer),
`schemastery`, and `zeromq`.

## Package positioning

- npm name: `@pgmi-builds/better-dsh`.
- A standard Cordis plugin (`Context` + schemastery `Config`, every tunable
  configurable from `cordis.yml`, no hardcoded tunables).
- "Registrations are effects": the kernel lifecycle (lazy spawn on a key's
  first `run()`, teardown on that session's `agent/disposed`, optional
  snapshot at either teardown) is effect-owned, so plugin disposal tears
  every subprocess down.
- Published surface: `lib/` only (`files: ["lib"]`, `main`/`types`/`exports`
  pointing at `lib/index.js` / `lib/index.d.ts`) — the build emits beside the
  manifest (`outDir: 'lib'`; the tsdown default `dist/` left the exports map
  dangling, fixed in M2B). The root also re-exports the vendored Service
  Definition's public contract (`ReplRuntime` plus the `CodeRun*` /
  `CodeBinding*` / `CodeJsonValue` types) so consumers depend on the
  published shape instead of reaching into sources. The declaration keeps
  dependency imports external (`dts: { resolve: false }`): bundled copies
  would create duplicate type identities in a consumer's program.

## Install

```sh
npm install @pgmi-builds/better-dsh
```

The runtime OWNS its kernel environment. With `python` left at the
`python3` sentinel (or absent), it provisions a managed venv under the
package (`.venv-kernel`) on first use, installing `ipykernel` + `dill`
(CPython 3.11) — no `/tmp` symlink, no blind trust in a host `python3`.
An explicit `python` (or `DASHR_KERNEL_PYTHON`) is verified instead. For
development and tests, pre-create the venv:

```sh
npm run kernel:venv        # uv venv .venv-kernel --python 3.11 + ipykernel + dill
```

Tests pick the kernel interpreter from `DASHR_TEST_PYTHON`, falling back to
`./.venv-kernel/bin/python`, then `python3` — see `test/helpers.ts`.

## Configuration

Every field of the plugin `Config` (schemastery defaults shown):

| Field | Default | Meaning |
| --- | --- | --- |
| `python` | `python3` | Explicit interpreter with `ipykernel`; the bare `python3` sentinel (or absent) selects a managed venv under `kernelEnvDir`. |
| `startupTimeoutMs` | `30000` | Budget for kernel spawn → ready, in milliseconds. |
| `runTimeoutMs` | `120000` | Wall budget per run; expiry interrupts the kernel then force-settles. |
| `interruptGraceMs` | `2000` | Grace between a timeout/abort interrupt and the force-settle. |
| `interruptConfirmMs` | `250` | Confirm window between the control-channel interrupt and the SIGALRM escalation (must be `< interruptGraceMs`); see "Interrupts" below. |
| `disposeTimeoutMs` | `5000` | Budget for graceful kernel teardown (shutdown_request → SIGKILL). |
| `snapshotTimeoutMs` | `30000` | Budget for internal snapshot/restore cells (dill dump/load). |
| `maxOutputBytes` | `67108864` | Hard cap for serialized log-array, completion-value, and failure-message payloads. |
| `snapshotDir` | *(unset)* | Base directory for per-session namespace snapshots (`<dir>/<principal>/state.dill` + `manifest.json`); none when absent. |
| `snapshotSizeCapBytes` | `268435456` | Serialized-size cap for a turn-end snapshot; over-cap snapshots are skipped (one-time model warning). |
| `username` | `dashr` | Jupyter username stamped on wire messages. |
| `kernelEnvDir` | *(unset)* | Managed venv directory (defaults to `<package>/.venv-kernel`). |
| `kernelPythonVersion` | *(unset)* | Preferred CPython version for a managed venv (default `3.11`). |
| `kernelAutoInstall` | `true` | Provision the managed venv (`ipykernel` + `dill`) on first use. |

## Persistent-state semantics

- **Cell semantics**: each `run({ program })` is one cell on the calling
  session's kernel namespace (`user_ns`) — a pure IPython REPL. Top-level
  `await` works; a top-level `return` is a SyntaxError, exactly as in a
  native IPython cell. The completion value is the LAST expression's value
  (REPL displayhook-style): a statement-ending cell or a `None` final
  expression yields no `value` field, and a non-JSON value comes back as its
  repr text.
- **Session keying** (M3-A): one kernel per distinct `request.principal`
  (the presentation bridge passes the calling agent's session id); runs
  without a principal share one default key, preserving M1 semantics. The
  service instance count is unchanged — one per mount — the keying is a
  `Map<principal, kernel>` inside the provider.
- **Kernel lifetime**: lazy start on a key's first `run()`; teardown when
  that session's agent is disposed (the dsh `agent/disposed` event, payload
  `{ agent: { id } }`, listened through the untyped cordis event service to
  keep this package's zero-dsh-dependency rule) and on plugin disposal
  (`shutdown_request`, then SIGKILL after `disposeTimeoutMs`). A kernel that
  dies unexpectedly is never reused in-process: it respawns onto its nearest
  replayable snapshot (or a fresh empty kernel when none exists) and the run
  that observed the death gets an explicit `worker-exit` naming what was lost.
- **Turn-end snapshots** (M3-B): with `snapshotDir` configured, every
  successful run is followed by a size-capped snapshot cell that dumps the
  user namespace to `<snapshotDir>/<principal>/state.dill` + `manifest.json`
  (`turn`, `pythonVersion`, `venvPath` = the kernel's own `sys.executable`,
  `skills`, `names`, `sizeBytes`). A namespace whose serialized size exceeds
  `snapshotSizeCapBytes` is skipped — estimated BEFORE any dill IO by a
  bounded walk that reads numpy/pandas in-memory footprints, then confirmed
  against the actual `.part` dump — and the model is warned once through the
  run's own logs. Skipped snapshots never replace the previous good one.
- **Restore-on-first-boot** (M3-B): a key's first kernel boot restores its
  on-disk snapshot before running user code. The kernel validates the
  manifest itself (python version, interpreter identity, skills); a
  non-replayable snapshot degrades to an EMPTY namespace and the first run
  tells the model so. Variable state and the append-only transcript are NOT
  transactionally consistent (blueprint §8.3): the snapshot is a point-in-time
  namespace capture that can lag the transcript, and a degraded restore never
  fabricates variables the transcript once saw.
- **Interrupts** (M3-A hardened): aborts/timeouts escalate in two phases —
  the zmq control `interrupt_request` first, then SIGALRM only after
  `interruptConfirmMs` if the cell has still not settled. The kernel-side
  bootstrap installs a busy guard that only raises `KeyboardInterrupt` while
  a dashr cell is actually executing, so a signal landing on an idle or
  booting kernel is swallowed instead of terminating the process (the M1
  same-tick dual send killed idle kernels deterministically — 10/10
  same-tick, 8/10 at +1-2ms, 40/40 during cold boot; see
  `test/interrupt-race.spec.ts`). The hard-abort contract is intact: a busy
  `while True: pass` still breaks inside the grace (blueprint §10.4).
- **Concurrency**: the bridge serializes cells per kernel (`executeCell`
  awaits the previous cell), so concurrent `run()` calls on one session
  queue rather than interleave; see `test/parallel.spec.ts`. Runs on
  DIFFERENT principals execute on their own kernels concurrently.
- **What snapshots do NOT carry**: nothing outside the kernel namespace is
  ever in scope — the v0.1.8b removal deleted the Continual Harness
  (`refine()`, `harnessDir`) entirely, so the snapshot/restore cycle's only
  persistence channel is the kernel namespace itself (blueprint §8.4).
  Anything a cell stores in ordinary variables follows the snapshot rules
  above as before.

## Testing

```sh
npm install
npm run kernel:venv     # once; or export DASHR_TEST_PYTHON=/path/to/python
npm run typecheck       # tsc --noEmit
npm test                # vitest --run (fileParallelism: false)
```

Teardown discipline: every test context is disposed through
`onTestFinished`, and CI must assert no orphan kernels remain:

```sh
pgrep -cf -- '-[m] ipykernel_launcher' || echo no-orphans
```

(The `-[m]` trick prevents `pgrep` from matching itself; 208 orphaned
kernels once exhausted machine memory while every unit test stayed green —
blueprint §10.8/§10.9.)

---

# Presentation half (eval transport, SDK, bindings)

The DASHR agent-plane presentation (blueprint §7.4): the plugin half that
presents the persistent-kernel runtime to the model as **cells on one
persistent IPython kernel**. It contributes:

- **`eval`** — the cell transport tool: one call = one cell on the calling
  session's kernel (the `ctx.replRuntime` service). Variables, imports, and
  definitions survive across calls. Nested tool calls ride the host
  registry's native scheduling pipeline as `await tool.name({...})` inside
  the cell — one positional arguments object per call, keyword arguments
  rejected. Every registry-visible tool is bound as a member; the
  `send_message` bridge callable joins them in the same catalog block.
- **`dashr:tool-catalog`** — a generated Python SDK prompt section: one
  `async def name(args) -> Output` per visible tool (flat `tool.*` shape)
  plus the cell contract (persistent namespace, completion-value rules,
  `ToolCallError`, sub-call concurrency).
- **The model-direct collapse** — an assembly filter leaves `eval` the only
  contributed tool schema, and a monotonic guard denies a model-direct call
  naming anything else with the route back into a cell. Both are scoped to
  the mounting composition, so a PTC (native Code Mode) preset in the same
  process keeps its own presentation.
- **Masking (ADR-0002)** — exactly two upstream tool names are displaced
  from the model's surface (`send_message` and the child-scoped `report`),
  collapsed into the single dual-direction `send_message` bridge. Every
  other delegation tool (`subagent`, `subagent_fork`, `list_agents`,
  `interrupt_agent`, `workflow`, `ralph`) stays **directly exposed** as a
  native `tool.*` binding — the model calls it exactly as the host ships it.
  Masking is presentation-only: the registry is never touched.

Removed in v0.1.8b: the `refine` Continual Harness and the `compact` REPL
bridge (harness/refine became third-party territory; context compaction is
the host runtime's business, not the REPL's).

## Install

The canonical path is the repo-root one-click installer (`install.sh`): it
installs the plugin from the npm registry and notes the restart. The
equivalent manual steps, for reference:

```sh
# 1. plugin — the pnpm registry-metadata cache can lag a fresh npm publish
#    by minutes-to-hours, so drop it first, or `@latest` resolves the OLD
#    version right after a release:
rm -rf ~/.cache/pnpm
dsh plugin --profile web add --config.auto-install-peers=false @pgmi-builds/better-dsh@latest

# 2. restart the running instance:  systemctl --user restart dsh
```

Notes: `--config.auto-install-peers=false` is MANDATORY — the profile
already resolves `@deepseek-ai/*` peers through the harness install; letting
the package manager auto-install them adds a second, divergent copy of
cordis and friends. The version is deliberately unpinned (`@latest`).

## Coexistence with a PTC Code-Mode session

`eval` is our own transport name (the registry reserves `run_code`), so a
Code-Mode preset (`@deepseek-ai/dsh-agent-tool-presentation` with
`mode: code` over the host-plane worker-thread `codeRuntime`) composes
beside a DASHR session in one process: the PTC agent's assembly shows
`run_code` plus the TS `tools:sdk` section, the DASHR agent's shows `eval`
plus the Python `dashr:tool-catalog`, and neither execution path touches
the other's runtime.

## Composition

```ts
import dashr from '@pgmi-builds/better-dsh'

ctx.plugin(dashr, { maxParallelSubCalls: 10 })
```

One plugin, one row: `apply` mounts `DashrRuntime` first (providing
`ctx.replRuntime`), then the presentation half injects on `replRuntime` —
a composition without the runtime fails AT MOUNT, named in the preset's
activation audit, instead of at the first prompt. The dashr bundle patch
mounts the row on the HOST plane, so every agent in every preset sees the
`eval` tool (`agent → preset → global`).

## Delegation and messaging

The upstream delegation tools stay REGISTERED, EXECUTABLE, and directly
bound — `subagent`, `subagent_fork`, `list_agents`, `interrupt_agent`,
`workflow`, `ralph` are ordinary `tool.*` members the model calls exactly
as the host ships them. Two names are displaced by the single
`send_message` bridge (ADR-0001): upstream `send_message` (the
parent→child downlink) and the child-scoped `report` (the child→parent
uplink) collapse into one dual-direction channel:

- `await tool.send_message({"receiver": "child", "message": ..., "subagent_id": ...})`
  delivers down through the tool layer;
- `await tool.send_message({"receiver": "parent", "message": ...})` reports
  up through the SERVICE layer (`ctx.subagents.reportFrom(...)`) — live
  continuable children only; a root agent gets a structured `UNAUTHORIZED`.

Every binding returns structured JSON; errors are a FIELD on the result,
never a host crash — a missing `ctx.subagents` service, a depth cap, an
unknown id, or an infrastructure rejection all map to an `error` string.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `maxParallelSubCalls` | `10` | Cap on one cell's overlapping sub-calls (native scheduler contract; `1` = strictly serial). |
| *(runtime keys)* | — | The runtime slice (`python`, `snapshotDir`, timeouts, caps, kernel-env knobs) is documented in the Configuration table above. |

## Tests

```sh
npm install
npm run kernel:venv     # once; or export DASHR_TEST_PYTHON=/path/to/python
npm run typecheck
npm test                # vitest --run
```

The suite needs a Python interpreter with `ipykernel` (+ `dill` for the
snapshot tiers) for the real-kernel specs; it resolves one from
`DASHR_TEST_PYTHON`, then `./.venv-kernel/bin/python`, then `python3` —
see `test/helpers.ts`.

## Relationship to upstream

Structure mirrors `@deepseek-ai/dsh-agent-tool-presentation` and the Code
Mode half of `@deepseek-ai/dsh-tools` (0.1.1-rc.2), re-pointed at the
vendored `replRuntime` Service Definition. See the module docs in
`src/index.ts` for the deliberate deltas (`eval` vs `run_code`, ordinary
scoped registration, guard-based collapse, mirrored `tools/code-dispatch-log`
waterfall).
