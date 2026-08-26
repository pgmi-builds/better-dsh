/**
 * `ctx://` scheme handler — a curated read-only snapshot of the calling
 * agent's environment.
 *
 * URL shapes:
 *   - `ctx://`          → the snapshot key names, one per line. The listing is
 *                         static and works without an agent in the env.
 *   - `ctx://session`   → JSON: `{id, status, origin, delegationDepth}` — the
 *                         agent identity and session lineage. Undefined
 *                         optional header fields are omitted.
 *   - `ctx://model`     → JSON: `{provider, model, maxTokens}` — the agent's
 *                         request options. Undefined option fields are omitted.
 *   - `ctx://cwd`       → the session's creation working directory as a bare
 *                         string (not JSON); `''` when the header has none.
 *   - `ctx://<other>`   → structured `CTX_UNKNOWN_KEY` error listing the keys.
 *
 * The handler returns the FULL text of the resource; the resolver applies any
 * explicit selector (`:raw` / `:N-M` / `:path/…` / `?q=`) uniformly, so there
 * is no default line truncation here.
 *
 * The snapshot reads the live agent from the resolver env (`env.agent`,
 * supplied by the tool layer); an env without one raises `CTX_NO_AGENT` on
 * every value read. The scheme is strictly read-only — there is no write
 * channel.
 *
 * Roadmap: later dev phases may add snapshot keys (e.g. `preset`); none are
 * implemented yet.
 */

import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/**
 * Structural mirror of the upstream `Agent` — only the snapshot fields this
 * handler reads (`id`, `status`, `options`, `session.header`). The real agent
 * stays structurally assignable to this looser shape.
 */
export interface CtxAgent {
  /** The single identity shared with the session. */
  readonly id: string
  /** The lifecycle state (`'idle' | 'running'` upstream). */
  readonly status: string
  /** The provider route and model this agent's requests use. */
  readonly options: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }
  /** The live session; only its durable header is read. */
  readonly session: {
    readonly header: {
      readonly cwd?: string
      readonly origin?: string
      readonly delegationDepth?: number
    }
  }
}

/** The `env` subset this handler reads: the live agent, when there is one. */
export interface CtxEnv extends ResolverEnv {
  readonly agent?: CtxAgent
}

/** The snapshot keys, in listing order. */
const KEYS = ['session', 'model', 'cwd'] as const

/** Build the `ctx://` scheme handler over the resolver env. */
export function createCtxHandler(): SchemeHandler {
  return {
    async resolve(env: ResolverEnv, path: string): Promise<string> {
      const key = path.replace(/^\/+/, '').trim()
      if (key === '') return KEYS.join('\n')
      const { agent } = env as CtxEnv
      if (agent === undefined) {
        throw new UrlSchemaError(
          'CTX_NO_AGENT',
          'ctx:// requires a live agent in the resolver env (this context has none)',
        )
      }
      switch (key) {
        case 'session':
          // JSON.stringify drops the undefined optional fields for free.
          return JSON.stringify(
            {
              id: agent.id,
              status: agent.status,
              origin: agent.session.header.origin,
              delegationDepth: agent.session.header.delegationDepth,
            },
            null,
            2,
          )
        case 'model':
          return JSON.stringify(
            {
              provider: agent.options.provider,
              model: agent.options.model,
              maxTokens: agent.options.maxTokens,
            },
            null,
            2,
          )
        case 'cwd':
          return agent.session.header.cwd ?? ''
        default:
          throw new UrlSchemaError(
            'CTX_UNKNOWN_KEY',
            `ctx://${key}: unknown snapshot key (known: ${KEYS.join(', ')})`,
          )
      }
    },
  }
}
