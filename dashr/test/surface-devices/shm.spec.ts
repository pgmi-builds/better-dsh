/**
 * `/dev/shm` root selection for content-backed materialization (design D7).
 *
 * `withTempMaterialization` must root its temp dir on the tmpfs when the
 * probe says writable, fall back to `os.tmpdir()` when it does not or when a
 * single materialization exceeds 8 MiB, and keep the `dashr-url-*` prefix
 * and the `finally` cleanup on every path. The probe is stubbed via
 * `vi.spyOn` on the exported `shmProbe` holder (the module reaches the
 * decision through that property, so a stub replaces the lazy cache along
 * with the probe); the unstubbed case exercises the real `accessSync`
 * against this host's `/dev/shm` mount.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import * as materialize from '../../src/url-schema/tools/materialize.ts'

/** The shm and disk prefixes a materialized directory must carry. */
const SHM_PREFIX = '/dev/shm/dashr-url-'
const DISK_PREFIX = join(tmpdir(), 'dashr-url-')

/** Run one materialization of `text` and return the directory the body saw. */
async function materializeIn(text: string): Promise<string> {
  let seen = ''
  await materialize.withTempMaterialization(text, async (tempDir) => {
    seen = tempDir
  })
  return seen
}

describe('withTempMaterialization shm root selection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('roots on /dev/shm when the probe says writable', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(true)
    const tempDir = await materializeIn('needle here\nplain line\n')
    expect(tempDir.startsWith(SHM_PREFIX)).toBe(true)
    expect(existsSync(tempDir)).toBe(false)
  })

  it('materializes the full text and cleans up on /dev/shm', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(true)
    const text = 'needle here\nplain line\nneedle again'
    const tempDir = await materializeIn(text)
    // `tempDir` is already removed; only its recorded path can be asserted.
    expect(tempDir.startsWith(SHM_PREFIX)).toBe(true)
    const content = await materialize.withTempMaterialization(text, (dir) =>
      readFile(join(dir, 'content.txt'), 'utf8'),
    )
    expect(content).toBe(text)
  })

  it('probes the real /dev/shm mount once and uses it', () => {
    // This host mounts /dev/shm (design D7: tmpfs 6.6G), so the unstubbed
    // probe must answer true and cache it.
    expect(materialize.shmProbe.writable()).toBe(true)
  })

  it('falls back to os.tmpdir() when the probe says unwritable', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(false)
    const tempDir = await materializeIn('fallback content')
    expect(tempDir.startsWith(DISK_PREFIX)).toBe(true)
    expect(existsSync(tempDir)).toBe(false)
  })

  it('falls back to os.tmpdir() above the 8 MiB shm ceiling', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(true)
    const tempDir = await materializeIn('x'.repeat(8 * 1024 * 1024 + 1))
    expect(tempDir.startsWith(DISK_PREFIX)).toBe(true)
  })

  it('keeps exactly 8 MiB on /dev/shm', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(true)
    const tempDir = await materializeIn('x'.repeat(8 * 1024 * 1024))
    expect(tempDir.startsWith(SHM_PREFIX)).toBe(true)
  })

  it('removes the directory and propagates when the body throws', async () => {
    vi.spyOn(materialize.shmProbe, 'writable').mockReturnValue(true)
    const tempDir = await materialize
      .withTempMaterialization('boom', async (dir) => {
        throw new Error(`body failed inside ${dir}`)
      })
      .catch((error: Error) => error.message.replace('body failed inside ', ''))
    expect(tempDir.startsWith(SHM_PREFIX)).toBe(true)
    expect(existsSync(tempDir)).toBe(false)
  })
})
