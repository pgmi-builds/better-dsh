import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { isVirtualTarget, createUrlAwareFileSystemBackend } from '../../src/url-schemes/fs-backend.ts'

/** Real cordis context + sandboxPolicy stub (backend ctor reads the defaults). */
function stubConfig(): Record<string, unknown> {
  // LocalConfig with the diffBasis default the ctor validates (mirrors the
  // schemastery default the fs-sandbox row applies in production).
  return { diffBasisMaxBytes: 536870888 / 2 }
}

function stubCtx(): Context {
  const ctx = new Context()
  ;(ctx as unknown as { sandboxPolicy: unknown }).sandboxPolicy = {
    defaultMode: 'read-only',
    resolve: () => ({ mode: 'read-only' }),
  }
  return ctx
}

const GATES_ON = { urlSchemes: true, hashline: true } as const

describe('UrlAwareFileSystem backend (phase-2 spike)', () => {
  it('detects virtual targets by the scheme prefix of their key', () => {
    expect(isVirtualTarget('ctx://session/compactions[20]')).toBe(true)
    expect(isVirtualTarget('/w/dashr/src/index.ts')).toBe(false)
  })

  it('builds the backend when the sandbox base resolves (dev workspace)', async () => {
    const backend = await createUrlAwareFileSystemBackend({
      ctx: stubCtx(), config: stubConfig(), resolveUrl: async () => 'RESOLVED-TEXT', gates: GATES_ON,
    })
    expect(backend).toBeDefined()
    expect(backend!.backendName).toContain('UrlAwareFileSystem')
  })

  it('virtual targets: resolve → stat(file) → readText(dereferenced)', async () => {
    const backend = await createUrlAwareFileSystemBackend({
      ctx: stubCtx(), config: stubConfig(), resolveUrl: async () => 'RESOLVED-TEXT', gates: GATES_ON,
    })
    if (backend === undefined) return // sandbox base unavailable in this env — spike N/A
    const fs = backend.instance as {
      resolve(path: string): Promise<{ targetKey: string; displayPath: string }>
      stat(target: { targetKey: string }): Promise<{ type: string; size: number }>
      readText(target: { targetKey: string }): Promise<string>
    }
    const target = await fs.resolve('ctx://session/compactions[20]')
    expect(target.targetKey).toBe('ctx://session/compactions[20]')
    expect(target.displayPath).toBe('ctx://session/compactions[20]')
    const info = await fs.stat(target)
    expect(info.type).toBe('file')
    expect(info.size).toBe('RESOLVED-TEXT'.length)
    await expect(fs.readText(target)).resolves.toBe('RESOLVED-TEXT')
  })

  it('virtual targets are read-only', async () => {
    const backend = await createUrlAwareFileSystemBackend({
      ctx: stubCtx(), config: stubConfig(), resolveUrl: async () => 'X', gates: GATES_ON,
    })
    if (backend === undefined) return
    const fs = backend.instance as { writeText(target: { targetKey: string }): Promise<unknown> }
    await expect(fs.writeText({ targetKey: 'ctx://session' }) as Promise<unknown>).rejects.toThrow(/FS_VIRTUAL_READONLY/)
  })

  it('factory respects the urlSchemes gate', async () => {
    const backend = await createUrlAwareFileSystemBackend({
      ctx: stubCtx(), config: {}, resolveUrl: async () => 'x',
      gates: { urlSchemes: false, hashline: true },
    })
    expect(backend).toBeUndefined()
  })
})
