import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { walkSources } from '../../src/devices/ast/walker.ts'

let dir: string
beforeEach(() => { dir = mkdirSyncSync() })
afterEach(() => rmSync(dir, { recursive: true, force: true }))
function mkdirSyncSync(): string {
  const d = path.join(os.tmpdir(), `ast-walk-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(d, { recursive: true })
  return d
}
const write = (rel: string, body = 'const a = 1\n') => {
  const p = path.join(dir, rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, body)
}

describe('ast walker', () => {
  it('skips node_modules, dotdirs, and non-AST extensions', async () => {
    write('src/a.ts'); write('src/b.md'); write('node_modules/x/c.ts'); write('.hidden/d.ts')
    const { files } = await walkSources(dir, {})
    expect(files.map(f => path.relative(dir, f))).toEqual(['src/a.ts'])
  })
  it('honours .gitignore', async () => {
    write('src/a.ts'); write('src/gen/keep.ts'); write('.gitignore', 'src/gen/\n')
    const { files } = await walkSources(dir, {})
    expect(files.map(f => path.relative(dir, f))).toEqual(['src/a.ts'])
  })
  it('applies a glob tail against the root and reports limitReached', async () => {
    write('src/a.ts'); write('src/b.ts'); write('src/c.rb')
    const globbed = await walkSources(dir, { glob: '**/*.ts' })
    expect(globbed.files).toHaveLength(2)
    const capped = await walkSources(dir, { maxFiles: 1 })
    expect(capped.files).toHaveLength(1)
    expect(capped.limitReached).toBe(true)
  })
})
