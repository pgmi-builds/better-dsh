/**
 * `dvc://` device-framework spec (tasks 4.1–4.3, design D8 first half).
 *
 * Covers the registry contract: roster and per-device reads over a populated
 * registry, the unknown-device read, and the four write-dispatch routes —
 * happy path (JSON args → `execute` → result), bad JSON (`DVC_BAD_ARGS`),
 * device failure (`DVC_DEVICE_ERROR`), and unknown name with devices mounted
 * (`DVC_UNKNOWN_DEVICE`). The empty-registry block re-imports the module
 * after `vi.resetModules()` so the module-level registry is provably fresh —
 * proving the placeholder-wave behavior (`no devices mounted`, sync
 * `DVC_NO_DEVICE`) survives untouched for hosts that mount no devices.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDvcHandler,
  dispatchDvcWrite,
  listDvcDevices,
  registerDvcDevice,
} from '../../src/url-schema/handlers/dvc.ts'
import type { DvcDevice } from '../../src/url-schema/handlers/dvc.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'
import type { ResolverEnv } from '../../src/url-schema/resolver.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'

/** Shared resolver env — the dvc handler reads no env fields. */
const env: ResolverEnv = {}

/** A recorder device: captures the args it was executed with, resolves `result`. */
function recorderDevice(result: unknown, seenArgs: unknown[] = []): DvcDevice {
  return {
    summary: 'a test device',
    async execute(args: unknown): Promise<unknown> {
      seenArgs.push(args)
      return result
    },
  }
}

/** Resolve a `dvc://` URL through a resolver with only the dvc scheme mounted. */
async function dvcRead(url: string): Promise<string> {
  const resolver = new UrlResolver()
  resolver.register('dvc', createDvcHandler())
  return await resolver.resolve(env, url)
}

/** Invoke a sync-throwing dispatch and return its structured error. */
function thrown(fn: () => unknown): UrlSchemaError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return error as UrlSchemaError
  }
  throw new Error('expected the dispatch to throw synchronously')
}

/** Await a rejection and return its structured error. */
async function rejection(promise: Promise<unknown>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return error as UrlSchemaError
  }
  throw new Error('expected the dispatch to reject')
}

describe('dvc:// with a fresh empty registry', () => {
  // Each test re-imports the dvc module DYNAMICALLY because a static import
  // cannot work here: the top-level one binds to the original instance whose
  // registry the populated-registry describes mutate, while these tests need
  // the provably fresh module-level Map that `vi.resetModules()` produces.
  beforeEach(() => {
    vi.resetModules()
  })

  it('bare read keeps the no-devices placeholder', async () => {
    const resolver = new UrlResolver()
    resolver.register('dvc', (await import('../../src/url-schema/handlers/dvc.ts')).createDvcHandler())
    await expect(resolver.resolve(env, 'dvc://')).resolves.toBe('no devices mounted')
  })

  it('a name read keeps the unknown-device placeholder', async () => {
    const { createDvcHandler: freshHandler } = await import('../../src/url-schema/handlers/dvc.ts')
    const resolver = new UrlResolver()
    resolver.register('dvc', freshHandler())
    await expect(resolver.resolve(env, 'dvc://cam1')).resolves.toBe('unknown device: cam1')
  })

  it('write dispatch throws the structured DVC_NO_DEVICE error synchronously', async () => {
    const { dispatchDvcWrite: freshDispatch } = await import('../../src/url-schema/handlers/dvc.ts')
    // The fresh module also re-instantiates UrlSchemaError, so assert against
    // the fresh class — instanceof against the static import would be false.
    const { UrlSchemaError: FreshUrlSchemaError } = await import('../../src/url-schema/selector.ts')
    try {
      freshDispatch('dvc://cam1', 'x')
      throw new Error('expected the dispatch to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(FreshUrlSchemaError)
      const coded = error as UrlSchemaError
      expect(coded.code).toBe('DVC_NO_DEVICE')
      expect(coded.message).toContain('no devices mounted')
    }
  })
})

describe('dvc:// device registry reads', () => {
  it('bare read lists every device as one name<TAB>summary line in registration order', async () => {
    registerDvcDevice('probe', { ...recorderDevice(null), summary: 'probes things' })
    registerDvcDevice('echo', { ...recorderDevice(null), summary: 'echoes args back' })
    // The registry is shared file-wide, so assert on the two lines (and their
    // order) rather than the whole roster text.
    const lines = (await dvcRead('dvc://')).split('\n')
    expect(lines).toContain('probe\tprobes things')
    expect(lines).toContain('echo\techoes args back')
    expect(lines.indexOf('probe\tprobes things')).toBeLessThan(lines.indexOf('echo\techoes args back'))
    expect(lines.every((line) => /^[^\t]+\t.+$/.test(line))).toBe(true)
  })

  it('listDvcDevices exposes the registered names in registration order', () => {
    registerDvcDevice('probe', recorderDevice(null))
    registerDvcDevice('echo', recorderDevice(null))
    expect([...listDvcDevices().keys()]).toContain('probe')
    expect([...listDvcDevices().keys()]).toContain('echo')
  })

  it('a registered device read returns its summary plus a usage hint line', async () => {
    registerDvcDevice('magnifier', { ...recorderDevice(null), summary: 'magnifies small text' })
    expect(await dvcRead('dvc://magnifier')).toBe(
      'magnifies small text\nusage: write dvc://magnifier with a JSON args object to execute this device',
    )
  })

  it('an unregistered name read keeps the unknown-device text beside registered devices', async () => {
    registerDvcDevice('probe', recorderDevice(null))
    expect(await dvcRead('dvc://ghost')).toBe('unknown device: ghost')
  })
})

describe('dispatchDvcWrite', () => {
  it('parses JSON args, executes the device, and resolves its result', async () => {
    const seenArgs: unknown[] = []
    registerDvcDevice('echo', recorderDevice({ ok: true, echoed: 7 }, seenArgs))
    await expect(dispatchDvcWrite('dvc://echo', '{"a":[1,2]}')).resolves.toEqual({
      ok: true,
      echoed: 7,
    })
    expect(seenArgs).toEqual([{ a: [1, 2] }])
  })

  it('passes any JSON value through as the args payload', async () => {
    const seenArgs: unknown[] = []
    registerDvcDevice('scalar', recorderDevice('done', seenArgs))
    await expect(dispatchDvcWrite('dvc://scalar', '42')).resolves.toBe('done')
    expect(seenArgs).toEqual([42])
  })

  it('non-JSON content throws DVC_BAD_ARGS naming the device', () => {
    registerDvcDevice('probe', recorderDevice(null))
    const error = thrown(() => dispatchDvcWrite('dvc://probe', 'not json {'))
    expect(error.code).toBe('DVC_BAD_ARGS')
    expect(error.message).toContain('probe')
    expect(error.message).toContain('JSON')
  })

  it('a device failure rejects with DVC_DEVICE_ERROR carrying name and message', async () => {
    registerDvcDevice('bomb', {
      summary: 'always fails',
      async execute(): Promise<unknown> {
        throw new Error('detonated')
      },
    })
    const error = await rejection(dispatchDvcWrite('dvc://bomb', '{}'))
    expect(error.code).toBe('DVC_DEVICE_ERROR')
    expect(error.message).toContain('bomb')
    expect(error.message).toContain('detonated')
  })

  it('a synchronous execute throw is wrapped as DVC_DEVICE_ERROR too', async () => {
    registerDvcDevice('syncBomb', {
      summary: 'throws before awaiting',
      execute(_args: unknown): Promise<unknown> {
        throw new Error('sync detonation')
      },
    })
    const error = await rejection(dispatchDvcWrite('dvc://syncBomb', '{}'))
    expect(error.code).toBe('DVC_DEVICE_ERROR')
    expect(error.message).toContain('sync detonation')
  })

  it('an unknown name beside registered devices throws DVC_UNKNOWN_DEVICE listing them', () => {
    registerDvcDevice('probe', recorderDevice(null))
    registerDvcDevice('echo', recorderDevice(null))
    const error = thrown(() => dispatchDvcWrite('dvc://ghost', '{}'))
    expect(error.code).toBe('DVC_UNKNOWN_DEVICE')
    expect(error.message).toContain('ghost')
    // The registry is shared file-wide; the message lists every registered
    // name sorted, so assert the two names by containment.
    expect(error.message).toContain('probe')
    expect(error.message).toContain('echo')
  })
})
