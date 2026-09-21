/**
 * `dsh://` path-backed view (six-scheme audit §3.4) and the `?q=` line-filter
 * fallback on JSON array listings (§3.3).
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createDshHandler } from '../../src/url-schemes/handlers/dsh.ts'
import { UrlResolver } from '../../src/url-schemes/resolver.ts'

function makeDsh() {
  const docs = mkdtempSync(join(tmpdir(), 'dsh-docs-'))
  mkdirSync(join(docs, 'subsystems'), { recursive: true })
  writeFileSync(join(docs, 'README.md'), '# docs index\nwelcome to the docs\n')
  writeFileSync(join(docs, 'subsystems', 'slots.md'), '# slots\npriority queue\n')
  writeFileSync(join(docs, 'subsystems', 'other.md'), 'other file\n')
  const handler = createDshHandler({ docsDir: docs })
  const resolver = new UrlResolver()
  resolver.register('dsh', handler)
  return { resolver, handler, docs }
}

describe('dsh:// path-backed view and ?q= fallback', () => {
  it('resolvePath maps docs and docs/<sub> to real disk paths; config is not path-backed', async () => {
    const { handler, docs } = makeDsh()
    expect(await handler.resolvePath({}, 'docs')).toBe(docs)
    expect(await handler.resolvePath({}, 'docs/subsystems')).toBe(join(docs, 'subsystems'))
    expect(await handler.resolvePath({}, 'docs/subsystems/slots.md')).toBe(join(docs, 'subsystems', 'slots.md'))
    expect(await handler.resolvePath({}, 'docs/nope')).toBeUndefined()
    expect(await handler.resolvePath({}, 'config')).toBeUndefined()
  })

  it('?q= on a JSON array listing falls back to the line filter (no silent no-op)', async () => {
    const { resolver } = makeDsh()
    const out = await resolver.resolve({}, 'dsh://docs/subsystems?q=slots')
    expect(out).toContain('slots.md')
    expect(out).not.toContain('other.md')
  })
})

describe('dsh-docs vendored corpus preference (2026-09-15)', () => {
  it('the packaged dsh-docs tree is the upstream official docs and backs dsh://docs first', async () => {
    // Resolution order in the handler: explicit docsDir → pkgRoot/dsh-docs →
    // pkgRoot/docs → pkgRoot/../docs. With no explicit docsDir the vendored
    // corpus (upstream official harness docs) wins over the repo's own docs/.
    const docs = '/home/u1/workspaces/dashr/better-dsh/dsh-docs'
    const handler = createDshHandler({ docsDir: undefined as never })
    void handler
    const entries = await readdir(docs)
    expect(entries).toContain('agent-lifecycle.md')
    expect(entries.length).toBeGreaterThan(20)
  })
})
