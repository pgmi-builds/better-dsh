# REPL Pad Kernel Provisioning — Test Report & Forward Requirement

- Date: 2026-06-03
- Scope: DSH Web GUI session — `eval` (dashr REPL pad) kernel lifecycle, `dvc://` device surface smoke check
- Result: **FAIL on first-run → FIXED (manual provision) → PASS**; forward requirement recorded below for the next dev phase

---

## 1. What was tested

| # | Test | Outcome |
|---|------|---------|
| T1 | REPL pad first cell after a cold runtime (`eval "print(6*7)"`) | **FAIL** — kernel failed to start (`worker-exit`) |
| T2 | Root-cause probes: filesystem writability, toolchain presence | PASS (diagnosed EROFS on `uv` cache) |
| T3 | Managed kernel venv provisioned with redirected caches | PASS |
| T4 | REPL pad retest after provision (`eval`, state persistence probe) | **PASS** — `pad alive: 42`, CPython `3.11.15` |
| T5 | `dvc://` device surface (`read dvc://`, `read dvc://browser`) | PASS — roster serves `ast_edit`, `ast_grep`, `browser`, `lsp` |

## 2. Environment facts (this host)

| Item | Value |
|------|-------|
| Root filesystem | `/dev/sdc3 / ext4 ro` — **read-only** (container/image layout) |
| Writable bind mount | `/dev/sdc3 /home/u1/workspaces/dashr ext4 rw` only |
| `uv` cache home | `/home/u1/.cache/uv` — **on the read-only root → EROFS** |
| `uv` | `0.11.15` (present; preferred by kernel-env provisioning) |
| System Pythons | `3.14.4` (default `python3`), `3.11.15` (`/home/u1/.local/bin/python3.11`) |
| Pad runtime package | `packages/better-dsh/better-dsh` (managed venv default `<package>/.venv-kernel`) |
| Managed venv (provisioned) | CPython `3.11.15`, `ipykernel 7.3.0`, `dill 0.4.1` |

## 3. Failure & root cause

**Observed** (first `eval` after cold start):

```
Error: code run failed (worker-exit): kernel failed to start:
Command failed: uv venv .../.venv-kernel --python 3.11
error: Could not acquire lock
  Caused by: Could not create temporary file
  Caused by: Read-only file system (os error 30) at path "/home/u1/.cache/uv/.tmpmqu7oz"
```

**Root cause**: the dashr runtime owns a *managed* kernel venv and provisions it on first use via `uv` when no explicit interpreter is configured (`kernel-env.ts`: `createVenv`/`installDeps`, `python: python3` sentinel → managed). `uv` always stages a lock temp file under its cache dir (`~/.cache/uv`, overridable via `UV_CACHE_DIR`). On this host the root FS (and therefore `~/.cache`) is genuinely read-only, so provisioning cannot even start — an environment-portability defect, not a code bug in the provisioning logic itself.

Supporting facts: provisioning is **retry-safe** (`runtime.ts` clears a rejected `kernelEnvPromise` in `.catch`, so the next `eval` retries) and **idempotent** (`ensureVenv` reuses a complete venv — `ipykernel && dill` present — without invoking `uv` again).

## 4. Remediation applied (this session, host-local)

1. Probed writability: `/tmp` ✅, `/home/u1/.cache` ❌ readonly (confirmed), dashr package dir ✅, repo-local cache dir ✅.
2. Provisioned the managed venv **at the runtime's default location** so future `eval`s skip `uv` entirely:

```bash
REPO=/home/u1/workspaces/dashr/upstream/deepseek-harness
PKG="$REPO/packages/better-dsh/better-dsh"
export UV_CACHE_DIR="$REPO/.uv-cache" \
       UV_PYTHON_INSTALL_DIR="$REPO/.uv-python" \
       UV_LINK_MODE=copy
cd "$PKG"
uv venv .venv-kernel --python 3.11
uv pip install --python .venv-kernel/bin/python ipykernel dill
```

3. Verified interpreter: `OK 3.11.15 ipykernel 7.3.0 dill 0.4.1`.
4. Re-ran `eval` → PASS (see T4). The complete venv is reused on every later start; no further `uv` invocation.

Artifacts left on disk (build state, not tracked source): `<package>/.venv-kernel`, sibling `$REPO/.uv-cache`, `$REPO/.uv-python`.

## 5. Forward requirement — R1 (next dev phase)

> **Proper kernel provisioning at installation time is a requirement, across all environments (prod / dev / test).**

First-run lazy provisioning must **not** be the only path: an environment where the interpreter cannot be provisioned at runtime (read-only root, no writable home/cache, air-gapped, no `uv`) currently bricks the REPL pad entirely. The coming dev phase must make kernel setup an explicit, environment-aware installation step.

Proposed acceptance criteria (to be confirmed/refined in the dev plan):

- **R1.1 Install-time provision hook.** `npm run kernel:venv`-equivalent (already exists) is promoted to part of standard install; runtime lazy-provision remains only as a fallback for writable dev hosts.
- **R1.2 Environment profiles.** prod / dev / test each declare kernel policy: explicit interpreter path vs. managed venv dir, auto-install on/off, version pin (`kernelPythonVersion`), and fail-fast behavior — surfaced as config, not code (`kernelEnvDir`, `kernelAutoInstall`, `kernelPythonVersion` already exist in the runtime config schema).
- **R1.3 Writable-cache independence.** Provisioning must set/respect `UV_CACHE_DIR` / `UV_PYTHON_INSTALL_DIR` (or fall back to `python3 -m venv` + `ensurepip`) so read-only `~/.cache` or read-only root never blocks the pad.
- **R1.4 Verification gate.** Install/CI runs a probe (`import ipykernel, dill`) and fails loudly with the actionable message already implemented in `kernel-env.ts` (`run 'npm run kernel:venv' … or set kernelAutoInstall: true`).
- **R1.5 CI coverage.** dev/test CI exercises a cold start (no venv) and a pre-provisioned start; prod smoke test asserts the pad boots on first `eval` (or fails fast at deploy).
- **R1.6 Docs.** One page: how each profile's kernel is provisioned, verified, and repaired — this report's §4 command becomes the canonical snippet.

## 6. Open items

- Host `python3` default is 3.14 while the managed venv pins 3.11 — confirm the intended matrix (the runtime already probes/pins independently of PATH default).
- Decide whether the GUI should surface kernel provisioning status/errors (today failures surface only through the `eval` error).
- `/tmp` is writable here but tmpfs-reaped on reboot — prefer repo/home-adjacent venv dirs (current default already avoids `/tmp` by design; keep it).
