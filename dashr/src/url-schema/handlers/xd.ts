/**
 * `xd://` scheme handler — device I/O dispatch placeholder.
 *
 * Services required (for the integration/wiring step): **none yet**. `xd://`
 * has no device provider mounted in this wave, so the handler returns
 * placeholder text and the write dispatch raises a structured error. When a
 * device layer lands, this module is where device list/document resolution and
 * write routing (per-device dispatch) get wired through `deps`.
 */

import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemaError } from '../selector.ts'

/** Dependencies captured by the xd:// handler. Empty placeholder — no providers. */
export interface XdHandlerDeps {
}

/**
 * Build the `xd://` scheme handler. Bare `xd://` yields the (empty) device
 * roster; a `<device>` yields its document — both placeholders until a device
 * provider is mounted.
 */
export function createXdHandler(_deps: XdHandlerDeps = {}): SchemeHandler {
  return {
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const trimmed = path.replace(/^\/+/, '')
      const slash = trimmed.indexOf('/')
      const device = slash === -1 ? trimmed : trimmed.slice(0, slash)
      if (device === '') {
        return 'no devices mounted'
      }
      return `unknown device: ${device}`
    },
  }
}

/**
 * Placeholder write dispatch for `xd://` URLs. No device provider is mounted
 * in this wave, so every write to `xd://` fails with a structured error —
 * called by the write tool's URL branch.
 */
export function dispatchXdWrite(_path: string, _content: string): never {
  throw new UrlSchemaError(
    'XD_NO_DEVICE',
    'xd:// write dispatch: no devices mounted to route the write to',
  )
}
