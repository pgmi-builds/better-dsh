/**
 * `resolveDocsDir`: locate the harness `docs/` tree that backs `dsh://docs`.
 *
 * A fixed-depth `dirname×N(import.meta.url)` anchor breaks the moment the
 * module moves (tsdown bundling inlines this file into `lib/index.js`, so the
 * depth differs between source and build). A nearest-first walk-up from this
 * module's own location survives every layout:
 *
 * - source/dev: `dashr/src/url-schemes/docs-dir.ts` → the built copy at
 *   `dashr/docs/` or the repo-root `docs/`
 * - bundled dev: `dashr/lib/index.js` → `dashr/docs/` or the repo-root `docs/`
 * - installed: `node_modules/better-dsh/lib/index.js` → the packaged
 *   `node_modules/better-dsh/docs/` (shipped via the `files` array)
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
    // `dsh-docs` (vendored upstream official docs) wins over a plain `docs/`
    // working-notes directory at the same level.
    for (const name of ['dsh-docs', 'docs']) {
      const candidate = join(dir, name)
      try {
        if (statSync(candidate).isDirectory()) return candidate
      } catch {
        // not present — try the next candidate
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
