/**
 * `ctx://` scheme handler — the kernel user-namespace read/write channel.
 *
 * URL shapes:
 *   - `ctx://`          → list the namespace's variable names, one per line.
 *   - `ctx://<var>`     → the variable's value as text: a JSON-serializable
 *                         value renders as its JSON text; any other value as
 *                         its `repr` text; a missing name raises a structured
 *                         error.
 *
 * The handler returns the FULL text of the resource; the resolver applies any
 * explicit selector (`:raw` / `:N-M` / `:path/…` / `?q=`) uniformly, so there
 * is no default line truncation here.
 *
 * Dependencies (captured once by `createCtxHandler(deps)`):
 *   - `deps.replRuntime` — the `ctx.replRuntime` seam (structural
 *     {@link ReplRuntimeSurface}), the kernel query/set channel
 *     (`queryVar`/`setVar`). The wiring step supplies it from
 *     `ctx.get('replRuntime')` (or inside a `ctx.inject(['replRuntime'])`
 *     callback), exactly as the `eval` transport reads it at use time.
 *
 * `writeCtxVar(deps, name, value)` is the write tool's URL-branch entry
 * point: it assigns one lossless-JSON `value` into the namespace under
 * `name` via `setVar`.
 */

import type { ReplRuntimeSurface, ReplVarQuery } from '../../runtime-surface.ts'
import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/** Dependencies captured by the `ctx://` handler. */
export interface CtxHandlerDeps {
  /** The `ctx.replRuntime` seam — the kernel query/set channel. */
  readonly replRuntime: ReplRuntimeSurface
}

/**
 * Call the runtime's optional `queryVar` channel as a method on the runtime
 * (so `this` stays the runtime), or raise an actionable structured error when
 * a third-party `ctx.replRuntime` provider does not expose namespace reads.
 */
function query(runtime: ReplRuntimeSurface, name: string): Promise<ReplVarQuery> {
  if (!runtime.queryVar) {
    throw new UrlSchemaError(
      'CTX_NO_QUERY_CHANNEL',
      'ctx:// requires a ctx.replRuntime with the queryVar channel (this runtime does not expose namespace reads)',
    )
  }
  return runtime.queryVar(name)
}

/** Render the namespace listing: one variable name per line. */
async function listNames(runtime: ReplRuntimeSurface): Promise<string> {
  const result = await query(runtime, '')
  if (result.kind === 'names') return result.names.join('\n')
  // A provider that resolves an empty name as missing/json/repr (instead of
  // the contract's `names`) is treated as an empty namespace.
  return ''
}

/** Read one variable as text, or raise a structured error when absent. */
async function readVar(runtime: ReplRuntimeSurface, name: string): Promise<string> {
  const result = await query(runtime, name)
  switch (result.kind) {
    case 'json':
    case 'repr':
      return result.text
    case 'missing':
      throw new UrlSchemaError(
        'CTX_VAR_MISSING',
        `ctx://${name}: no such variable in the kernel namespace`,
      )
    case 'names':
      // Degenerate for a non-empty name; treat as absent.
      throw new UrlSchemaError(
        'CTX_VAR_MISSING',
        `ctx://${name}: no such variable in the kernel namespace`,
      )
  }
}

/** Build the `ctx://` scheme handler over the runtime seam. */
export function createCtxHandler(deps: CtxHandlerDeps): SchemeHandler {
  const { replRuntime } = deps
  return {
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const name = path.replace(/^\/+/, '').trim()
      if (name === '') return listNames(replRuntime)
      return readVar(replRuntime, name)
    },
  }
}

/**
 * Write one lossless-JSON `value` into the kernel namespace under `name` via
 * `setVar`. Called by the write tool's URL branch for `ctx://<var>` targets;
 * `name` is the URL path (the variable identifier) and `value` is the
 * lossless-JSON value to bind.
 */
export async function writeCtxVar(deps: CtxHandlerDeps, name: string, value: unknown): Promise<void> {
  const { replRuntime } = deps
  if (!replRuntime.setVar) {
    throw new UrlSchemaError(
      'CTX_NO_SET_CHANNEL',
      'ctx:// write requires a ctx.replRuntime with the setVar channel (this runtime does not expose namespace writes)',
    )
  }
  const target = name.replace(/^\/+/, '').trim()
  if (target === '') {
    throw new UrlSchemaError('CTX_EMPTY_NAME', 'ctx:// write requires a variable name (ctx://<var>)')
  }
  await replRuntime.setVar(target, value)
}
