/**
 * AST availability reminder (change 2026-09-26-lsp-ast-reminder, 2026-09-27 tuning).
 *
 * Unit-level: the pure predicates + the per-session cap. Scope = the AST
 * tool's own grammar surface (empirically probed against the shipped
 * pi-natives binary; decoupled from LSP per user ruling 2026-09-27). Firing
 * policy = at most 5 reminders per agent session, then silent (user ruling).
 * Wire-level append mechanics are covered by
 * test/url-schemes/post-execute-reminders.spec.ts and the 4999 live-fire
 * checklist in the plan doc.
 */

import { describe, expect, it } from 'vitest'

import {
  AST_CODE_EXTENSIONS,
  AST_REMINDER_CAP,
  astFileNotice,
  astGrepNotice,
  astReminderNotice,
  disposeAstReminders,
} from '../../src/devices/ast/ast-reminder.ts'

const SID = 'ast-reminder-spec'

describe('ast capable extension set (probed against pi-natives)', () => {
  it('covers the probed language families, not tied to the LSP table', () => {
    for (const ext of ['.py', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.mts', '.cts',
      '.rs', '.go', '.c', '.cpp', '.h', '.hpp', '.html', '.css', '.json', '.yaml', '.yml', '.sh', '.rb']) {
      expect(AST_CODE_EXTENSIONS.has(ext), ext).toBe(true)
    }
  })

  it('excludes prose and unproven grammars', () => {
    for (const ext of ['.md', '.java', '.toml', '.txt']) {
      expect(AST_CODE_EXTENSIONS.has(ext), ext).toBe(false)
    }
  })
})

describe('astFileNotice (write/edit targets)', () => {
  it('fires across the whole probed language range', () => {
    for (const p of ['/repo/a.py', '/repo/b.rs', '/repo/c.go', '/repo/d.c', '/repo/e.cpp',
      '/repo/f.html', '/repo/g.css', '/repo/h.json', '/repo/i.yaml', '/repo/j.sh', '/repo/k.rb']) {
      disposeAstReminders(SID)
      expect(astFileNotice(SID, p), p).toMatch(/ast_edit/)
    }
    disposeAstReminders(SID)
  })

  it('stays silent for prose and unknown extensions', () => {
    disposeAstReminders(SID)
    for (const p of ['/repo/a.md', '/repo/b.java', '/repo/c.toml', '/repo/d']) {
      expect(astFileNotice(SID, p), p).toBeUndefined()
    }
  })

  it('is case-insensitive on the extension', () => {
    disposeAstReminders(SID)
    expect(astFileNotice(SID, '/repo/A.PY')).toMatch(/ast_grep/)
    expect(astFileNotice(SID, '/repo/B.TS')).toMatch(/ast_grep/)
    disposeAstReminders(SID)
  })
})

describe('astGrepNotice (search entry points)', () => {
  it('fires when include names a covered extension', () => {
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo', include: '*.{ts,tsx}' })).toMatch(/ast_grep/)
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo', include: '*.py' })).toMatch(/ast_grep/)
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo', include: '*.rs' })).toMatch(/ast_grep/)
    disposeAstReminders(SID)
  })

  it('fires when the path itself is a code file', () => {
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo/a.go' })).toMatch(/ast_grep/)
    disposeAstReminders(SID)
  })

  it('fires for directory or default-path searches (the common code-tree case)', () => {
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo/src' })).toMatch(/ast_grep/)
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, {})).toMatch(/ast_grep/)
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, undefined)).toMatch(/ast_grep/)
    disposeAstReminders(SID)
  })

  it('stays silent only when the target clearly is not AST-capable', () => {
    disposeAstReminders(SID)
    expect(astGrepNotice(SID, { path: '/repo/docs/x.md' })).toBeUndefined()
    expect(astGrepNotice(SID, { path: '/repo/README', include: '*.md' })).toBeUndefined()
  })
})

describe('per-session cap (user ruling: 5 is enough)', () => {
  it('emits at most AST_REMINDER_CAP times per session, then goes silent', () => {
    disposeAstReminders(SID)
    let emitted = 0
    for (let i = 0; i < AST_REMINDER_CAP + 3; i++) {
      if (astFileNotice(SID, `/repo/f${i}.py`) !== undefined) emitted++
    }
    expect(emitted).toBe(AST_REMINDER_CAP)
    // Further matching results stay silent without a dispose.
    expect(astFileNotice(SID, '/repo/more.py')).toBeUndefined()
    disposeAstReminders(SID)
  })

  it('budget is shared across tools within one session', () => {
    disposeAstReminders(SID)
    astReminderNotice(SID, 'write', { path: '/repo/a.py' })
    astReminderNotice(SID, 'edit', { path: '/repo/b.ts' })
    astReminderNotice(SID, 'grep', { path: '/repo/src' })
    let emitted = 3
    for (let i = 0; i < AST_REMINDER_CAP; i++) {
      if (astReminderNotice(SID, 'grep', { path: '/repo/src' }) !== undefined) emitted++
    }
    expect(emitted).toBe(AST_REMINDER_CAP)
    expect(astGrepNotice(SID, { path: '/repo/src' })).toBeUndefined()
    disposeAstReminders(SID)
  })

  it('dispose resets the budget (fresh session semantics)', () => {
    disposeAstReminders(SID)
    for (let i = 0; i < AST_REMINDER_CAP; i++) astFileNotice(SID, `/repo/f${i}.py`)
    expect(astFileNotice(SID, '/repo/capped.py')).toBeUndefined()
    disposeAstReminders(SID)
    expect(astFileNotice(SID, '/repo/fresh.py')).toMatch(/ast_edit/)
    disposeAstReminders(SID)
  })

  it('sessions are isolated from each other', () => {
    disposeAstReminders('s-a')
    for (let i = 0; i < AST_REMINDER_CAP; i++) astFileNotice('s-a', `/repo/a${i}.py`)
    expect(astFileNotice('s-a', '/repo/capped.py')).toBeUndefined()
    expect(astFileNotice('s-b', '/repo/other.py')).toMatch(/ast_edit/)
    disposeAstReminders('s-a')
    disposeAstReminders('s-b')
  })
})

describe('notice copy', () => {
  it('mentions both devices with their dvc:// addresses and is a single line', () => {
    disposeAstReminders(SID)
    const notice = astReminderNotice(SID, 'write', { path: '/repo/a.py' })
    expect(notice).toContain('dvc://ast_edit')
    expect(notice).toContain('dvc://ast_grep')
    expect(notice?.includes('\n')).toBe(false)
    disposeAstReminders(SID)
  })

  it('no longer claims a Python/TypeScript-only scope', () => {
    disposeAstReminders(SID)
    expect(astReminderNotice(SID, 'edit', { path: '/repo/a.rs' })).not.toContain('Python/TypeScript')
    disposeAstReminders(SID)
  })
})
