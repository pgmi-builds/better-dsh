/**
 * AST availability reminder (change 2026-09-26-lsp-ast-reminder).
 *
 * Unit-level: the pure notice functions only. Scope = the Python/TypeScript
 * finite extension set (user ruling 2026-09-26: two LSPs → two language
 * families); firing policy = every matching non-error result, no cap, no
 * gate interaction (user ruling: "每次都提醒，能浪费多少时间").
 * Wire-level append mechanics are covered by the url-schemes wiring and the
 * 4999 live-fire checklist in the plan doc.
 */

import { describe, expect, it } from 'vitest'

import {
  AST_CODE_EXTENSIONS,
  astFileNotice,
  astGrepNotice,
  astReminderNotice,
} from '../../src/devices/ast/ast-reminder.ts'

describe('ast file extension set', () => {
  it('is the Python/TypeScript finite set (py + ts family, nothing else)', () => {
    expect([...AST_CODE_EXTENSIONS].sort()).toEqual(['.cts', '.mts', '.py', '.ts', '.tsx'])
  })
})

describe('astFileNotice (write/edit targets)', () => {
  it('fires for python and typescript extensions', () => {
    for (const p of ['/repo/a.py', '/repo/src/b.ts', '/repo/c.tsx', '/repo/d.mts', '/repo/e.cts']) {
      expect(astFileNotice(p), p).toMatch(/ast_edit/)
    }
  })

  it('stays silent for non-set extensions', () => {
    for (const p of ['/repo/a.md', '/repo/b.rs', '/repo/c.go', '/repo/d.json', '/repo/e']) {
      expect(astFileNotice(p), p).toBeUndefined()
    }
  })

  it('is case-insensitive on the extension', () => {
    expect(astFileNotice('/repo/A.PY')).toMatch(/ast_grep/)
    expect(astFileNotice('/repo/B.TS')).toMatch(/ast_grep/)
  })
})

describe('astGrepNotice (search entry points)', () => {
  it('fires when include matches py/ts', () => {
    expect(astGrepNotice({ path: '/repo', include: '*.{ts,tsx}' })).toMatch(/ast_grep/)
    expect(astGrepNotice({ path: '/repo', include: '*.py' })).toMatch(/ast_grep/)
  })

  it('fires when the path itself is a code file', () => {
    expect(astGrepNotice({ path: '/repo/a.py' })).toMatch(/ast_grep/)
    expect(astGrepNotice({ path: '/repo/b.ts' })).toMatch(/ast_grep/)
  })

  it('fires for directory or default-path searches (the common code-tree case)', () => {
    expect(astGrepNotice({ path: '/repo/src' })).toMatch(/ast_grep/)
    expect(astGrepNotice({})).toMatch(/ast_grep/)
    expect(astGrepNotice(undefined)).toMatch(/ast_grep/)
  })

  it('stays silent only when the path clearly points at a non-code file', () => {
    expect(astGrepNotice({ path: '/repo/docs/x.md' })).toBeUndefined()
    expect(astGrepNotice({ path: '/repo/README', include: '*.md' })).toBeUndefined()
  })
})

describe('astReminderNotice (tool dispatch shape)', () => {
  it('routes write/edit through the file rule and grep through the search rule', () => {
    expect(astReminderNotice('edit', { path: '/repo/a.py' })).toMatch(/ast_edit/)
    expect(astReminderNotice('write', { file_path: '/repo/b.ts' })).toMatch(/ast_edit/)
    expect(astReminderNotice('grep', { path: '/repo/src' })).toMatch(/ast_grep/)
    expect(astReminderNotice('grep', { path: '/repo/x.md' })).toBeUndefined()
  })

  it('mentions both devices with their dvc:// addresses', () => {
    const notice = astReminderNotice('write', { path: '/repo/a.py' })
    expect(notice).toContain('dvc://ast_edit')
    expect(notice).toContain('dvc://ast_grep')
  })

  it('is a single line (no interruption, one suffix line only)', () => {
    const notice = astReminderNotice('edit', { path: '/repo/a.py' })
    expect(notice?.includes('\n')).toBe(false)
  })
})
