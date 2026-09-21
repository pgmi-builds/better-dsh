/**
 * Kernel environment resolution and provisioning.
 *
 * The runtime OWNS the interpreter it spawns: it never trusts a bare
 * `python3` on the PATH, because that interpreter may lack `ipykernel`
 * (hard failure — the kernel cannot start) or `dill` (snapshot capability —
 * silently degrading to no snapshots). Instead it resolves one of two
 * environments:
 *
 * - **Explicit** — `config.python` names a real interpreter (a path, or any
 *   name other than the bare-`python3` sentinel the default/patch produce).
 *   It is probed, and a missing `ipykernel` is a loud error while a missing
 *   `dill` is a loud warning (snapshots disabled).
 * - **Managed** — no explicit interpreter: the runtime provisions a venv
 *   UNDER THE PACKAGE (`<packageRoot>/.venv-kernel`, or `config.kernelEnvDir`)
 *   with `ipykernel` + `dill`, installing it on first use when
 *   `config.kernelAutoInstall` is on. The venv lives beside the package, NOT
 *   in `/tmp` (the pre-v0.1.9 dangling-symlink failure mode), so it survives
 *   the host's tmp reaper and the process restart.
 *
 * Provisioning uses `uv` when available (fast, can fetch the pinned CPython
 * version), falling back to `python3 -m venv` + `ensurepip`. It is idempotent:
 * a complete venv is reused untouched; a partial one is repaired.
 * @module dashr/kernel-env
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** The installed package root (where `lib/` and `src/` live): the default home of the managed venv. */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The config value meaning "no explicit interpreter — auto-manage a venv". */
export const AUTO_PYTHON_SENTINEL = 'python3'

/** Preferred CPython version for a managed venv. */
export const DEFAULT_KERNEL_PYTHON_VERSION = '3.11'

/** Pinned, tested `ipykernel` version (2026-09-02 tested value; upgrade = explicit change + regression). */
export const IPYKERNEL_VERSION = '7.3.0'

/** Pinned, tested `dill` version. */
export const DILL_VERSION = '0.4.1'

export interface KernelEnv {
  /** Absolute path to the interpreter to spawn (`-m ipykernel_launcher`). */
  python: string
  /** True when this runtime provisioned a venv (vs an explicit interpreter). */
  managed: boolean
  /** The managed venv root, when {@link managed}. */
  venvDir: string | undefined
  /** True when `dill` is importable — snapshot capability is available. */
  dill: boolean
  /** True when `ipykernel` is importable (a hard requirement). */
  ipykernel: boolean
  /** The interpreter's reported version, e.g. `3.11.15`. */
  version: string
}

export interface ResolveKernelEnvOptions {
  /** `config.python`; the bare sentinel (or absent) selects a managed venv. */
  python?: string
  /** Managed venv directory; defaults to `<packageRoot>/.venv-kernel`. */
  venvDir?: string
  /** Preferred CPython version for the managed venv. */
  pythonVersion?: string
  /** Provision the managed venv when missing/incomplete (default true). */
  autoInstall?: boolean
  /** Logger callback (info on provisioning, warn on degraded snapshot). */
  log?: (level: 'info' | 'warn', message: string) => void
}

interface Probe {
  version: string
  ipykernel: boolean
  dill: boolean
}

/** A probe that never imports user modules and reports exactly what we need. */
const PROBE_CODE = [
  'import json, sys',
  'r = {"version": sys.version.split()[0], "ipykernel": False, "dill": False}',
  'try:',
  '    import ipykernel  # noqa: F401',
  '    r["ipykernel"] = True',
  'except Exception:',
  '    pass',
  'try:',
  '    import dill  # noqa: F401',
  '    r["dill"] = True',
  'except Exception:',
  '    pass',
  'print(json.dumps(r))',
].join('\n')

async function probePython(python: string): Promise<Probe | null> {
  try {
    const { stdout } = await execFileAsync(python, ['-c', PROBE_CODE], { timeout: 15_000 })
    const parsed = JSON.parse(stdout.trim()) as Partial<Probe>
    return {
      version: typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : 'unknown',
      ipykernel: parsed.ipykernel === true,
      dill: parsed.dill === true,
    }
  } catch {
    return null
  }
}

/** The venv interpreter path for this platform. */
function venvPythonPath(venvDir: string): string {
  return process.platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python')
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync(cmd, ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/** Tool-cache env for uv: caches live NEXT TO the venv (plugin territory), so a read-only home can never block provisioning. */
export function uvToolEnv(venvDir: string): NodeJS.ProcessEnv {
  const cacheDir = join(dirname(venvDir), '.uv-cache')
  return {
    ...process.env,
    UV_CACHE_DIR: cacheDir,
    UV_PYTHON_INSTALL_DIR: join(cacheDir, 'python'),
    UV_LINK_MODE: 'copy',
  }
}

/** uv venv arguments (pure; unit-tested). */
export function uvVenvArgs(venvDir: string, pythonVersion: string): string[] {
  return ['venv', venvDir, '--python', pythonVersion]
}

/** python3 -m venv fallback arguments (pure; cache-free by construction). */
export function venvFallbackArgs(venvDir: string): string[] {
  return ['-m', 'venv', venvDir]
}

/** uv pip install arguments with pinned versions (pure; unit-tested). */
export function uvInstallArgs(python: string): string[] {
  return ['pip', 'install', '--python', python, '--quiet', `ipykernel==${IPYKERNEL_VERSION}`, `dill==${DILL_VERSION}`]
}

/** pip install arguments with pinned versions for the venv interpreter (pure). */
export function pipInstallArgs(): string[] {
  return ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', `ipykernel==${IPYKERNEL_VERSION}`, `dill==${DILL_VERSION}`]
}

/** Create the venv (when absent) and return its interpreter path. */
async function createVenv(venvDir: string, pythonVersion: string): Promise<string> {
  const python = venvPythonPath(venvDir)
  if (existsSync(python)) return python
  if (await commandExists('uv')) {
    mkdirSync(join(dirname(venvDir), '.uv-cache'), { recursive: true })
    await execFileAsync('uv', uvVenvArgs(venvDir, pythonVersion), { timeout: 120_000, env: uvToolEnv(venvDir) })
  } else {
    await execFileAsync('python3', venvFallbackArgs(venvDir), { timeout: 120_000 })
  }
  return python
}

/** Install pinned `ipykernel` + `dill` into the venv interpreter. */
async function installDeps(python: string, venvDir: string): Promise<void> {
  if (await commandExists('uv')) {
    await execFileAsync('uv', uvInstallArgs(python), { timeout: 180_000, env: uvToolEnv(venvDir) })
  } else {
    await execFileAsync(python, pipInstallArgs(), { timeout: 180_000 })
  }
}

/** Provision (or repair) the managed venv so it has `ipykernel` + `dill`. */
async function ensureVenv(venvDir: string, pythonVersion: string, log?: ResolveKernelEnvOptions['log']): Promise<string> {
  const python = venvPythonPath(venvDir)
  const existing = existsSync(python) ? await probePython(python) : null
  if (existing?.ipykernel === true && existing.dill === true) {
    return python
  }
  await createVenv(venvDir, pythonVersion)
  if (!existsSync(python)) {
    throw new Error(`dashr-repl: managed kernel venv was not created at ${venvDir} (no interpreter at ${python})`)
  }
  log?.('info', `dashr-repl: provisioning kernel venv at ${venvDir} (ipykernel + dill)`)
  await installDeps(python, venvDir)
  return python
}

/**
 * Resolve the kernel interpreter, provisioning a managed venv when no
 * explicit interpreter is configured. Throws when the resolved interpreter
 * cannot run `ipykernel`; a missing `dill` only disables snapshots (warned).
 */
export async function resolveKernelEnv(options: ResolveKernelEnvOptions = {}): Promise<KernelEnv> {
  const log = options.log
  const explicit = options.python !== undefined && options.python !== '' && options.python !== AUTO_PYTHON_SENTINEL
    ? options.python
    : undefined

  if (explicit !== undefined) {
    const probe = await probePython(explicit)
    if (probe === null) {
      throw new Error(`dashr-repl: kernel python ${JSON.stringify(explicit)} could not be executed — check the path`)
    }
    if (!probe.ipykernel) {
      throw new Error(`dashr-repl: kernel python ${JSON.stringify(explicit)} has no ipykernel — install it (pip install ipykernel) or set python to a managed venv`)
    }
    if (!probe.dill) {
      log?.('warn', `dashr-repl: kernel python ${JSON.stringify(explicit)} has no dill — namespace snapshots are DISABLED (install it: pip install dill)`)
    }
    return { python: explicit, managed: false, venvDir: undefined, dill: probe.dill, ipykernel: true, version: probe.version }
  }

  const venvDir = options.venvDir ?? join(PACKAGE_ROOT, '.venv-kernel')
  const python = venvPythonPath(venvDir)

  if (options.autoInstall === false) {
    const probe = await probePython(python)
    if (probe === null || !probe.ipykernel) {
      throw new Error(`dashr-repl: managed kernel venv is missing or incomplete at ${venvDir} — run 'npm run kernel:venv' in the dashr package, or set kernelAutoInstall: true (or python to a prepared interpreter)`)
    }
    if (!probe.dill) {
      log?.('warn', `dashr-repl: kernel venv at ${venvDir} has no dill — namespace snapshots are DISABLED (run 'npm run kernel:venv' to reinstall)`)
    }
    return { python, managed: true, venvDir, dill: probe.dill, ipykernel: true, version: probe.version }
  }

  const resolved = await ensureVenv(venvDir, options.pythonVersion ?? DEFAULT_KERNEL_PYTHON_VERSION, log)
  const probe = await probePython(resolved)
  if (probe === null || !probe.ipykernel) {
    throw new Error(`dashr-repl: managed kernel venv at ${venvDir} still has no ipykernel after provisioning — check uv/python3-venv availability and retry`)
  }
  if (!probe.dill) {
    log?.('warn', `dashr-repl: managed kernel venv at ${venvDir} has no dill after provisioning — namespace snapshots are DISABLED`)
  }
  return { python: resolved, managed: true, venvDir, dill: probe.dill, ipykernel: true, version: probe.version }
}
