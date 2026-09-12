/**
 * Gate semantics (task 1.2): `resolveGates` defaults/opt-outs, and the read
 * tool's branch routing under disabled gates — a gated-off branch hands the
 * request to the captured terminal delegate (or fails with the structured
 * `NATIVE_READ_UNAVAILABLE` when no delegate exists), never to a silent
 * reimplementation.
 */

import { describe, expect, it } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { resolveGates } from '../../src/url-schemes/index.ts'
import { createReadTool } from '../../src/url-schemes/tools/read.ts'
import { UrlSchemesError } from '../../src/url-schemes/selector.ts'

const fakeExec = { signal: new AbortController().signal } as unknown as ToolRunContext

function readTool(deps: Record<string, unknown>): ToolDefinition {
  return createReadTool(deps as unknown as Parameters<typeof createReadTool>[0])
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
  it('both gates off without a delegate → NATIVE_READ_UNAVAILABLE for scheme and file paths', async () => {
    const tool = readTool({ gates: { urlSchemes: false, hashline: false } })
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

  it('urlSchemes off: scheme paths delegate verbatim to the captured native read', async () => {
    const seen: Array<Record<string, unknown>> = []
    const capturedRead = {
      execute: async (args: { path: string }) => {
        seen.push(args)
        return 'native read output'
      },
    } as unknown as ToolDefinition
    const tool = readTool({ gates: { urlSchemes: false, hashline: true }, capturedRead })
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
    const tool = readTool({ gates: { urlSchemes: true, hashline: false }, capturedRead })
    expect(await tool.execute({ path: 'src/some-file.ts' }, fakeExec)).toBe('plain native file read')
    expect(seen).toEqual([{ path: 'src/some-file.ts' }])
  })
})
