import { describe, expect, it } from 'vitest'
import { EXCLUDE, excluded } from '../../scripts/copy-docs.mjs'

describe('copy-docs EXCLUDE (docs-packaging-trim, 档位 F)', () => {
  it('drops the foreign doc mirror entirely', () => {
    expect(excluded('docs/80_upstream-docs-and-skills/hermes-dev-skill/src/api-skills.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/hermes-dev-skill/src-README.md')).toBe(true)
  })
  it('drops the uncited third-party reference and the fetch tooling', () => {
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/pi-and-omp/omp/x.md')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/pi-and-omp/.tools/omp_extracted.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/src-scripts/docs-tree.json')).toBe(true)
    expect(excluded('docs/80_upstream-docs-and-skills/dsh-dev-skill/src-scripts/crawl.py')).toBe(true)
  })
  it('keeps every load-bearing path', () => {
    for (const p of [
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/SKILL.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/chapters/ch02-plugin-basics.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/src/docs/architecture.md',
      'docs/80_upstream-docs-and-skills/dsh-dev-skill/src/site-pages-map.txt',
      'docs/50_test-reports/x.md',
      'docs/20_specs/ast/spec.md',
      'docs/specs/ast-engine-deomp/spec.md',
    ]) expect(excluded(p), p).toBe(false)
  })
  it('keeps the pre-existing rules working', () => {
    expect(excluded('docs/60_exploration-and-research/a.md')).toBe(true)
    expect(excluded('docs/superd/x.md')).toBe(true)
    expect(excluded('docs/dsh-sys-prompt_20260910.md')).toBe(true)
  })
  it('exports the rules for audit', () => {
    expect(EXCLUDE).toHaveLength(7)
  })
})
