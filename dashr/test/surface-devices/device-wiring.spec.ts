/**
 * Device-wiring spec (task S10): the integration seams between the `dvc://`
 * device layer and the URL-aware tools.
 *
 * 1. Registration wiring — `registerAstDevices` + `registerBrowserDevice`
 *    (the calls `apply()` makes right after mounting the dvc handler) put
 *    ast_edit / ast_grep / browser on the roster a bare `dvc://` read serves.
 * 2. Write-tool dispatch — `write dvc://<device>` routes through
 *    `dispatchDvcWrite`: the structured routing/args errors bubble through
 *    the tool unchanged, and a device result is mapped onto the write
 *    outcome shape (`operation: 'execute'`).
 * 3. The empty-registry placeholder — a fresh module graph
 *    (`vi.resetModules()`) proves `write dvc://…` still surfaces
 *    `DVC_NO_DEVICE` for hosts that mount no devices.
 *
 * The devices' own execution chains are covered by ast-device.spec.ts,
 * browser-device.spec.ts, and lsp-device.spec.ts — not retested here.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

import { createDvcHandler, registerDvcDevice } from '../../src/url-schema/handlers/dvc.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'
import type { ResolverEnv } from '../../src/url-schema/resolver.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import { createWriteTool } from '../../src/url-schema/tools/write.ts'
import { registerAstDevices } from '../../src/url-schema/vendored/devices/ast/ast-device.ts'
import { registerBrowserDevice } from '../../src/url-schema/vendored/devices/browser/browser-device.ts'

/** Shared resolver env — the dvc handler reads no env fields. */
const env: ResolverEnv = {}

/** Minimal exec: the write tool's URL branch never touches it. */
function fakeExec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

/** Resolve a `dvc://` URL through a resolver with only the dvc scheme mounted. */
async function dvcRead(url: string): Promise<string> {
  const resolver = new UrlResolver()
  resolver.register('dvc', createDvcHandler())
  return await resolver.resolve(env, url)
}

/** Await a rejection and return its structured error. */
async function rejection(promise: Promise<unknown>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return error as UrlSchemaError
  }
  throw new Error('expected the write to reject')
}

describe('device wiring: the roster apply() builds', () => {
  it('bare dvc:// read lists ast_edit, ast_grep, and browser after registration', async () => {
    registerAstDevices()
    registerBrowserDevice()
    const roster = await dvcRead('dvc://')
    for (const name of ['ast_edit', 'ast_grep', 'browser']) {
      expect(roster).toMatch(new RegExp(`^${name}\\t.+`, 'm'))
    }
  })
})

describe('write tool → dispatchDvcWrite', () => {
  it('maps a device result onto the write outcome (operation execute)', async () => {
    registerDvcDevice('probe', {
      summary: 'wiring probe',
      async execute(): Promise<unknown> {
        return { ok: true, echoed: 7 }
      },
    })
    const write = createWriteTool({})
    await expect(
      write.execute({ file_path: 'dvc://probe', content: '{"a":[1,2]}' }, fakeExec()),
    ).resolves.toEqual({
      path: 'dvc://probe',
      operation: 'execute',
      before: '',
      after: JSON.stringify({ ok: true, echoed: 7 }, null, 2),
    })
  })

  it('bubbles DVC_BAD_ARGS for a non-JSON payload', async () => {
    registerAstDevices()
    const write = createWriteTool({})
    const error = await rejection(
      write.execute({ file_path: 'dvc://ast_grep', content: 'not json {' }, fakeExec()),
    )
    expect(error.code).toBe('DVC_BAD_ARGS')
    expect(error.message).toContain('ast_grep')
  })

  it('bubbles DVC_UNKNOWN_DEVICE for an unmounted name', async () => {
    registerAstDevices()
    registerBrowserDevice()
    const write = createWriteTool({})
    const error = await rejection(
      write.execute({ file_path: 'dvc://__none__', content: '{}' }, fakeExec()),
    )
    expect(error.code).toBe('DVC_UNKNOWN_DEVICE')
    expect(error.message).toContain('__none__')
    // The registry is populated, so the message names the registered devices.
    expect(error.message).toContain('ast_grep')
  })
})

describe('write tool with no devices mounted', () => {
  it('keeps the placeholder-wave DVC_NO_DEVICE error', async () => {
    vi.resetModules()
    // Fresh module graph: write.ts's static import of the dvc handler binds
    // to the fresh module-level registry, which is empty. UrlSchemaError is
    // also re-instantiated, so assert on the structured code, not instanceof.
    const { createWriteTool: freshWriteTool } = await import('../../src/url-schema/tools/write.ts')
    const write = freshWriteTool({})
    await expect(
      write.execute({ file_path: 'dvc://screen', content: 'x' }, fakeExec()),
    ).rejects.toMatchObject({ code: 'DVC_NO_DEVICE' })
  })
})
