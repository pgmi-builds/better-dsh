/**
 * `UrlResolver`: the scheme→handler registry + dispatch for `dsh-url-schema`.
 *
 * One registry owns the five scheme handlers (`skill://`, `agent://`,
 * `dsh://`, `ctx://`, `xd://`) and resolves a URL end-to-end:
 * `parseUrl` → dispatch to the registered handler → `applySelector`.
 * Handlers return the FULL text of the resource; the selector is applied
 * uniformly by this layer, so every scheme shares one selector syntax.
 */

import { applySelector, parseUrl, UrlSchemaError } from './selector.ts'

import { historyAliasHint } from './handlers/agent.ts'

/**
 * Minimal environment handed to every scheme handler. Intentionally empty in
 * the foundation wave — each handler adds the provider fields it needs as it
 * lands: `ctx.skills` (skill://), subagent/session state (agent://), resolved
 * settings (dsh://), the kernel query/set channel (ctx://), and so on.
 */
export interface ResolverEnv {
}

/** One scheme handler: resolves the URL `path` to its full text. */
export interface SchemeHandler {
  resolve(env: ResolverEnv, path: string): Promise<string>
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
   * `history://` (deprecated, absorbed into `agent://` per design.md D3) is
   * special-cased: instead of `URL_UNREGISTERED_SCHEME` it returns a friendly
   * pointer to the equivalent `agent://<id>/transcript` URL.
   *
   * Throws a structured {@link UrlSchemaError} for a scheme-less URL
   * (`URL_NO_SCHEME`, from {@link parseUrl}) or an unregistered scheme
   * (`URL_UNREGISTERED_SCHEME`).
   */
  async resolve(env: ResolverEnv, url: string): Promise<string> {
    const parsed = parseUrl(url)
    const handler = this.handlers.get(parsed.scheme)
    if (handler === undefined) {
      if (parsed.scheme === 'history') {
        return applySelector(historyAliasHint(parsed.path), parsed.selector)
      }
      const registered = [...this.handlers.keys()].sort().join(', ')
      throw new UrlSchemaError(
        'URL_UNREGISTERED_SCHEME',
        `no handler registered for scheme "${parsed.scheme}" (registered: ${registered || 'none'})`,
      )
    }
    const text = await handler.resolve(env, parsed.path)
    return applySelector(text, parsed.selector)
  }
}
