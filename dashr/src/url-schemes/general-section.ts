/**
 * The `url-schema:general` system-prompt section (L1 existence disclosure,
 * OMP three-layer model): the URL grammar, selector set, per-scheme variance,
 * write surface, and the scheme table. Gated by the `urlSchemes` feature
 * gate — when the capability is off the section is not rendered at all (no
 * empty promises).
 *
 * Single surfacing point (recallable-context ruling): the section text lives
 * in the package-root `url-schemes-section.md`, loaded once at module load
 * (the `eval-description.md` pattern from 0.2.3-d). The file ships via the
 * package.json `files` array; if it is missing the module-load read fails
 * loudly at plugin boot instead of silently dropping the disclosure. The
 * read/grep/glob/write tool descriptions carry no scheme mentions, so this
 * section is the one place the scheme set surfaces to the model — the model
 * cannot believe only some tools accept URLs. Error messages keep sourcing
 * the scheme set from `catalog.ts`; only the section prose moved to the file.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ReadGates } from './transforms.ts'

export const GENERAL_SECTION_NAME = 'url-schema:general'
export const GENERAL_SECTION_ORDER = 129

/** The section file's name, resolved against the nearest ancestor directory. */
const SECTION_FILE = 'url-schemes-instruction.md'

/**
 * Load the section text at module load, walking up to the nearest copy.
 *
 * A fixed-depth `new URL('../…', import.meta.url)` breaks here: tsdown
 * inlines this module into `lib/index.js`, so the depth from the module to
 * the package root differs between source (`src/url-schemes/general-section.ts`)
 * and build (`lib/index.js`) — the same reason `docs-dir.ts` walks up. Near
 * layers are probed first, so an unrelated ancestor copy is only ever reached
 * when the package's own file is absent.
 */
function loadSectionText(): string {
  const here = fileURLToPath(import.meta.url)
  let dir = dirname(here)
  for (;;) {
    try {
      return readFileSync(join(dir, SECTION_FILE), 'utf8')
    } catch {
      // no section file at this level — walk up one level
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `${SECTION_FILE} not found from ${here} — it must ship with the package (package.json "files")`,
      )
    }
    dir = parent
  }
}

const SECTION_TEXT = loadSectionText()

/** Render the section when the URL capability is on; `undefined` gates it off. */
export function generalSection(gates: ReadGates): { name: string; order: number; text: string } | undefined {
  if (!gates.urlSchemes) return undefined
  return { name: GENERAL_SECTION_NAME, order: GENERAL_SECTION_ORDER, text: SECTION_TEXT }
}
