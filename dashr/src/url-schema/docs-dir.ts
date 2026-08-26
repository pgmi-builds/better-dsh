/**
 * `resolveDocsDir`: locate the harness `docs/` tree that backs `dsh://docs`.
 *
 * A fixed-depth `dirname×N(import.meta.url)` anchor breaks the moment the
 * module moves (tsdown bundling inlines this file into `lib/index.js`, so the
 * depth differs between source and build). A nearest-first walk-up from this
 * module's own location survives every layout:
 *
 * - source/dev: `dashr/src/url-schema/docs-dir.ts` → the built copy at
 *   `dashr/docs/` or the repo-root `docs/`
 * - bundled dev: `dashr/lib/index.js` → `dashr/docs/` or the repo-root `docs/`
 * - installed: `node_modules/@pgmi-builds/dashr/lib/index.js` → the packaged
 *   `node_modules/@pgmi-builds/dashr/docs/` (shipped via the `files` array)
 *
 * Near layers are probed first, so an unrelated ancestor `docs/` is only ever
 * reached when the package's own copy is absent.
 */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resolveDocsDir(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'docs')
    try {
      if (statSync(candidate).isDirectory()) return candidate
    } catch {
      // no `docs/` here — walk up one level
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
