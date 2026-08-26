/**
 * `dvc://` scheme handler — device I/O dispatch placeholder.
 *
 * Services required (for the integration/wiring step): **none yet**. `dvc://`
 * has no device provider mounted in this wave, so the handler returns
 * placeholder text and the write dispatch raises a structured error. When a
 * device layer lands, this module is where device list/document resolution and
 * write routing (per-device dispatch) get wired through `deps`.
 */

import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemaError } from '../selector.ts'

/** Dependencies captured by the dvc:// handler. Empty placeholder — no providers. */
export interface DvcHandlerDeps {
}

/**
 * Build the `dvc://` scheme handler. Bare `dvc://` yields the (empty) device
 * roster; a `<device>` yields its document — both placeholders until a device
 * provider is mounted.
 */
export function createDvcHandler(_deps: DvcHandlerDeps = {}): SchemeHandler {
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
 * Placeholder write dispatch for `dvc://` URLs. No device provider is mounted
 * in this wave, so every write to `dvc://` fails with a structured error —
 * called by the write tool's URL branch.
 */
export function dispatchDvcWrite(_path: string, _content: string): never {
  throw new UrlSchemaError(
    'DVC_NO_DEVICE',
    'dvc:// write dispatch: no devices mounted to route the write to',
  )
}
