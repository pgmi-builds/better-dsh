/**
 * `dvc://lsp` device spec (task 5.5, design D8) — vendored stdio LSP client.
 *
 * Three layers of proof:
 * 1. Registry: `installLspDevices` mounts one `lsp` device; the vendored
 *    defaults.json registry ships complete (54 entries, spot-checked).
 * 2. JSON-RPC loop against a fake stdio server (`fixtures/fake-lsp-server.mjs`
 *    run by `node`): the full initialize → initialized → didOpen lifecycle
 *    including a colliding-id server request (upstream #3001 routing), all
 *    four actions with the device's 1-based → 0-based position conversion,
 *    client reuse (one initialize across consecutive executes), the idle
 *    reaper (server receives shutdown/exit, next execute respawns), and
 *    `dispatchDvcWrite` end-to-end including the `DVC_DEVICE_ERROR` wrap.
 * 3. Real server: rust-analyzer (the one installed language server on this
 *    machine, functional-probed and skipped when absent) runs definition +
 *    hover over a real fixture; a missing binary (probe-gated natural `.ts`
 *    path + a forced unknown command) degrades to the structured
 *    `LSP_SERVER_MISSING` with an install hint instead of crashing.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { dispatchDvcWrite, listDvcDevices } from '../../src/url-schema/handlers/dvc.ts'
import type { DvcDevice } from '../../src/url-schema/handlers/dvc.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import {
  installLspDevices,
  setLspDeviceIdleTimeout,
  shutdownLspDevice,
} from '../../src/url-schema/vendored/devices/lsp/lsp-device.ts'
import { registryNames, resolveCommandPath } from '../../src/url-schema/vendored/devices/lsp/lsp-server-registry.ts'

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const FAKE_SERVER = path.join(FIXTURES_DIR, 'fake-lsp-server.mjs')

/** Mount the device on a local recorder so this file stays self-contained. */
function mountLocally(): DvcDevice {
  const mounted: [string, DvcDevice][] = []
  installLspDevices((name, device) => mounted.push([name, device]))
  const entry = mounted.find(([name]) => name === 'lsp')
  if (entry === undefined) throw new Error('installLspDevices did not mount an "lsp" device')
  return entry[1]
}

const device = mountLocally()

/** Await a rejection and return its structured error. */
async function rejection(promise: Promise<unknown>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof UrlSchemaError) return error
    throw new Error(`expected UrlSchemaError, got: ${String(error)}`)
  }
  throw new Error('expected the promise to reject')
}

// =============================================================================
// Fake-server fixture workspace
// =============================================================================

const workDir = mkdtempSync(path.join(tmpdir(), 'dashr-lsp-device-'))
const fakeLog = path.join(workDir, 'fake-lsp.log')
const fakeMain = path.join(workDir, 'src', 'main.fake')

/** Args that point the device at the fake stdio server for any file. */
const fakeServerArgs = { command: process.execPath, args: [FAKE_SERVER] }

const fakeLogLines = (): string[] =>
  readFileSync(fakeLog, 'utf-8')
    .split('\n')
    .filter(line => line !== '')

const logEventCount = (event: string): number => fakeLogLines().filter(line => line === event || line.startsWith(`${event}:`)).length

/** Poll until `predicate(logLines)` holds or `timeoutMs` elapses (returns last lines). */
async function waitForLog(predicate: (lines: string[]) => boolean, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  const { promise, resolve } = Promise.withResolvers<void>()
  const tick = (): void => {
    if (predicate(fakeLogLines()) || Date.now() > deadline) resolve()
    else setTimeout(tick, 50)
  }
  setTimeout(tick, 50)
  await promise
  return fakeLogLines()
}

beforeAll(() => {
  writeFileSync(fakeLog, '')
  mkdirSync(path.join(workDir, 'src'), { recursive: true })
  mkdirSync(path.join(workDir, 'rsproj'), { recursive: true })

  writeFileSync(path.join(workDir, 'src', 'main.fake'), 'let foo = bar\nlet unused = 1\n')
  writeFileSync(path.join(workDir, 'src', 'other.fake'), 'let bar = 1\n')
})

// The fake server appends lifecycle events to $FAKE_LSP_LOG; the device
// spawns servers with the parent env, so export it before any execute.
process.env.FAKE_LSP_LOG = fakeLog

afterAll(async () => {
  setLspDeviceIdleTimeout(null)
  await shutdownLspDevice()
  rmSync(workDir, { recursive: true, force: true })
})

// =============================================================================
// Registry + defaults.json completeness
// =============================================================================

describe('dvc://lsp registration and vendored registry', () => {
  it('installLspDevices mounts one lsp device (real registry) with a roster summary', () => {
    installLspDevices()
    const mounted = listDvcDevices().get('lsp')
    expect(mounted).toBeDefined()
    expect(mounted?.summary).toContain('LSP')
    expect(mounted?.summary).not.toContain('\t')
  })

  it('ships the complete upstream defaults.json registry', () => {
    const names = registryNames()
    expect(names.length).toBe(54)
    for (const expected of [
      'rust-analyzer',
      'typescript-language-server',
      'pyright',
      'pylsp',
      'gopls',
      'clangd',
      'biome',
      'sourcekit-lsp',
    ]) {
      expect(names).toContain(expected)
    }
  })
})

// JSON-RPC loop against the fake stdio server
// =============================================================================

describe('dvc://lsp format action (F3: documentFormattingProvider is the LSP spec key)', () => {
  it('formats through the spec capability key and syncs the exact content', async () => {
    const messy = 'pub fn   probe( x:i32 )->i32 {\n    x +  1\n}\n'
    const result = (await device.execute({
      action: 'format',
      file: fakeMain,
      content: messy,
      ...fakeServerArgs,
    })) as { ok: boolean, formatted: string, changed: boolean }

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.formatted).toBe('pub fn probe( x:i32 )->i32 {\n x + 1\n}\n')
  })

  it('answers changed:false when the content is already formatted', async () => {
    const clean = 'pub fn probe() {}\n'
    const result = (await device.execute({
      action: 'format',
      file: fakeMain,
      content: clean,
      ...fakeServerArgs,
    })) as { ok: boolean, formatted: string, changed: boolean }
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
    expect(result.formatted).toBe(clean)
  })

  it('reports the post-write diagnostics of the EXACT synced content (syncFileContent path)', async () => {
    // The fake server publishes its fixed error+warning pair on didOpen; the
    // content override must reach it (openTexts) and the summary must come
    // back for that content — the wire the write-feedback hook rides.
    const result = (await device.execute({
      action: 'diagnostics',
      file: fakeMain,
      content: 'fn synced_exact() {}\n',
      ...fakeServerArgs,
    })) as { ok: boolean, summary: string }
    expect(result.ok).toBe(true)
    expect(result.summary).toBe('1 error(s), 1 warning(s)')
  })
})


describe('dvc://lsp against the fake stdio server', () => {
  it(
    'runs diagnostics: initialize handshake, didOpen, published diagnostics',
    async () => {
      const result = (await device.execute({
        action: 'diagnostics',
        file: fakeMain,
        ...fakeServerArgs,
      })) as {
        ok: boolean
        server: string
        root: string
        diagnostics: Array<{ severityName: string; line: number; message: string }>
        summary: string
      }

      expect(result.ok).toBe(true)
      expect(result.server).toBe(process.execPath)
      // No root markers for the fake config → root is the file's directory.
      expect(result.root).toBe(path.dirname(fakeMain))
      expect(result.diagnostics.length).toBe(2)
      expect(result.diagnostics[0]).toMatchObject({
        severityName: 'error',
        line: 1,
        message: expect.stringContaining('foo'),
      })
      expect(result.diagnostics[1]).toMatchObject({ severityName: 'warning', line: 2 })
      expect(result.summary).toBe('1 error(s), 1 warning(s)')

      // The fake log proves the omp handshake order (initialize → initialized);
      // init completing at all shows the colliding-id server request was
      // answered without derailing the loop.
      const lines = fakeLogLines()
      expect(lines.some(line => line.startsWith('init:'))).toBe(true)
      expect(lines).toContain('initialized')
    },
    20_000,
  )

  it(
    'converts 1-based line/character to wire positions (definition + references)',
    async () => {
      const definition = (await device.execute({
        action: 'definition',
        file: fakeMain,
        line: 5,
        character: 10,
        ...fakeServerArgs,
      })) as { ok: boolean; locations: Array<{ line: number; character: number; endCharacter: number; path: string }> }

      // The fake echoes the 0-based wire position {4, 9}; the device reports
      // it back as 1-based {5, 10}.
      expect(definition.locations.length).toBe(1)
      expect(definition.locations[0]).toMatchObject({ line: 5, character: 10, endCharacter: 16 })
      expect(definition.locations[0]?.path).toBe(fakeMain)

      const references = (await device.execute({
        action: 'references',
        file: fakeMain,
        line: 5,
        character: 10,
        ...fakeServerArgs,
      })) as { ok: boolean; locations: Array<{ path: string; line: number }> }
      expect(references.locations.length).toBe(2)
      expect(references.locations[0]).toMatchObject({ path: fakeMain, line: 5 })
      expect(references.locations[1]?.path).toBe(path.join(path.dirname(fakeMain), 'other.fake'))
    },
    20_000,
  )

  it(
    'extracts hover text (markdown contents) at the requested position',
    async () => {
      const hover = (await device.execute({
        action: 'hover',
        file: fakeMain,
        line: 2,
        character: 5,
        ...fakeServerArgs,
      })) as { ok: boolean; text: string }
      expect(hover.ok).toBe(true)
      expect(hover.text).toContain('fn fake_hover() -> Answer')
    },
    20_000,
  )

  it(
    'reuses one server across consecutive executes (single initialize)',
    async () => {
      // Start from zero live clients so the init accounting is exact.
      await shutdownLspDevice()
      const before = logEventCount('init')
      await device.execute({ action: 'hover', file: fakeMain, line: 1, character: 1, ...fakeServerArgs })
      await device.execute({ action: 'hover', file: fakeMain, line: 1, character: 1, ...fakeServerArgs })
      expect(logEventCount('init')).toBe(before + 1)
    },
    20_000,
  )

  it(
    'reaps the idle server (shutdown/exit) and respawns on the next execute',
    async () => {
      await shutdownLspDevice()
      try {
        setLspDeviceIdleTimeout(150)
        const initsBefore = logEventCount('init')
        const shutdownsBefore = logEventCount('shutdown')
        const exitsBefore = logEventCount('exit')

        await device.execute({ action: 'hover', file: fakeMain, line: 1, character: 1, ...fakeServerArgs })

        // Idle timer fires → device sends shutdown, server exits.
        const lines = await waitForLog(
          current =>
            current.filter(l => l === 'shutdown').length > shutdownsBefore &&
            current.filter(l => l === 'exit').length > exitsBefore,
          3_000,
        )
        expect(lines.filter(l => l === 'shutdown').length).toBeGreaterThan(shutdownsBefore)
        expect(lines.filter(l => l === 'exit').length).toBeGreaterThan(exitsBefore)

        // Next execute spawns a fresh server (two initializes this test).
        await device.execute({ action: 'hover', file: fakeMain, line: 1, character: 1, ...fakeServerArgs })
        expect(logEventCount('init')).toBe(initsBefore + 2)
      } finally {
        // Never leak the 150ms window into later tests.
        setLspDeviceIdleTimeout(null)
      }
    },
    20_000,
  )

  it('rejects bad args with structured LSP_BAD_ARGS', async () => {
    const noAction = await rejection(device.execute({ file: fakeMain, ...fakeServerArgs }))
    expect(noAction.code).toBe('LSP_BAD_ARGS')
    expect(noAction.message).toContain('unknown action')
    const badPosition = await rejection(
      device.execute({ action: 'hover', file: fakeMain, line: 0, ...fakeServerArgs }),
    )
    expect(badPosition.code).toBe('LSP_BAD_ARGS')
    expect(badPosition.message).toContain('"line"')

    const missingFile = await rejection(
      device.execute({ action: 'diagnostics', file: path.join(workDir, 'nope.fake') }),
    )
    expect(missingFile.code).toBe('LSP_BAD_ARGS')
    expect(missingFile.message).toContain('file not found')
  })

  it('degrades to LSP_SERVER_MISSING with an install hint for an absent binary', async () => {
    const error = await rejection(
      device.execute({
        action: 'diagnostics',
        file: fakeMain,
        command: 'definitely-not-a-real-lsp-server-xyz',
        args: ['--stdio'],
      }),
    )
    expect(error.code).toBe('LSP_SERVER_MISSING')
    expect(error.message).toContain('definitely-not-a-real-lsp-server-xyz')
    expect(error.message).toContain('install')
  })

  it('reports LSP_NO_SERVER for an uncovered file type without a command override', async () => {
    const weird = path.join(workDir, 'x.weirdext')
    writeFileSync(weird, 'nonsense')
    const error = await rejection(device.execute({ action: 'diagnostics', file: weird }))
    expect(error.code).toBe('LSP_NO_SERVER')
    expect(error.message).toContain('x.weirdext')
  })

  it('drives one action through dispatchDvcWrite end to end (DVC_DEVICE_ERROR wrap)', async () => {
    const ran = await dispatchDvcWrite(
      'dvc://lsp',
      JSON.stringify({ action: 'hover', file: fakeMain, line: 1, character: 1, ...fakeServerArgs }),
    )
    expect(ran).toMatchObject({ ok: true, text: expect.stringContaining('fake_hover') })

    const error = await rejection(
      dispatchDvcWrite('dvc://lsp', JSON.stringify({ action: 'diagnostics', file: fakeMain, command: 'no-such-binary' })),
    )
    expect(error.code).toBe('DVC_DEVICE_ERROR')
    expect(error.message).toContain('no-such-binary')
    expect(error.message).toContain('not found')
  })
})

// =============================================================================
// Real language server (rust-analyzer) — installed on this machine
// =============================================================================

const rustAnalyzerAvailable = (): boolean => resolveCommandPath('rust-analyzer', workDir) !== null

describe('dvc://lsp against the real rust-analyzer', { timeout: 120_000 }, () => {
  // Proper cargo layout (Cargo.toml + src/main.rs): rust-analyzer needs a
  // loadable crate — on a detached .rs file it answers definition/hover with
  // empty results.
  const rsDir = path.join(workDir, 'rsproj')
  const mainRs = path.join(rsDir, 'src', 'main.rs')

  beforeAll(() => {
    mkdirSync(path.join(rsDir, 'src'), { recursive: true })
    writeFileSync(
      path.join(rsDir, 'Cargo.toml'),
      ['[package]', 'name = "dashr-lsp-fixture"', 'version = "0.0.0"', 'edition = "2021"', ''].join('\n'),
    )
    writeFileSync(
      mainRs,
      ['fn helper() -> u32 {', '    42', '}', '', 'fn main() {', '    let answer = helper();', '    println!("{answer}");', '}', ''].join(
        '\n',
      ),
    )
  })

  it.skipIf(!rustAnalyzerAvailable())(
    'definition jumps to a project-local symbol (root-marker workspace + 1-based round trip)',
    async () => {
      const result = (await dispatchDvcWrite(
        'dvc://lsp',
        JSON.stringify({ action: 'definition', file: mainRs, line: 6, character: 18 }),
      )) as { ok: boolean; server: string; root: string; locations: Array<{ path: string; line: number }> }

      expect(result.ok).toBe(true)
      expect(result.server).toBe('rust-analyzer')
      // Cargo.toml root marker discovered one level above src/main.rs.
      expect(result.root).toBe(rsDir)
      // `helper` call site is 1-based (6, 18); its definition is line 1.
      expect(result.locations.length).toBeGreaterThanOrEqual(1)
      expect(result.locations[0]?.path).toBe(mainRs)
      expect(result.locations[0]?.line).toBe(1)
    },
  )

  it.skipIf(!rustAnalyzerAvailable())(
    'hover returns a signature for the symbol under the cursor',
    async () => {
      // `helper` call site again — stable std-independent hover target.
      const result = (await dispatchDvcWrite(
        'dvc://lsp',
        JSON.stringify({ action: 'hover', file: mainRs, line: 6, character: 18 }),
      )) as { ok: boolean; text: string }

      expect(result.ok).toBe(true)
      expect(result.text).toContain('fn helper() -> u32')
    },
  )

  it.skipIf(!rustAnalyzerAvailable())(
    'diagnostics round-trips the published (empty) report',
    async () => {
      const result = (await dispatchDvcWrite(
        'dvc://lsp',
        JSON.stringify({ action: 'diagnostics', file: mainRs }),
      )) as { ok: boolean; diagnostics: unknown[]; summary: string }

      expect(result.ok).toBe(true)
      expect(Array.isArray(result.diagnostics)).toBe(true)
      expect(result.summary).toBe('no diagnostics')
    },
  )

  it.skipIf(resolveCommandPath('typescript-language-server', workDir) !== null)(
    'natural .ts path degrades when typescript-language-server is absent',
    async () => {
      const tsFile = path.join(workDir, 'plain.ts')
      writeFileSync(tsFile, 'const x: number = "nope"\n')
      const error = await rejection(device.execute({ action: 'diagnostics', file: tsFile }))
      expect(error.code).toBe('LSP_SERVER_MISSING')
      expect(error.message).toContain('typescript-language-server')
      expect(error.message).toContain('npm install -g typescript-language-server')
    },
  )
})
