/**
 * FS-gate scheme resolution via INSTANCE-LEVEL method wrapping of the live
 * `ctx.fs` service (change 2026-09-12-fs-scheme-resolution, design D1b).
 *
 * WHY THIS SHAPE: the documented "same-id row re-point" mount was proven
 * non-viable on 0.1.5-rc.2 — restating the `fs-sandbox` row with a non-
 * registry `name` silently rolls back (the boot-time `loader.internal.import`
 * resolves against the compiled bun-registry only; `better-dsh/*` is not in
 * it and name changes on an existing entry import from the harness tree,
 * where this package is absent). The override-mechanics doc ranks
 * monkey-patching as the last resort; this wrapper confines itself to the
 * five PUBLIC fs-service methods, gates every added behavior behind
 * `urlSchemes`, and is re-applied per boot (nothing persists).
 *
 * Behavior (identical to the inheritance spike's matrix):
 * - resolve/stat/readText on scheme paths → resolver-dereferenced virtual
 *   content (file-type schemes only; ctx:///agent:///skill:// answer the
 *   structured `CTX_SESSION_LAYER` boundary error — they need live-agent
 *   semantics: ctx:///agent:// read session state, and skill:// must consult
 *   the host skill registry's LAYERED catalog (project/user/preset roots,
 *   scan depth, rank merge — business logic owned by `dsh-skill-filesystem`),
 *   which resolves only against a calling agent's scope. The web profile
 *   disables the host-level `skill-filesystem` row entirely (dsh-web-app
 *   bundle patch), so a global-layer lookup answers a misleading "unknown"
 *   for every skill — the boundary error names the native `skill` tool as
 *   the invocation path instead);
 * - writeText/editText on scheme paths → `FS_VIRTUAL_READONLY`;
 */

import { UrlResolver } from '../url-schemes/resolver.ts'
import { UrlSchemesError } from '../url-schemes/selector.ts'
import { createDshHandler } from '../url-schemes/handlers/dsh.ts'
import { createDvcHandler } from '../url-schemes/handlers/dvc.ts'
import { createHttpHandler, HTTP_SCHEMES } from '../url-schemes/handlers/http.ts'
import { resolveDocsDir } from '../url-schemes/docs-dir.ts'

const WRAPPED = Symbol('dsh-url-schemes.fs-wrap')

function isSchemePath(path: string): boolean {
  return typeof path === 'string' && /^[a-z][a-z0-9]*:\/\//.test(path)
}

function isSessionLayerScheme(path: string): boolean {
  return path.startsWith('ctx://') || path.startsWith('agent://') || path.startsWith('skill://')
}

function sessionLayerError(url: string): UrlSchemesError {
  if (url.startsWith('skill://')) {
    return new UrlSchemesError(
      'CTX_SESSION_LAYER',
      `${url}: session-layer scheme — skill discovery (which roots load, scan depth, layered scope merge) is the host skill provider's business logic and resolves only against a calling agent, which the filesystem layer does not have. Load skills with the native \`skill\` tool; grep/glob with path=skill://… keep working through the tool layer`,
    )
  }
  return new UrlSchemesError(
    'CTX_SESSION_LAYER',
    `${url}: session-layer scheme — read it through the read tool (the session-layer resolver environment carries the live agent this filesystem layer does not have)`,
  )
}

/** Build the FS-layer resolver: file-type schemes only (design D2). */
export function buildFsLayerResolver(
  services: { settings?: unknown },
  fsSelf: unknown,
): UrlResolver {
  const resolver = new UrlResolver()
  resolver.register('dsh', createDshHandler({
    settings: services.settings as never,
    docsDir: resolveDocsDir(),
  }))
  resolver.register('dvc', createDvcHandler())
  for (const scheme of HTTP_SCHEMES) resolver.register(scheme, createHttpHandler())
  resolver.register('ctx', {
    async resolve(_env: unknown, path: string): Promise<string> {
      throw sessionLayerError(`ctx://${path}`)
    },
  })
  resolver.register('agent', {
    async resolve(_env: unknown, path: string): Promise<string> {
      throw sessionLayerError(`agent://${path}`)
    },
  })
  return resolver
}

export interface FsWrapTarget {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: string; displayPath: string }>
  stat(target: { targetKey: string }, signal?: AbortSignal): Promise<unknown>
  readText(target: { targetKey: string }, signal?: AbortSignal): Promise<string>
  writeText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
  editText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
}

/**
 * Wrap the mounted `ctx.fs` instance in place. Idempotent via a symbol flag.
 * Returns the resolver used for scheme dereferencing (for diagnostics).
 */
export function wrapFsWithSchemes(
  fs: FsWrapTarget,
  services: { settings?: unknown },
): UrlResolver {
  const holder = fs as unknown as Record<symbol, unknown>
  if (holder[WRAPPED] !== undefined) return holder[WRAPPED] as UrlResolver

  const resolver = buildFsLayerResolver(services, fs)
  const envFor = (url: string): Record<string, unknown> => ({ fs, rawUrl: url })

  // Defensive binds: test harnesses (and exotic deployments) may mount an fs
  // service stub without every method — the wrap must never be the thing that
  // kills plugin load. A missing base method only matters when a REAL path
  // reaches the corresponding override (it fails with a clear error then).
  const bind = <F>(fn: F | undefined): (F extends (...a: infer A) => infer R ? (...a: A) => R : undefined) | undefined =>
    typeof fn === 'function' ? (fn.bind(fs) as never) : undefined
  const origResolve = bind(fs.resolve)
  const origStat = bind(fs.stat)
  const origReadText = bind(fs.readText)
  const origWriteText = bind(fs.writeText)
  const origEditText = bind(fs.editText)
  const requireOrig = <F>(orig: F | undefined, method: string): F => {
    if (orig === undefined) throw new UrlSchemesError('FS_BASE_UNSUPPORTED', `the mounted filesystem service exposes no "${method}" — scheme wrap is active but the base backend cannot serve real paths`)
    return orig
  }

  fs.resolve = async (path: string, opts?: { cwd?: string; signal?: AbortSignal }) => {
    if (!isSchemePath(path)) return requireOrig(origResolve, 'resolve')(path, opts)
    if (isSessionLayerScheme(path)) throw sessionLayerError(path)
    await resolver.resolve(envFor(path), path)
    return { targetKey: path, displayPath: path }
  }
  fs.stat = async (target: { targetKey: string }, signal?: AbortSignal) => {
    if (!isSchemePath(target.targetKey)) return requireOrig(origStat, 'stat')(target, signal)
    if (isSessionLayerScheme(target.targetKey)) throw sessionLayerError(target.targetKey)
    const text = await resolver.resolve(envFor(target.targetKey), target.targetKey)
    return { type: 'file' as const, size: text.length }
  }
  fs.readText = async (target: { targetKey: string }, signal?: AbortSignal) => {
    if (!isSchemePath(target.targetKey)) return requireOrig(origReadText, 'readText')(target, signal)
    if (isSessionLayerScheme(target.targetKey)) throw sessionLayerError(target.targetKey)
    return resolver.resolve(envFor(target.targetKey), target.targetKey)
  }
  fs.writeText = async (target: { targetKey: string }, ...rest: unknown[]) => {
    if (isSchemePath(target.targetKey)) {
      throw new UrlSchemesError(
        'FS_VIRTUAL_READONLY',
        `cannot write "${target.targetKey}": scheme resources are read-only at the filesystem layer`,
      )
    }
    return requireOrig(origWriteText, 'writeText')(target, ...rest)
  }
  fs.editText = async (target: { targetKey: string }, ...rest: unknown[]) => {
    if (isSchemePath(target.targetKey)) {
      throw new UrlSchemesError(
        'FS_VIRTUAL_READONLY',
        `cannot edit "${target.targetKey}": scheme resources are read-only at the filesystem layer`,
      )
    }
    return requireOrig(origEditText, 'editText')(target, ...rest)
  }

  holder[WRAPPED] = resolver
  return resolver
}
