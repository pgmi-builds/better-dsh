/**
 * `better-dsh/fs-aware-sandbox` unit matrix (task 1.4): gate on/off routing,
 * virtual read-only enforcement, the session-layer boundary, and real-path
 * passthrough. `skill://` / `dvc://` / `http://` live coverage runs on the
 * 4999 instance (real services/registry), not here.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { UrlSchemesError } from '../../src/url-schemes/selector.ts'
import { Context } from '@deepseek-ai/cordis'

import FsAwareSandboxFileSystem from '../../src/fs-aware/sandbox-plugin.ts'

function stubCtx(services: Record<string, unknown> = {}): Context {
  const ctx = new Context()
  ;(ctx as unknown as Record<string, unknown>).sandboxPolicy = {
    defaultMode: 'read-only',
    resolve: () => ({ mode: 'read-only' }),
  }
  for (const [k, v] of Object.entries(services)) {
    ;(ctx as unknown as Record<string, unknown>)[k] = v
  }
  return ctx
}

function makeFs(config: { urlSchemes?: boolean } = {}, services: Record<string, unknown> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'fs-aware-'))
  // diffBasisMaxBytes: the ctor validates a positive safe integer (mirrors the
  // schemastery default the fs-sandbox row applies in production) — same stub
  // as fs-backend.spec.
  const fs = new FsAwareSandboxFileSystem(stubCtx(services), {
    urlSchemes: config.urlSchemes,
    cwd,
    diffBasisMaxBytes: 536870888 / 2,
  })
  return { fs: fs as unknown as FsAwareSandboxFileSystem & BaseView, cwd }
}

interface BaseView {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: string; displayPath: string }>
  stat(target: { targetKey: string }): Promise<{ type: string; size?: number }>
  readText(target: { targetKey: string }): Promise<string>
  writeText(target: { targetKey: string }, content?: string): Promise<unknown>
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return '(no throw)'
  } catch (err) {
    return err instanceof UrlSchemesError ? err.code : `(other) ${String(err)}`
  }
}

describe('fs-aware sandbox module', () => {
  it('gate on: dsh://docs resolves through the FS-layer resolver (virtual dereference)', async () => {
    const { fs } = makeFs({ urlSchemes: true })
    const target = await fs.resolve('dsh://docs')
    expect(target.targetKey).toBe('dsh://docs')
    expect(target.displayPath).toBe('dsh://docs')
    const text = await fs.readText(target)
    expect(text.length).toBeGreaterThan(0)
    const info = (await fs.stat(target)) as { type: string; size?: number }
    expect(info.type).toBe('file')
    expect(info.size).toBe(text.length)
  })

  it('gate on: session-layer schemes answer with the structured boundary error', async () => {
    const { fs } = makeFs({ urlSchemes: true })
    expect(await errorCode(fs.resolve('ctx://session'))).toBe('CTX_SESSION_LAYER')
    expect(await errorCode(fs.readText({ targetKey: 'agent://x' }))).toBe('CTX_SESSION_LAYER')
    expect(await errorCode(fs.resolve('agent://'))).toBe('CTX_SESSION_LAYER')
  })

  it('gate on: virtual targets reject writes with FS_VIRTUAL_READONLY', async () => {
    const { fs } = makeFs({ urlSchemes: true })
    expect(await errorCode(fs.writeText({ targetKey: 'skill://x/SKILL.md' }, 'nope'))).toBe('FS_VIRTUAL_READONLY')
    expect(await errorCode(fs.writeText({ targetKey: 'dsh://config' }, 'nope'))).toBe('FS_VIRTUAL_READONLY')
  })

  it('gate on: real-path passthrough (resolve + readText hit the inherited local backend)', async () => {
    const { fs, cwd } = makeFs({ urlSchemes: true })
    const marker = 'FS-AWARE REAL PATH MARKER'
    const { writeFileSync } = await import('node:fs')
    const file = join(cwd, 'real.txt')
    writeFileSync(file, marker)
    const target = await fs.resolve('real.txt')
    expect(target.targetKey).not.toContain('://')
    expect(await fs.readText(target)).toBe(marker)
  })

  it('wrap: https registered + skill:// reclassified to the session-layer boundary', async () => {
    const { fs } = makeFs({ urlSchemes: true })

    // P1-a (kept): https IS registered at the FS layer. Either outcome
    // proves registration — a successful dereference (network reachable)
    // or a fetch failure — but NEVER the resolver's "no handler registered".
    const httpsOutcome = await errorCode(fs.resolve('https://example.com'))
    expect(httpsOutcome).not.toContain('no handler')

    // Skill-delegation ruling (2026-09-13): skill discovery is the host
    // provider's business logic and resolves only against a calling agent —
    // the FS layer answers the session-layer boundary for EVERY skill name,
    // never a registry verdict guessed from a config cwd.
    expect(await errorCode(fs.resolve('skill://book-to-skill'))).toBe('CTX_SESSION_LAYER')
    expect(await errorCode(fs.readText({ targetKey: 'skill://nope' }))).toBe('CTX_SESSION_LAYER')

    // session-layer boundary intact for the original family
    expect(await errorCode(fs.resolve('ctx://session'))).toBe('CTX_SESSION_LAYER')
    expect(await errorCode(fs.resolve('agent://x'))).toBe('CTX_SESSION_LAYER')
  })
  async function errorCode(p: Promise<unknown>): Promise<string> {
    try { await p; return '(no throw)' } catch (e) { return e instanceof UrlSchemesError ? e.code : `(other) ${String(e)}` }
  }

  it('gate off: scheme paths degrade to stock semantics (no virtual target)', async () => {
    const { fs } = makeFs({ urlSchemes: false })
    const target = await fs.resolve('dsh://docs')
    expect(target.targetKey).not.toBe('dsh://docs')
    await expect(errorCode(fs.readText({ targetKey: 'dsh://docs' }))).not.toBe('CTX_SESSION_LAYER')
  })
})
