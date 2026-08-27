/**
 * Temp materialization for content-backed URL searches.
 *
 * A content-backed scheme (agent, ctx, `dsh://config`, http, …) resolves to
 * TEXT, not to a disk location. The URL-aware `grep`/`glob` still delegate to
 * the native tool, so the resolved text is written into a fresh temp
 * directory and the native call is pointed at it; the directory is removed
 * in a `finally` whatever the native call returns or throws.
 *
 * The directory is rooted on the `/dev/shm` tmpfs when one is mounted and
 * writable: content-backed snapshots are KB-scale, ripgrep is indifferent to
 * the filesystem, and tmpfs vanishes on crash. A single materialization
 * larger than {@link SHM_MAX_BYTES} falls back to `os.tmpdir()` so one huge
 * snapshot cannot exhaust the shared shm quota; so does every call when shm
 * is unavailable.
 */

import { accessSync, constants } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Root preferred for materialization; temp dirs are `dashr-url-*` inside it. */
const SHM_ROOT = '/dev/shm'

/** Per-materialization shm ceiling (8 MiB); strictly larger goes to disk. */
const SHM_MAX_BYTES = 8 * 1024 * 1024

/** Lazy probe cache: `undefined` until first probed, then the answer. */
let shmWritable: boolean | undefined

/** Probe `/dev/shm` lazily, at most once, and cache the answer. */
function probeOnce(): boolean {
  if (shmWritable === undefined) {
    try {
      accessSync(SHM_ROOT, constants.W_OK)
      shmWritable = true
    } catch {
      shmWritable = false
    }
  }
  return shmWritable
}

/**
 * Whether `/dev/shm` is mounted and writable. Object form is deliberate:
 * the decision is reached through this property inside the module, so tests
 * can stub the whole thing (`vi.spyOn(shmProbe, 'writable')`) — a stub
 * replaces the lazy cache along with the probe.
 */
export const shmProbe = { writable: probeOnce }

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
  const root =
    shmProbe.writable() && Buffer.byteLength(text) <= SHM_MAX_BYTES
      ? SHM_ROOT
      : tmpdir()
  const tempDir = await mkdtemp(join(root, 'dashr-url-'))
  try {
    await writeFile(join(tempDir, 'content.txt'), text, 'utf8')
    return await body(tempDir)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
