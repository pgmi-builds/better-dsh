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
 * {@link UrlSchemaError}.
 *
 * The registry is module-level on purpose: one roster per process shared by
 * every resolver instance, mirroring the host-plane single-mount model.
 */

import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemaError } from '../selector.ts'

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
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const name = deviceNameFromPath(path)
      if (name === '') {
        if (devices.size === 0) return 'no devices mounted'
        return [...devices].map(([n, device]) => `${n}\t${device.summary}`).join('\n')
      }
      const device = devices.get(name)
      if (device === undefined) return `unknown device: ${name}`
      return `${device.summary}\nusage: write dvc://${name} with a JSON args object to execute this device`
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
export function dispatchDvcWrite(path: string, content: string): Promise<unknown> {
  if (devices.size === 0) {
    throw new UrlSchemaError(
      'DVC_NO_DEVICE',
      'dvc:// write dispatch: no devices mounted to route the write to',
    )
  }
  const name = deviceNameFromPath(path)
  const device = devices.get(name)
  if (device === undefined) {
    const registered = [...devices.keys()].sort().join(', ')
    throw new UrlSchemaError(
      'DVC_UNKNOWN_DEVICE',
      `dvc:// write dispatch: no device named "${name}" (registered: ${registered})`,
    )
  }
  let args: unknown
  try {
    args = JSON.parse(content)
  } catch (error) {
    throw new UrlSchemaError(
      'DVC_BAD_ARGS',
      `dvc:// write dispatch: device "${name}" requires a JSON args payload (${messageOf(error)})`,
    )
  }
  // `Promise.resolve().then` also converts a synchronously throwing
  // `execute` into the same structured rejection.
  return Promise.resolve()
    .then(() => device.execute(args))
    .catch((error: unknown) => {
      throw new UrlSchemaError(
        'DVC_DEVICE_ERROR',
        `dvc:// device "${name}" execute failed: ${messageOf(error)}`,
      )
    })
}
