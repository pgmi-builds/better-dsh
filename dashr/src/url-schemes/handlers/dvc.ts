/**
 * `dvc://` scheme handler — device registry and write dispatch (design D8).
 *
 * A device is the URL schema's extensibility seam: a named
 * `{ execute, summary }` pair, registered on this module's registry (static
 * devices at plugin apply, lazy device vendors on first use). Reads address
 * the registry — bare `dvc://` is the roster (one `name<TAB>summary` line per
 * device; the `no devices mounted` placeholder while the registry is empty)
 * and `dvc://<device>` is the device's summary plus a one-line usage hint.
 * Writes dispatch through {@link dispatchDvcWrite}: parse the JSON args,
 * run `device.execute(args)`, return its result — every failure mode (no
 * devices, unknown name, bad args, device error) is a structured
 * {@link UrlSchemesError}.
 *
 * The registry is module-level on purpose: one roster per process shared by
 * every resolver instance, mirroring the host-plane single-mount model.
 */

import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemesError, applySelector } from '../selector.ts'
import type { HandlerSelector } from '../resolver.ts'

/**
 * One `dvc://` device. `execute` runs a JSON-args payload and resolves to the
 * device's result; the optional `ctx` slot lets later wiring thread a
 * resolver env through without breaking devices that ignore it. `summary` is
 * the one-line text the roster and device doc render.
 */
export interface DvcDevice {
  execute(args: unknown, ctx?: unknown): Promise<unknown>
  /** One-line roster/doc summary shown on `dvc://` and `dvc://<device>` reads. */
  summary: string
  /**
   * Optional read subpath: `dvc://<device>/<subpath>` serves device state or
   * runs READ-ONLY actions (status, queries) through the GET surface. Absent
   * → the device only serves its doc on reads. Anything that mutates device
   * or workspace state belongs on the write surface (`execute`), never here.
   */
  read?(subpath: string, session?: string): Promise<string>
}

/** Dependencies captured by the dvc:// handler. None — the registry is module-level. */
export interface DvcHandlerDeps {
}

/** Module-level device registry: insertion-ordered, shared by every handler instance. */
const devices = new Map<string, DvcDevice>()

/** Register (or replace) the device mounted under `name`. */
export function registerDvcDevice(name: string, device: DvcDevice): void {
  devices.set(name, device)
}

/** Read-only view of the registered devices, in registration order. */
export function listDvcDevices(): ReadonlyMap<string, DvcDevice> {
  return devices
}

/**
 * The first path segment is the device name (`dvc://name`, `dvc://name/sub`).
 * A leading `dvc://` is tolerated so callers may pass either the parsed path
 * (the write tool's contract) or the full URL.
 */
/** Subpath after the device name (`status`, `diagnostics?file=…`), or undefined. */
function subpathOf(path: string): string | undefined {
  const stripped = path.startsWith('dvc://') ? path.slice('dvc://'.length) : path
  const trimmed = stripped.replace(/^\/+/, '')
  const slash = trimmed.indexOf('/')
  if (slash === -1) return undefined
  const sub = trimmed.slice(slash + 1)
  return sub === '' ? undefined : sub
}

function deviceNameFromPath(path: string): string {
  const stripped = path.startsWith('dvc://') ? path.slice('dvc://'.length) : path
  const trimmed = stripped.replace(/^\/+/, '')
  const slash = trimmed.indexOf('/')
  return slash === -1 ? trimmed : trimmed.slice(0, slash)
}

/** Uniform `unknown`-error rendering for structured error messages. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the `dvc://` scheme handler over the module-level device registry.
 * Bare `dvc://` yields the roster (`no devices mounted` while empty); a
 * registered `<device>` yields its summary plus a usage hint; an unregistered
 * name keeps the `unknown device` placeholder text.
 */
export function createDvcHandler(_deps: DvcHandlerDeps = {}): SchemeHandler {
  return {
    // Selector-aware (2026-09-14): subpath reads need the query selector as
    // device arguments (dvc://lsp/diagnostics?file=…), which the uniform pass
    // would strip; doc/roster reads still apply selectors themselves — line
    // windows (dvc://browser:1-3) and ?q= line filtering (dvc://ast_grep?q=…)
    // behave exactly as before, just served by this handler.
    selectorAware: true,
    async resolve(_env: ResolverEnv & { agent?: { id?: string } }, path: string, selector?: HandlerSelector): Promise<string> {
      const name = deviceNameFromPath(path)
      if (name === '') {
        if (devices.size === 0) return 'no devices mounted'
        return applySelector([...devices].map(([n, device]) => `${n}\t${device.summary}`).join('\n'), selector ?? null)
      }
      const device = devices.get(name)
      if (device === undefined) return `unknown device: ${name}`
      const subpath = subpathOf(path)
      if (subpath !== undefined && device.read !== undefined) {
        // Reconstruct the query selector as device arguments.
        const query = selector?.kind === 'query' ? `?${selector.q}` : ''
        let text: string
        try {
          text = await device.read(`${subpath}${query}`, _env.agent?.id)
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`
        }
        return selector !== undefined && selector !== null && selector.kind !== 'query' ? applySelector(text, selector) : text
      }
      if (subpath !== undefined) return `unknown read path dvc://${name}/${subpath} (device serves doc only)`
      return applySelector(`${device.summary}\nusage: write dvc://${name} with a JSON args object to execute this device`, selector ?? null)
    },
  }
}

/**
 * Write dispatch for `dvc://` URLs — called by the write tool's URL branch.
 * `path` addresses the device (parsed path or full `dvc://` URL); `content`
 * must be the JSON args payload.
 *
 * Routing and args failures (`DVC_NO_DEVICE`, `DVC_UNKNOWN_DEVICE`,
 * `DVC_BAD_ARGS`) throw synchronously — the placeholder wave's observable
 * contract — while a device-reported failure rejects the returned promise as
 * `DVC_DEVICE_ERROR` carrying the device name.
 */
export function dispatchDvcWrite(path: string, content: string, session?: string): Promise<unknown> {
  if (devices.size === 0) {
    throw new UrlSchemesError(
      'DVC_NO_DEVICE',
      'dvc:// write dispatch: no devices mounted to route the write to',
    )
  }
  const name = deviceNameFromPath(path)
  const device = devices.get(name)
  if (device === undefined) {
    const registered = [...devices.keys()].sort().join(', ')
    throw new UrlSchemesError(
      'DVC_UNKNOWN_DEVICE',
      `dvc:// write dispatch: no device named "${name}" (registered: ${registered})`,
    )
  }
  let args: unknown
  try {
    args = JSON.parse(content)
  } catch (error) {
    throw new UrlSchemesError(
      'DVC_BAD_ARGS',
      `dvc:// write dispatch: device "${name}" requires a JSON args payload (${messageOf(error)})`,
    )
  }
  // Session injection (lsp gate contract): the calling agent's id rides the
  // args so session-scoped devices (lsp on/off/status) can address their
  // state. Devices that don't care ignore the extra key.
  if (session !== undefined && args !== null && typeof args === 'object' && !Array.isArray(args)) {
    args = { ...(args as Record<string, unknown>), session }
  }
  // `Promise.resolve().then` also converts a synchronously throwing
  // `execute` into the same structured rejection.
  return Promise.resolve()
    .then(() => device.execute(args))
    .catch((error: unknown) => {
      throw new UrlSchemesError(
        'DVC_DEVICE_ERROR',
        `dvc:// device "${name}" execute failed: ${messageOf(error)}`,
      )
    })
}
