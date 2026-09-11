import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { loadHashStore, shutdownHashStore } from '../src/url-schemes/vendored/hashline/hash-store.js'
import {
  clearDriftReported,
  driftReported,
  loadServed,
  markDriftReported,
  recordServed,
  withWorkspace,
} from '../src/url-schemes/vendored/hashline/session-view.js'
import { configDir, hashStorePath } from '../src/url-schemes/vendored/hashline/paths.js'
import { verifyServedRange } from '../src/url-schemes/vendored/hashline/hashline/anchor-pipeline.js'
import { initHasher, lineHashesPure } from '../src/url-schemes/vendored/hashline/hashline/hash-assign.js'
import { HASH_STORE_VERSION } from '../src/url-schemes/vendored/hashline/constants.js'

/**
 * v0.2.3b hashline-content-locator contract:
 * - ONE centralized store per harness home (`$DSH_HOME/storages/dsh-better-edit`),
 *   keyed by canonical absolute path — no session identity, no per-workspace
 *   dot-directory, so anchors survive session-tree forks without a re-read.
 * - Edit verification is content-anchored: bounds resolving in the current
 *   file pass even when the served ledger has never seen the file; a ledger
 *   that DOES know the file still drift-checks (STALE/UNSERVED preserved).
 */

const ORIGINAL_DSH_HOME = process.env.DSH_HOME
const homes: string[] = []

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dashr-hashline-'))
  process.env.DSH_HOME = home
  homes.push(home)
  return home
}

const FILE_A = '/tmp/fake-ws-a/docs/plan.md'
const FILE_B = '/tmp/fake-ws-b/notes.md'

function rowsFor(content: string): Array<{ position: number, hash: string }> {
  return lineHashesPure(content).map((hash, position) => ({ position, hash }))
}

const CONTENT = ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five'].join('\n')

beforeAll(async () => {
  await initHasher()
})

afterEach(() => {
  shutdownHashStore()
})

afterAll(() => {
  shutdownHashStore()
  for (const home of homes) {
    rmSync(home, { recursive: true, force: true })
  }
  if (ORIGINAL_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = ORIGINAL_DSH_HOME
})

describe('centralized hash store (schema v7)', () => {
  it('lands the store under $DSH_HOME/storages/dsh-better-edit and creates no per-workspace dot-directory', async () => {
    const home = newHome()
    const cwd = join(home, 'some-workspace')
    mkdirSync(cwd, { recursive: true })
    await withWorkspace(cwd, async () => {
      await recordServed(FILE_A, rowsFor(CONTENT), undefined)
    })
    expect(existsSync(hashStorePath())).toBe(true)
    expect(hashStorePath()).toBe(join(configDir(), 'hash-store.sqlite'))
    expect(existsSync(join(cwd, '.dsh_better_edit'))).toBe(false)
  })

  it('keys served rows by path only: an upsert merges, never duplicates', async () => {
    newHome()
    const rows = rowsFor(CONTENT)
    await recordServed(FILE_A, rows.slice(0, 3), undefined)
    await recordServed(FILE_A, rows, undefined)
    const served = await loadServed(FILE_A)
    expect(served).toEqual(rows.map((row) => row.hash))
    const db = new DatabaseSync(hashStorePath(), { readOnly: true })
    try {
      const count = db.prepare('SELECT COUNT(*) AS n FROM served WHERE path = ?').get(FILE_A) as { n: number }
      expect(count.n).toBe(1)
      const columns = db.prepare('PRAGMA table_info(served)').all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === 'session_id')).toBe(false)
    } finally {
      db.close()
    }
  })

  it('serves the same rows to any later session context (fork simulation) without a re-read', async () => {
    newHome()
    await recordServed(FILE_A, rowsFor(CONTENT), undefined)
    const otherWorkspace = join(tmpdir(), 'dashr-hashline-other-ws')
    mkdirSync(otherWorkspace, { recursive: true })
    try {
      await withWorkspace(otherWorkspace, async () => {
        expect(await loadServed(FILE_A)).toEqual(lineHashesPure(CONTENT))
      })
    } finally {
      rmSync(otherWorkspace, { recursive: true, force: true })
    }
  })

  it('keeps drift marks on the path key', async () => {
    newHome()
    const hashes = lineHashesPure(CONTENT)
    await markDriftReported(FILE_A, [hashes[0] as string])
    expect(await driftReported(FILE_A)).toContain(hashes[0])
    expect(await driftReported(FILE_B)).not.toContain(hashes[0])
    await clearDriftReported(FILE_A)
    expect(await driftReported(FILE_A).then((set) => set.size)).toBe(0)
  })
})

describe('schema v6 → v7 migration', () => {
  it('rebuilds a legacy session-keyed served table on open', async () => {
    const home = newHome()
    const storePath = hashStorePath()
    mkdirSync(configDir(), { recursive: true })
    const legacy = new DatabaseSync(storePath)
    legacy.exec('CREATE TABLE snapshots (path TEXT PRIMARY KEY, checksum TEXT NOT NULL, line_count INTEGER NOT NULL, hashes TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    legacy.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    legacy.exec('CREATE TABLE undo (path TEXT PRIMARY KEY, content TEXT NOT NULL, bom TEXT NOT NULL, ending TEXT NOT NULL, hashes TEXT NOT NULL, result_content TEXT NOT NULL, updated_at INTEGER NOT NULL)')
    legacy.exec('CREATE TABLE served (session_id TEXT NOT NULL, path TEXT NOT NULL, hashes TEXT NOT NULL, reported TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (session_id, path))')
    legacy.prepare("INSERT INTO meta (key, value) VALUES ('version', '6')").run()
    legacy.prepare('INSERT INTO served (session_id, path, hashes, updated_at) VALUES (?, ?, ?, ?)').run('session-legacy', FILE_A, '["lgU"]', Date.now())
    legacy.close()

    const store = await loadHashStore()
    expect(store.getServed(FILE_A)).toEqual([])
    expect(store.getServed('session-legacy/nonexistent')).toEqual([])
    const db = new DatabaseSync(storePath, { readOnly: true })
    try {
      const columns = db.prepare('PRAGMA table_info(served)').all() as Array<{ name: string }>
      expect(columns.some((column) => column.name === 'session_id')).toBe(false)
      const version = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string }
      expect(version.value).toBe(String(HASH_STORE_VERSION))
    } finally {
      db.close()
    }
  })
})

describe('served TTL prune', () => {
  it('drops rows older than the retention window', async () => {
    newHome()
    await recordServed(FILE_A, rowsFor(CONTENT), undefined)
    const store = await loadHashStore()
    const stale = new DatabaseSync(hashStorePath())
    try {
      stale.prepare('UPDATE served SET updated_at = ? WHERE path = ?').run(1_000, FILE_A)
    } finally {
      stale.close()
    }
    store.pruneServedOlderThan(Date.now())
    expect(await loadServed(FILE_A)).toEqual([])
  })
})

describe('content-anchored edit verification (verifyServedRange)', () => {
  const lines = CONTENT.split('\n')
  const hashes = lineHashesPure(CONTENT)
  const startHash = hashes[0] as string
  const endHash = hashes[4] as string
  const base = { startHash, endHash, startLine: 1, endLine: 5, fileHashes: hashes, fileLines: lines, filePath: FILE_A }

  it('accepts bounds that resolve in the current file even when the ledger never saw it (cross-fork)', () => {
    expect(() => verifyServedRange({ ...base, served: [] })).not.toThrow()
  })

  it('keeps the ledger happy path: fully served and matching passes', () => {
    expect(() => verifyServedRange({ ...base, served: [...hashes] })).not.toThrow()
  })

  it('still rejects interior drift when the ledger knows the file', () => {
    const served = [...hashes]
    served[2] = 'zzZ'
    expect(() => verifyServedRange({ ...base, served })).toThrowError(/E_RANGE_STALE/)
  })

  it('still rejects never-served holes inside a ledger-known span', () => {
    const served: Array<string | null> = [...hashes]
    served[2] = null
    expect(() => verifyServedRange({ ...base, served })).toThrowError(/E_RANGE_UNSERVED/)
  })

  it('rejects a one-sided ledger (partial state) instead of guessing', () => {
    const served = [startHash]
    expect(() => verifyServedRange({ ...base, served })).toThrowError(/E_RANGE_UNVERIFIED/)
  })

  it('guides toward read-once-then-resubmit on rejection', () => {
    const served = [startHash]
    try {
      verifyServedRange({ ...base, served })
      expect.unreachable('expected E_RANGE_UNVERIFIED')
    } catch (error) {
      expect((error as Error).message).toMatch(/Read the file once.*resubmit the whole batch/)
    }
  })
})
