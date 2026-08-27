/**
 * `ast_edit`/`ast_grep` dvc-device spec (task 5.2, design D8).
 *
 * Runs the real pi-natives addon over throwaway fixture files: loader
 * behavior (real dlopen, degradation without throw, variant ordering),
 * `ast_grep` structured search, `ast_edit` dry-run default vs apply, the
 * `ops`→`rewrites` last-op-wins conversion, glob/relative path resolution,
 * and the full `registerAstDevices` → `registerDvcDevice` registry →
 * `dispatchDvcWrite` chain — including the structured `DVC_DEVICE_ERROR`
 * that names the platform package when the addon is unavailable.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  loadPiNatives,
  piNativesAddonFilenames,
  piNativesPackageName,
  setPiNativesForTest,
} from '../../src/url-schema/vendored/devices/ast/natives-loader.ts'
import type {
  AstFindResult,
  AstReplaceResult,
} from '../../src/url-schema/vendored/devices/ast/natives-loader.ts'
import {
  registerAstDevices,
  summaries,
} from '../../src/url-schema/vendored/devices/ast/ast-device.ts'
import type { DvcRegistry } from '../../src/url-schema/vendored/devices/ast/ast-device.ts'
import {
  createDvcHandler,
  dispatchDvcWrite,
  listDvcDevices,
} from '../../src/url-schema/handlers/dvc.ts'
import type { DvcDevice } from '../../src/url-schema/handlers/dvc.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'
import type { ResolverEnv } from '../../src/url-schema/resolver.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'

/** The dvc handler reads no env fields. */
const env: ResolverEnv = {}

/** Stable fixture source: two named function declarations plus a call. */
const fixtureSource = `export function greet(name: string) {
  const msg = "Hello, " + name
  return msg
}

export function farewell(name: string) {
  return "Bye, " + name
}

greet("world")
`

/** Per-test scratch directory holding freshly written fixtures. */
let fixtureDir: string

/** The cwd-relative POSIX display path for an absolute fixture file. */
function displayPath(absolute: string): string {
  return path.relative(process.cwd(), absolute).split(path.sep).join('/')
}

/** Await a dispatch rejection and return its structured error. */
async function rejection(promise: Promise<unknown>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return error as UrlSchemaError
  }
  throw new Error('expected the dispatch to reject')
}

/** Resolve a `dvc://` URL through a resolver with only the dvc scheme mounted. */
async function dvcRead(url: string): Promise<string> {
  const resolver = new UrlResolver()
  resolver.register('dvc', createDvcHandler())
  return await resolver.resolve(env, url)
}

/** A Map-backed registry fake that also exposes the mounted devices. */
function fakeRegistry(): DvcRegistry & { devices: Map<string, DvcDevice> } {
  const devices = new Map<string, DvcDevice>()
  return {
    devices,
    registerDvcDevice: (name: string, device: DvcDevice) => {
      devices.set(name, device)
    },
  }
}

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(os.tmpdir(), 'dashr-ast-device-'))
})

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
  // A degradation test may have forced the unavailable state — restore the
  // lazy real load so later suites are unaffected.
  setPiNativesForTest(undefined)
})

describe('pi-natives loader', () => {
  it('loads the real platform addon from node_modules', () => {
    const natives = loadPiNatives()
    expect(natives).toBeDefined()
    expect(typeof natives?.astGrep).toBe('function')
    expect(typeof natives?.astEdit).toBe('function')
    expect(piNativesPackageName()).toBe(`@oh-my-pi/pi-natives-${process.platform}-${process.arch}`)
  })

  it('returns undefined (never throws) for an unsupported platform', () => {
    expect(loadPiNatives({ platform: 'freebsd', arch: 'x64' })).toBeUndefined()
    expect(piNativesPackageName('freebsd', 'x64')).toBeUndefined()
  })

  it('returns undefined when no platform package is resolvable from the anchor', () => {
    const anchor = mkdtempSync(path.join(os.tmpdir(), 'dashr-ast-noload-'))
    try {
      expect(loadPiNatives({ fromDir: anchor })).toBeUndefined()
    } finally {
      rmSync(anchor, { recursive: true, force: true })
    }
  })

  it('orders x64 addon variants modern-first and collapses other arches to one file', () => {
    expect(piNativesAddonFilenames('linux-x64', 'x64', true)).toEqual([
      'pi_natives.linux-x64-modern.node',
      'pi_natives.linux-x64-baseline.node',
      'pi_natives.linux-x64.node',
    ])
    expect(piNativesAddonFilenames('linux-x64', 'x64', false)[0]).toBe('pi_natives.linux-x64-baseline.node')
    expect(piNativesAddonFilenames('darwin-arm64', 'arm64')).toEqual(['pi_natives.darwin-arm64.node'])
  })
})

describe('ast device registration', () => {
  it('mounts ast_edit and ast_grep with roster summaries', () => {
    const registry = fakeRegistry()
    registerAstDevices(registry)
    expect([...registry.devices.keys()]).toEqual(['ast_edit', 'ast_grep'])
    expect(registry.devices.get('ast_edit')?.summary).toBe(summaries.ast_edit)
    expect(Object.keys(summaries).sort()).toEqual(['ast_edit', 'ast_grep'])
  })

  it('defaults to the real dvc registry (roster + per-device read)', async () => {
    registerAstDevices()
    expect([...listDvcDevices().keys()]).toContain('ast_grep')
    const rosterLines = (await dvcRead('dvc://')).split('\n')
    expect(rosterLines).toContain(`ast_edit\t${summaries.ast_edit}`)
    expect(rosterLines).toContain(`ast_grep\t${summaries.ast_grep}`)
    expect(await dvcRead('dvc://ast_grep')).toBe(
      `${summaries.ast_grep}\nusage: write dvc://ast_grep with a JSON args object to execute this device`,
    )
  })
})

describe('dvc://ast_grep (real addon)', () => {
  it('returns structured matches for a function-declaration pattern through dispatchDvcWrite', async () => {
    registerAstDevices()
    const file = path.join(fixtureDir, 'a.ts')
    writeFileSync(file, fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_grep',
      JSON.stringify({
        patterns: ['function $NAME($$$ARGS) { $$$BODY }'],
        path: file,
        includeMeta: true,
      }),
    )) as AstFindResult

    expect(result.totalMatches).toBe(2)
    expect(result.filesWithMatches).toBe(1)
    expect(result.matches.map((match) => match.metaVariables?.NAME)).toEqual(['greet', 'farewell'])
    expect(result.matches[0]?.path).toBe(displayPath(file))
    expect(result.matches[0]?.startLine).toBe(1)
    // The pattern matches the function-declaration node, so the matched text
    // carries the signature but not the `export` modifier.
    expect(result.matches[0]?.text).toContain('function greet(name: string)')
  })

  it('pages with offset/limit and searches a directory root', async () => {
    registerAstDevices()
    writeFileSync(path.join(fixtureDir, 'a.ts'), fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_grep',
      JSON.stringify({
        patterns: ['function $NAME($$$ARGS) { $$$BODY }'],
        path: fixtureDir,
        offset: 1,
        limit: 1,
        includeMeta: true,
      }),
    )) as AstFindResult
    expect(result.totalMatches).toBe(2)
    expect(result.matches).toHaveLength(1)
    // offset skipped the first declaration, so the paged match is farewell.
    expect(result.matches[0]?.metaVariables?.NAME).toBe('farewell')
    expect(result.matches[0]?.path).toBe(displayPath(path.join(fixtureDir, 'a.ts')))
  })
})

describe('dvc://ast_edit (real addon)', () => {
  it('previews without writing by default (dryRun defaults true)', async () => {
    registerAstDevices()
    const file = path.join(fixtureDir, 'a.ts')
    writeFileSync(file, fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_edit',
      JSON.stringify({ ops: [{ pat: 'greet', out: 'salute' }], paths: [file] }),
    )) as AstReplaceResult

    expect(result.applied).toBe(false)
    expect(result.totalReplacements).toBeGreaterThan(0)
    expect(result.fileChanges[0]?.path).toBe(displayPath(file))
    expect(readFileSync(file, 'utf8')).toBe(fixtureSource)
  })

  it('applies for real when dryRun is false', async () => {
    registerAstDevices()
    const file = path.join(fixtureDir, 'a.ts')
    writeFileSync(file, fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_edit',
      JSON.stringify({ ops: [{ pat: 'greet', out: 'salute' }], paths: [file], dryRun: false }),
    )) as AstReplaceResult

    expect(result.applied).toBe(true)
    const after = readFileSync(file, 'utf8')
    expect(after).toContain('function salute(name: string)')
    expect(after).toContain('salute("world")')
    expect(after).not.toContain('greet')
  })

  it('collapses duplicate patterns with the later op winning (Object.fromEntries semantics)', async () => {
    registerAstDevices()
    const file = path.join(fixtureDir, 'a.ts')
    writeFileSync(file, fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_edit',
      JSON.stringify({
        ops: [
          { pat: 'greet', out: 'alpha' },
          { pat: 'greet', out: 'beta' },
        ],
        paths: [file],
        dryRun: false,
      }),
    )) as AstReplaceResult

    expect(result.applied).toBe(true)
    const after = readFileSync(file, 'utf8')
    expect(after).toContain('function beta(name: string)')
    expect(after).not.toContain('alpha')
  })

  it('rewrites every file matched by a glob path', async () => {
    registerAstDevices()
    const first = path.join(fixtureDir, 'a.ts')
    const second = path.join(fixtureDir, 'b.ts')
    writeFileSync(first, fixtureSource)
    writeFileSync(second, fixtureSource)

    const result = (await dispatchDvcWrite(
      'dvc://ast_edit',
      JSON.stringify({ ops: [{ pat: 'farewell', out: 'adieu' }], paths: [`${fixtureDir}/*.ts`], dryRun: false }),
    )) as AstReplaceResult

    expect(result.filesTouched).toBe(2)
    expect(result.fileChanges.map((change) => path.basename(change.path)).sort()).toEqual(['a.ts', 'b.ts'])
    expect(readFileSync(first, 'utf8')).toContain('function adieu')
    expect(readFileSync(second, 'utf8')).toContain('function adieu')
  })

  it('resolves relative paths against ctx.cwd', async () => {
    const registry = fakeRegistry()
    registerAstDevices(registry)
    writeFileSync(path.join(fixtureDir, 'a.ts'), fixtureSource)

    const result = (await registry.devices.get('ast_edit')?.execute(
      { ops: [{ pat: 'greet', out: 'salute' }], paths: ['a.ts'] },
      { cwd: fixtureDir },
    )) as AstReplaceResult

    expect(result.applied).toBe(false)
    expect(result.totalReplacements).toBeGreaterThan(0)
    expect(result.fileChanges[0]?.path).toBe('a.ts')
  })
})

describe('ast device failure modes', () => {
  it('rejects with DVC_DEVICE_ERROR naming the platform package when the addon is unavailable', async () => {
    registerAstDevices()
    setPiNativesForTest(null)
    try {
      const error = await rejection(
        dispatchDvcWrite('dvc://ast_grep', JSON.stringify({ patterns: ['function $N($$$A) { $$$B }'] })),
      )
      expect(error.code).toBe('DVC_DEVICE_ERROR')
      expect(error.message).toContain('dvc:// device "ast_grep" execute failed')
      expect(error.message).toContain(`@oh-my-pi/pi-natives-${process.platform}-${process.arch}`)
    } finally {
      setPiNativesForTest(undefined)
    }
  })

  it.each([
    ['ast_edit', { paths: ['/nonexistent'] }, 'ops'],
    ['ast_edit', { ops: [{ pat: '', out: 'x' }], paths: ['/nonexistent'] }, 'ops[0].pat'],
    ['ast_grep', { path: '/nonexistent' }, 'patterns'],
    ['ast_grep', { patterns: ['x'], limit: -1 }, 'limit'],
  ])('rejects malformed %s args mentioning `%s`', async (device, args, field) => {
    registerAstDevices()
    const error = await rejection(dispatchDvcWrite(`dvc://${device}`, JSON.stringify(args)))
    expect(error.code).toBe('DVC_DEVICE_ERROR')
    expect(error.message).toContain(field)
  })
})
