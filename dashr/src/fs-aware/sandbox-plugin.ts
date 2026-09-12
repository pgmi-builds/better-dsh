/**
 * `better-dsh/fs-aware-sandbox` — the MOUNTED module for change
 * `2026-09-12-fs-scheme-resolution`: the scheme-aware filesystem backend that
 * replaces the stock `fs-sandbox` row via a same-id home-layer patch row
 * (`name` re-point = whole-plugin replacement, `Entry.update` replace branch
 * with automatic rollback).
 *
 * Unlike the phase-2 spike (`fs-backend.ts`, dynamic-import fail-soft for the
 * unmounted state), this module is loaded ONLY as the row's implementation —
 * `@deepseek-ai/dsh-fs-sandbox` is definitionally present, so the inheritance
 * is a plain static import and the class exports directly (the patch loader
 * instantiates the default export; the `fs` service name is baked into the
 * `FileSystem` base via `super(ctx, 'fs')`).
 *
 * Gate: `config.urlSchemes` (default true). When off, EVERY override
 * short-circuits to `super` — the deployment behaves bit-for-bit like the
 * stock `fs-sandbox` row (config passes through verbatim; fs-local's Config
 * is a plain interface, no static schema — same as the stock row).
 *
 * Session-layer schemes (`ctx://`, `agent://`, `skill://`) are deliberately NOT
 * resolved here: they need live-agent resolver semantics that a filesystem
 * consumer does not carry — ctx:///agent:// read session state, and skill://
 * must consult the host skill registry's layered catalog (the skill-loading
 * business logic of `dsh-skill-filesystem`: which roots load, scan depth,
 * scope merge), which resolves only against a calling agent. They answer with
 * a structured session-layer boundary error naming the sanctioned channel
 * (the native `skill` tool); the tool layer keeps full resolution.
 */

import { Context } from '@deepseek-ai/cordis'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-fs-local'

import { UrlResolver } from '../url-schemes/resolver.ts'
import { UrlSchemesError } from '../url-schemes/selector.ts'
import { buildFsLayerResolver } from './wrap.ts'

/** Module config: the stock LocalConfig fields plus the scheme gate. */
export interface FsAwareConfig extends LocalConfig {
  /** Master gate for scheme interception at the FS layer (default on). */
  urlSchemes?: boolean
}

/** Scheme prefix test — mirrors the resolver's own grammar. */
function isSchemePath(path: string): boolean {
  return /^[a-z][a-z0-9]*:\/\//.test(path)
}

/** Session-layer schemes are excluded from FS-layer resolution (design D2). */
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

/** Structural view of the inherited backend (loose, like the spike's Base). */
interface BaseView {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: string; displayPath: string }>
  stat(target: { targetKey: string }, signal?: AbortSignal): Promise<unknown>
  readText(target: { targetKey: string }, signal?: AbortSignal): Promise<string>
  writeText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
  editText(target: { targetKey: string }, ...rest: unknown[]): Promise<unknown>
}

const Base = SandboxedFileSystem as unknown as abstract new (ctx: Context, config: FsAwareConfig) => BaseView

export default class FsAwareSandboxFileSystem extends Base {
  static inject = ['sandboxPolicy', 'settings', 'agents']

  private readonly resolver: UrlResolver
  private readonly schemeResolution: boolean

  constructor(ctx: Context, config: FsAwareConfig) {
    super(ctx, config)
    this.schemeResolution = config?.urlSchemes !== false
    this.resolver = this.buildResolver(ctx)
  }

  /**
   * FS-layer resolver — the SHARED builder from `wrap.ts` (design D2). One
   * registration source for both FS consumers: this backend and the instance
   * wrap. (A private duplicate here once drifted — a doubled `dsh` register
   * and a literal `'http'` that would silently drop `https` if this backend
   * were ever the outermost layer.) The `ctx`/`agent` handlers it registers
   * are unreachable here: session-layer schemes are guarded before resolve.
   */
  private buildResolver(ctx: Context): UrlResolver {
    const services = ctx as unknown as { settings?: unknown }
    return buildFsLayerResolver({ settings: services.settings }, this)
  }

  /** FS-layer resolver env: no live agent — session-layer schemes are excluded upstream. */
  private envFor(url: string): Record<string, unknown> {
    return { fs: this, rawUrl: url }
  }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }) {
    if (!this.schemeResolution || !isSchemePath(path)) return super.resolve(path, opts)
    if (isSessionLayerScheme(path)) throw sessionLayerError(path)
    await this.resolver.resolve(this.envFor(path), path)
    // Virtual target: the URL itself is the stable key.
    return { targetKey: path, displayPath: path }
  }

  override async stat(target: { targetKey: string }, signal?: AbortSignal) {
    if (!this.schemeResolution || !isSchemePath(target.targetKey)) return super.stat(target, signal)
    if (isSessionLayerScheme(target.targetKey)) throw sessionLayerError(target.targetKey)
    const text = await this.resolver.resolve(this.envFor(target.targetKey), target.targetKey)
    return { type: 'file' as const, size: text.length }
  }

  override async readText(target: { targetKey: string }, signal?: AbortSignal) {
    if (!this.schemeResolution || !isSchemePath(target.targetKey)) return super.readText(target, signal)
    if (isSessionLayerScheme(target.targetKey)) throw sessionLayerError(target.targetKey)
    return this.resolver.resolve(this.envFor(target.targetKey), target.targetKey)
  }

  override async writeText(target: { targetKey: string }, ...rest: unknown[]) {
    if (this.schemeResolution && isSchemePath(target.targetKey)) {
      throw new UrlSchemesError(
        'FS_VIRTUAL_READONLY',
        `cannot write "${target.targetKey}": scheme resources are read-only at the filesystem layer`,
      )
    }
    return super.writeText(target, ...rest)
  }

  override async editText(target: { targetKey: string }, ...rest: unknown[]) {
    if (this.schemeResolution && isSchemePath(target.targetKey)) {
      throw new UrlSchemesError(
        'FS_VIRTUAL_READONLY',
        `cannot edit "${target.targetKey}": scheme resources are read-only at the filesystem layer`,
      )
    }
    return super.editText(target, ...rest)
  }
}
