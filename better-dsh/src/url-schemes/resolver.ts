/**
 * `UrlResolver`: the scheme→handler registry + dispatch for `dsh-url-schemes`.
 *
 * One registry owns the six scheme handlers (`skill://`, `agent://`,
 * `dsh://`, `ctx://`, `dvc://`, `http(s)://`) and resolves a URL end-to-end:
 * `parseUrl` → dispatch to the registered handler → `applySelector`.
 * Handlers return the FULL text of the resource; the selector is applied
 * uniformly by this layer, so every scheme shares one selector syntax.
 */

import { applySelector, parseUrl, UrlSchemesError } from './selector.ts'

/**
 * Minimal environment handed to every scheme handler. Intentionally empty in
 * the foundation wave — each handler adds the provider fields it needs as it
 * lands: `ctx.skills` (skill://), subagent/session state (agent://), resolved
 * settings (dsh://), the kernel query/set channel (ctx://), and so on.
 */
export interface ResolverEnv {
}

/**
 * One scheme handler: resolves the URL `path` to its full text, and — when
 * the scheme is path-backed — optionally maps it to a real on-disk location.
 */
/** Selector shape handed to selector-aware handlers (mirror of selector.ts). */
export type HandlerSelector =
  | { kind: 'raw' }
  | { kind: 'lines'; ranges: Array<[number, number]> }
  | { kind: 'path'; value: string }
  | { kind: 'query'; q: string }
  | null

export interface SchemeHandler {
  /**
   * Selector-aware handlers receive the parsed selector and serve both
   * content faces themselves (e.g. `ctx://` canonical vs prepared); the
   * resolver then does NOT apply the uniform selector. Default handlers are
   * selector-oblivious: they return the full text and the resolver applies
   * the uniform selector (line windows / raw passthrough).
   */
  readonly selectorAware?: boolean
  resolve(env: ResolverEnv, path: string, selector?: HandlerSelector): Promise<string>
  /**
   * Optional path-backed view: the real on-disk path of the addressed
   * resource, so the URL-aware `grep`/`glob` can translate a URL into a disk
   * path and hand it to the native tool. Only path-backed handlers implement
   * this (skill resources, `dsh://docs`); content-backed handlers (agent,
   * ctx, config, http, …) omit it, and callers fall back to materializing the
   * resolved text. `undefined` means "this path is not path-backed".
   */
  resolvePath?(env: ResolverEnv, path: string): Promise<string | undefined>
}

/** Scheme→handler registry that resolves `scheme://` URLs end-to-end. */
export class UrlResolver {
  private readonly handlers = new Map<string, SchemeHandler>()

  /** Register (or replace) the handler for `scheme`. */
  register(scheme: string, handler: SchemeHandler): void {
    this.handlers.set(scheme, handler)
  }

  /**
   * Resolve a `scheme://` URL to its selected text: parse the URL, dispatch
   * to the registered handler for the scheme, then apply the selector.
   *
   * Throws a structured {@link UrlSchemesError} for a scheme-less URL
   * (`URL_NO_SCHEME`, from {@link parseUrl}) or an unregistered scheme
   * (`URL_UNREGISTERED_SCHEME`).
   */
  async resolve(env: ResolverEnv, url: string): Promise<string> {
    const parsed = parseUrl(url)
    const handler = this.handlers.get(parsed.scheme)
    if (handler === undefined) {
      const registered = [...this.handlers.keys()].sort().join(', ')
      throw new UrlSchemesError(
        'URL_UNREGISTERED_SCHEME',
        `no handler registered for scheme "${parsed.scheme}" (registered: ${registered || 'none'})`,
      )
    }
    if (handler.selectorAware === true) {
      // Selector-aware: the handler serves both faces and applies line
      // windows itself — the uniform selector pass is skipped.
      return handler.resolve(env, parsed.path, parsed.selector)
    }
    const text = await handler.resolve(env, parsed.path)
    return applySelector(text, parsed.selector)
  }

  /**
   * Resolve a `scheme://` URL to its on-disk path when its handler is
   * path-backed: parse the URL, dispatch to the handler's optional
   * `resolvePath`, and return the real disk location. Returns `undefined`
   * for an unregistered scheme, a handler without `resolvePath`, or a path
   * the handler cannot map — callers then fall back to text resolution
   * (whose unregistered-scheme error is the structured generic one).
   * Selectors are NOT applied: they operate on resolved text, not paths.
   */
  async resolvePath(env: ResolverEnv, url: string): Promise<string | undefined> {
    const parsed = parseUrl(url)
    const handler = this.handlers.get(parsed.scheme)
    if (handler?.resolvePath === undefined) return undefined
    return await handler.resolvePath(env, parsed.path)
  }
}
