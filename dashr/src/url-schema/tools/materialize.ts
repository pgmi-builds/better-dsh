/**
 * Temp materialization for content-backed URL searches.
 *
 * A content-backed scheme (agent, ctx, `dsh://config`, http, …) resolves to
 * TEXT, not to a disk location. The URL-aware `grep`/`glob` still delegate to
 * the native tool, so the resolved text is written into a fresh temp
 * directory and the native call is pointed at it; the directory is removed
 * in a `finally` whatever the native call returns or throws.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Run `body(tempDir)` with `text` materialized as `content.txt` inside a
 * fresh temp directory, removing the directory afterwards. The body receives
 * the directory (not the file) so grep can target the file and glob can
 * search the directory, each with its own path shape.
 */
export async function withTempMaterialization<T>(
  text: string,
  body: (tempDir: string) => Promise<T>,
): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'dashr-url-'))
  try {
    await writeFile(join(tempDir, 'content.txt'), text, 'utf8')
    return await body(tempDir)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
