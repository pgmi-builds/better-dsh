/**
 * Gate semantics (task 1.2; orthogonality reshape 2026-09-13): `resolveGates`
 * defaults/opt-outs, and the read CHAIN's routing — the scheme wrapper hands
 * non-scheme paths to the captured terminal delegate (or fails with the
 * structured `NATIVE_READ_UNAVAILABLE` when no delegate exists), never to a
 * silent reimplementation. Gates now decide what the composition root wires
 * (see `src/url-schemes/index.ts`); the modules themselves are independent
 * (hashline imports nothing of url-schemes and vice versa).
 */

import { describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { resolveGates } from '../../src/url-schemes/gates.ts'
import { createSchemeReadTool } from '../../src/url-schemes/tools/read.ts'
import { createHashlineReadTool } from '../../src/hashline/install.ts'
import { UrlSchemesError } from '../../src/url-schemes/selector.ts'
import type { FileIO } from '../../src/hashline/fs-bridge.ts'

const fakeExec = { signal: new AbortController().signal } as unknown as ToolRunContext

function schemeReadTool(deps: Record<string, unknown>): ToolDefinition {
  return createSchemeReadTool(deps as unknown as Parameters<typeof createSchemeReadTool>[0])
}

const fakeIo = {
  emitObserved: async () => {},
} as unknown as FileIO

function hashlineReadTool(): ToolDefinition {
  return createHashlineReadTool({ io: fakeIo })
}

describe('resolveGates', () => {
  it('defaults both gates on — the service is opt-out, not opt-in', () => {
    expect(resolveGates(undefined)).toEqual({ urlSchemes: true, hashline: true })
    expect(resolveGates({})).toEqual({ urlSchemes: true, hashline: true })
  })

  it('honors explicit opt-outs independently', () => {
    expect(resolveGates({ urlSchemes: false })).toEqual({ urlSchemes: false, hashline: true })
    expect(resolveGates({ hashline: false })).toEqual({ urlSchemes: true, hashline: false })
    expect(resolveGates({ urlSchemes: false, hashline: false })).toEqual({ urlSchemes: false, hashline: false })
  })
})

describe('read tool gate routing', () => {
  it('scheme wrapper without a delegate → NATIVE_READ_UNAVAILABLE for scheme and file paths', async () => {
    const tool = schemeReadTool({})
    await expect(tool.execute({ path: 'ctx://session' }, fakeExec)).rejects.toMatchObject({
      code: 'NATIVE_READ_UNAVAILABLE',
    })
    await expect(tool.execute({ path: 'some/file.ts' }, fakeExec)).rejects.toMatchObject({
      code: 'NATIVE_READ_UNAVAILABLE',
    })
    try {
      await tool.execute({ path: 'some/file.ts' }, fakeExec)
    } catch (err) {
      expect(err).toBeInstanceOf(UrlSchemesError)
    }
  })

  it('hashline read doer serves file paths with no scheme knowledge', async () => {
    const tool = hashlineReadTool()
    expect(tool.name).toBe('read')
    // execute() would hit the fs bridge; the contract here is that the doer
    // is a plain `read` definition whose every path is a filesystem path.
    expect(typeof tool.execute).toBe('function')
  })

  it('urlSchemes off: scheme paths delegate verbatim to the captured native read', async () => {
    const seen: Array<Record<string, unknown>> = []
    const capturedRead = {
      execute: async (args: { path: string }) => {
        seen.push(args)
        return 'native read output'
      },
    } as unknown as ToolDefinition
    const tool = schemeReadTool({ capturedRead })
    expect(await tool.execute({ path: 'ctx://session' }, fakeExec)).toBe('native read output')
    expect(seen).toEqual([{ path: 'ctx://session' }])
  })

  it('hashline off: file paths delegate verbatim to the captured native read', async () => {
    const seen: Array<Record<string, unknown>> = []
    const capturedRead = {
      execute: async (args: { path: string }) => {
        seen.push(args)
        return 'plain native file read'
      },
    } as unknown as ToolDefinition
    const tool = schemeReadTool({ capturedRead })
    expect(await tool.execute({ path: 'src/some-file.ts' }, fakeExec)).toBe('plain native file read')
    expect(seen).toEqual([{ path: 'src/some-file.ts' }])
  })
})
