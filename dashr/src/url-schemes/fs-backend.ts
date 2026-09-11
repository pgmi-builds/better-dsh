/**
 * PHASE-2 SPIKE (change 2026-09-11-url-schemes-recallable-context, task 5.x,
 * independently acceptable/droppable): the scheme-aware FileSystem backend.
 *
 * Shape mirrors the official composition convention of the fs domain —
 * `SandboxedFileSystem extends LocalFileSystem` overrides the methods it
 * fences and inherits the rest — applied to OUR concern: `scheme://` paths
 * resolve to VIRTUAL read-only targets backed by the UrlResolver, everything
 * else delegates to the inherited sandboxed backend untouched.
 *
 *   resolve('ctx://session')      → virtual FsTarget (targetKey = the URL)
 *   stat(virtual)                 → synthesized `{ type: 'file' }` FsInfo
 *   readText(virtual)             → resolver-resolved text
 *   writeText/editText(virtual)   → typed read-only error (immutable)
 *   everything else / real paths  → super (sandbox fence intact)
 *
 * The base class is imported DYNAMICALLY: hosts without
 * `@deepseek-ai/dsh-fs-sandbox` mounted get `undefined` from the factory and
 * the spike cleanly does not apply (no hard dependency added by the spike).
 *
 * NOT mounted by default: mounting swaps the `fs-sandbox` row (home-layer
 * cordis.patch.yml same-id override) and is verified on 4999 before enabling.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ReadGates } from './transforms.ts'

/** Scheme-path fork — mirrors transforms.ts (kept textual: spike isolation). */
function isSchemePath(path: string): boolean {
  return /^[a-z][a-z0-9]*:\/\//.test(path)
}

/** Escape hatch so a virtual target can never be mistaken for a real file. */
export function isVirtualTarget(targetKey: string): boolean {
  return isSchemePath(targetKey)
}

export interface UrlAwareBackend {
  /** The registered 'fs' service instance to mount instead of the plain one. */
  readonly instance: unknown
  /** The resolved backend class name, for boot diagnostics. */
  readonly backendName: string
}

/**
 * Build the scheme-aware backend. Returns `undefined` when the sandbox base
 * package cannot be imported (spike N/A on this deployment) — callers skip
 * mounting and the stock `fs-sandbox` row keeps standing.
 */
export async function createUrlAwareFileSystemBackend(deps: {
  ctx: Context
  /** LocalConfig for the inherited sandbox backend (same shape the `fs-sandbox` row passes). */
  config: unknown
  /** URL resolution: returns the canonical text for scheme paths. */
  resolveUrl: (url: string) => Promise<string>
  gates: ReadGates
}): Promise<UrlAwareBackend | undefined> {
  if (!deps.gates.urlSchemes) return undefined
  const built = await build(deps)
  return built ?? undefined
}

async function build(deps: Parameters<typeof createUrlAwareFileSystemBackend>[0]): Promise<UrlAwareBackend | null> {

  let SandboxBase: abstract new (ctx: Context, config: unknown) => object
  try {
    const mod = (await import('@deepseek-ai/dsh-fs-sandbox')) as unknown as {
      SandboxedFileSystem: abstract new (ctx: Context, config: unknown) => object
    }
    SandboxBase = mod.SandboxedFileSystem
  } catch {
    return null
  }

  const Base = SandboxBase as unknown as new (ctx: Context, config: unknown) => {
    resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: string; displayPath: string }>
    stat(target: { targetKey: string }, signal?: AbortSignal): Promise<unknown>
    readText(target: { targetKey: string }, signal?: AbortSignal): Promise<string>
    streamText?(target: { targetKey: string }, signal?: AbortSignal): Promise<unknown>
    writeText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
    editText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
    processPath(target: { targetKey: string }): string
  }

  class UrlAwareFileSystem extends Base {
    override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }) {
      if (isSchemePath(path)) {
        const text = await deps.resolveUrl(path)
        // Virtual target: the URL itself is the stable key.
        return { targetKey: path, displayPath: path, __text: text }
      }
      return super.resolve(path, opts)
    }

    override async stat(target: { targetKey: string }, signal?: AbortSignal) {
      if (isVirtualTarget(target.targetKey)) {
        const text = await deps.resolveUrl(target.targetKey)
        return { type: 'file', size: text.length }
      }
      return super.stat(target, signal)
    }

    override async readText(target: { targetKey: string }, signal?: AbortSignal) {
      if (isVirtualTarget(target.targetKey)) return deps.resolveUrl(target.targetKey)
      return super.readText(target, signal)
    }

    override async writeText(target: { targetKey: string }, ...rest: unknown[]) {
      if (isVirtualTarget(target.targetKey)) {
        throw new Error(`cannot write "${target.targetKey}": scheme resources are read-only (FS_VIRTUAL_READONLY)`)
      }
      return (super.writeText as unknown as (...a: unknown[]) => Promise<unknown>)(target, ...rest)
    }

    override async editText(target: { targetKey: string }, ...rest: unknown[]) {
      if (isVirtualTarget(target.targetKey)) {
        throw new Error(`cannot edit "${target.targetKey}": scheme resources are read-only (FS_VIRTUAL_READONLY)`)
      }
      return (super.editText as unknown as (...a: unknown[]) => Promise<unknown>)(target, ...rest)
    }
  }

  const instance = new UrlAwareFileSystem(deps.ctx, deps.config)
  return { instance: instance as unknown, backendName: 'UrlAwareFileSystem(sandboxed)' }
}
