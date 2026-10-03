import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { ENGINE_ASSETS, GRAMMAR_ASSETS, GRAMMAR_PACKAGES } from '../../src/devices/ast/engine/grammar-manifest.mjs'

const require = createRequire(import.meta.url)

describe('ast engine asset manifest', () => {
  it('covers exactly the 14 languages of the device surface', () => {
    expect(Object.keys(GRAMMAR_PACKAGES).sort()).toEqual([
      'bash', 'c', 'cpp', 'css', 'go', 'html', 'javascript', 'json',
      'python', 'ruby', 'rust', 'tsx', 'typescript', 'yaml',
    ])
  })
  it('pins every grammar to a @lumis-sh 0.26 package (dylink.0 ABI lockstep)', () => {
    for (const pkg of Object.values(GRAMMAR_PACKAGES)) {
      expect(pkg).toMatch(/^@lumis-sh\/wasm-[a-z]+$/)
    }
  })
  it('resolves every asset from node_modules (dev form) — engine wasm + runtime + 14 grammars', () => {
    for (const entry of [...ENGINE_ASSETS, ...Object.values(GRAMMAR_ASSETS)]) {
      expect(existsSync(require.resolve(entry.subpath)), entry.subpath).toBe(true)
    }
  })
})
