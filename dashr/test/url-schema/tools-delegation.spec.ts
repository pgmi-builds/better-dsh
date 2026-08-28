import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import { captureNativeTools } from '../../src/url-schema/native-capture.ts'
import { buildLspWriteFeedback } from '../../src/url-schema/index.ts'
import { listDvcDevices, registerDvcDevice } from '../../src/url-schema/handlers/dvc.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'
import type { ResolverEnv, SchemeHandler } from '../../src/url-schema/resolver.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import { createGlobTool } from '../../src/url-schema/tools/glob.ts'
import { createGrepTool } from '../../src/url-schema/tools/grep.ts'
import { createWriteTool } from '../../src/url-schema/tools/write.ts'

/** One recorded delegated call: the exact args and exec the native tool saw. */
interface NativeCall {
  args: unknown
  exec: ToolRunContext
}

/** Args shape the fake native tools read. */
type NativeArgs = { path?: string; pattern?: string; [key: string]: unknown }

/** Minimal fake exec: identity + cancellation only, optionally with an agent. */
function fakeExec(agent?: Agent): ToolRunContext {
  return { signal: new AbortController().signal, agent } as unknown as ToolRunContext
}

/** Recording fake native tool: every `execute` call is captured verbatim. */
function fakeNative(impl?: (args: NativeArgs) => Promise<unknown>): {
  tool: ToolDefinition
  calls: NativeCall[]
} {
  const calls: NativeCall[] = []
  const tool = {
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      calls.push({ args, exec })
      return impl === undefined ? { ok: true } : await impl(args as NativeArgs)
    },
  } as unknown as ToolDefinition
  return { tool, calls }
}

/** Await a rejection and return its structured `UrlSchemaError` code. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(UrlSchemaError)
    return (error as UrlSchemaError).code
  }
  throw new Error('expected the call to reject')
}

/**
 * Test resolver: `skill` is path-backed (resolves `skill://<rest>` under
 * `/srv/skills`), `agent` is content-backed (fixed text). Handler-side paths
 * and envs are recorded for assertion.
 */
function testResolver(content = 'needle here\nplain line\nneedle again') {
  const seenPaths: string[] = []
  const seenEnvs: ResolverEnv[] = []
  const pathBacked: SchemeHandler = {
    resolve: async () => 'resolved skill text',
    resolvePath: async (env, path) => {
      seenEnvs.push(env)
      seenPaths.push(path)
      return path === '' ? undefined : join('/srv/skills', path)
    },
  }
  const contentBacked: SchemeHandler = {
    resolve: async (env) => {
      seenEnvs.push(env)
      return content
    },
  }
  const resolver = new UrlResolver()
  resolver.register('skill', pathBacked)
  resolver.register('agent', contentBacked)
  return { resolver, seenPaths, seenEnvs }
}

describe('write tool delegation', () => {
  it('forwards non-URL writes verbatim to the captured native definition', async () => {
    const { tool: nativeWrite, calls } = fakeNative()
    const write = createWriteTool({ nativeWrite })
    const args = { file_path: 'src/a.ts', content: 'new content' }
    const exec = fakeExec()

    const result = await write.execute(args, exec)

    expect(calls.length).toBe(1)
    expect(calls[0]!.args).toBe(args) // untouched, same object
    expect(calls[0]!.exec).toBe(exec) // untouched, same object
    expect(result).toEqual({ ok: true })
  })

  it('reports NATIVE_WRITE_UNAVAILABLE for non-URL writes without a native delegate', async () => {
    const write = createWriteTool({})
    expect(await rejectionCode(write.execute({ file_path: 'a.txt', content: 'x' }, fakeExec()))).toBe(
      'NATIVE_WRITE_UNAVAILABLE',
    )
  })

  it('rejects dvc:// writes with DVC_NO_DEVICE', async () => {
    const write = createWriteTool({ nativeWrite: fakeNative().tool })
    expect(
      await rejectionCode(write.execute({ file_path: 'dvc://screen', content: 'x' }, fakeExec())),
    ).toBe('DVC_NO_DEVICE')
  })

  it('rejects ctx:// writes with URL_READ_ONLY and the curated-snapshot reason', async () => {
    const write = createWriteTool({ nativeWrite: fakeNative().tool })
    try {
      await write.execute({ file_path: 'ctx://vars/cwd', content: 'x' }, fakeExec())
      throw new Error('expected the write to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(UrlSchemaError)
      const err = error as UrlSchemaError
      expect(err.code).toBe('URL_READ_ONLY')
      expect(err.message).toContain('curated read-only snapshot')
    }
  })

  it('rejects other registered schemes with URL_WRITE_UNSUPPORTED', async () => {
    const write = createWriteTool({ nativeWrite: fakeNative().tool })
    for (const scheme of ['skill', 'agent', 'dsh', 'http', 'https']) {
      expect(
        await rejectionCode(write.execute({ file_path: `${scheme}://x`, content: 'x' }, fakeExec())),
      ).toBe('URL_WRITE_UNSUPPORTED')
    }
  })

  it('rejects unregistered schemes with the generic URL_UNREGISTERED_SCHEME error', async () => {
    const write = createWriteTool({ nativeWrite: fakeNative().tool })
    try {
      await write.execute({ file_path: 'nosuch://thing', content: 'x' }, fakeExec())
      throw new Error('expected the write to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(UrlSchemaError)
      const err = error as UrlSchemaError
      expect(err.code).toBe('URL_UNREGISTERED_SCHEME')
      expect(err.message).toContain('no handler registered')
    }
  })
})

describe('grep tool delegation', () => {
  it('forwards non-URL searches verbatim to the captured native definition', async () => {
    const { resolver } = testResolver()
    const { tool: nativeGrep, calls } = fakeNative()
    const grep = createGrepTool({ resolver, nativeGrep })
    const args = { pattern: 'needle', path: 'src', include: '*.ts' }
    const exec = fakeExec()

    await grep.execute(args, exec)

    expect(calls.length).toBe(1)
    expect(calls[0]!.args).toBe(args)
    expect(calls[0]!.exec).toBe(exec)
  })

  it('reports NATIVE_GREP_UNAVAILABLE without a native delegate', async () => {
    const { resolver } = testResolver()
    const grep = createGrepTool({ resolver })
    expect(await rejectionCode(grep.execute({ pattern: 'x' }, fakeExec()))).toBe(
      'NATIVE_GREP_UNAVAILABLE',
    )
    expect(
      await rejectionCode(grep.execute({ pattern: 'x', path: 'skill://s' }, fakeExec())),
    ).toBe('NATIVE_GREP_UNAVAILABLE')
  })

  it('translates path-backed URLs to their real disk path, keeping the rest of args', async () => {
    const { resolver, seenPaths, seenEnvs } = testResolver()
    const agent = { id: 'agent-1', session: { header: {} } } as unknown as Agent
    const { tool: nativeGrep, calls } = fakeNative()
    const grep = createGrepTool({ resolver, nativeGrep })

    await grep.execute(
      { pattern: 'needle', path: 'skill://my-skill/docs', include: '*.md' },
      fakeExec(agent),
    )

    // The handler saw the selector-stripped URL path, and got the env's agent.
    expect(seenPaths).toEqual(['my-skill/docs'])
    expect((seenEnvs[0] as { agent?: Agent }).agent).toBe(agent)
    // The native call is rewritten only in `path`.
    expect(calls[0]!.args).toEqual({
      pattern: 'needle',
      path: join('/srv/skills', 'my-skill/docs'),
      include: '*.md',
    })
  })

  it('materializes content-backed URLs into a temp file that is cleaned up afterwards', async () => {
    const content = 'needle here\nplain line\nneedle again'
    const { resolver } = testResolver(content)
    let seenDir: string | undefined
    const { tool: nativeGrep, calls } = fakeNative(async (args) => {
      seenDir = dirname(args.path!)
      return await readFile(args.path!, 'utf8')
    })
    const grep = createGrepTool({ resolver, nativeGrep })

    const result = await grep.execute({ pattern: 'needle', path: 'agent://abc' }, fakeExec())

    expect(result).toBe(content) // the native call really searched the materialized text
    expect(calls[0]!.args).toMatchObject({ pattern: 'needle' })
    expect((calls[0]!.args as NativeArgs).path!.endsWith('content.txt')).toBe(true)
    expect(seenDir).toBeDefined()
    // The temp directory is removed once the native call settles.
    await expect(readdir(seenDir!)).rejects.toThrowError(/ENOENT/)
  })

  it('cleans up the temp directory even when the native call throws', async () => {
    const { resolver } = testResolver()
    let seenDir: string | undefined
    const { tool: nativeGrep } = fakeNative(async (args) => {
      seenDir = dirname(args.path!)
      throw new Error('ripgrep exploded')
    })
    const grep = createGrepTool({ resolver, nativeGrep })

    await expect(grep.execute({ pattern: 'x', path: 'agent://abc' }, fakeExec())).rejects.toThrowError(
      /ripgrep exploded/,
    )
    await expect(readdir(seenDir!)).rejects.toThrowError(/ENOENT/)
  })

  it('falls back to the generic resolver error for an unregistered scheme URL', async () => {
    const { resolver } = testResolver()
    const { tool: nativeGrep, calls } = fakeNative()
    const grep = createGrepTool({ resolver, nativeGrep })

    expect(await rejectionCode(grep.execute({ pattern: 'x', path: 'nosuch://y' }, fakeExec()))).toBe(
      'URL_UNREGISTERED_SCHEME',
    )
    expect(calls.length).toBe(0)
  })
})

describe('glob tool delegation', () => {
  it('forwards non-URL patterns verbatim to the captured native definition', async () => {
    const { resolver } = testResolver()
    const { tool: nativeGlob, calls } = fakeNative()
    const glob = createGlobTool({ resolver, nativeGlob })
    const args = { pattern: '**/*.ts' }
    const exec = fakeExec()

    await glob.execute(args, exec)

    expect(calls.length).toBe(1)
    expect(calls[0]!.args).toBe(args)
    expect(calls[0]!.exec).toBe(exec)
  })

  it('reports NATIVE_GLOB_UNAVAILABLE without a native delegate', async () => {
    const { resolver } = testResolver()
    const glob = createGlobTool({ resolver })
    expect(await rejectionCode(glob.execute({ pattern: '**/*.ts' }, fakeExec()))).toBe(
      'NATIVE_GLOB_UNAVAILABLE',
    )
  })

  it('roots a path-backed URL in `path` at its disk directory', async () => {
    const { resolver } = testResolver()
    const { tool: nativeGlob, calls } = fakeNative()
    const glob = createGlobTool({ resolver, nativeGlob })

    await glob.execute({ pattern: '**/*.md', path: 'skill://my-skill' }, fakeExec())

    expect(calls[0]!.args).toEqual({
      pattern: '**/*.md',
      path: join('/srv/skills', 'my-skill'),
    })
  })

  it('globs a path-backed URL in `pattern` over its disk directory', async () => {
    const { resolver } = testResolver()
    const { tool: nativeGlob, calls } = fakeNative()
    const glob = createGlobTool({ resolver, nativeGlob })

    await glob.execute({ pattern: 'skill://my-skill' }, fakeExec())

    expect(calls[0]!.args).toEqual({
      pattern: '**/*',
      path: join('/srv/skills', 'my-skill'),
    })
  })

  it('lists a content-backed URL in `pattern` from its resolved lines, no native call', async () => {
    const { resolver } = testResolver('entry-a\nentry-b\n\nentry-c')
    const { tool: nativeGlob, calls } = fakeNative()
    const glob = createGlobTool({ resolver, nativeGlob })

    const result = await glob.execute({ pattern: 'agent://abc' }, fakeExec())

    expect(result).toEqual({ root: 'agent://abc', paths: ['entry-a', 'entry-b', 'entry-c'] })
    expect(calls.length).toBe(0)
  })

  it('materializes a content-backed URL search root into a cleaned-up temp directory', async () => {
    const content = 'only line'
    const { resolver } = testResolver(content)
    let seenDir: string | undefined
    const { tool: nativeGlob, calls } = fakeNative(async (args) => {
      seenDir = args.path
      const entries = await readdir(args.path!)
      return { root: args.path, paths: entries }
    })
    const glob = createGlobTool({ resolver, nativeGlob })

    const result = await glob.execute({ pattern: '*.txt', path: 'agent://abc' }, fakeExec())

    expect((result as { paths: string[] }).paths).toEqual(['content.txt'])
    expect((calls[0]!.args as NativeArgs).pattern).toBe('*.txt')
    expect(seenDir).toBeDefined()
    await expect(readdir(seenDir!)).rejects.toThrowError(/ENOENT/)
  })
})

describe('captureNativeTools', () => {
  /** Fake `ctx.tools` surface: records lookups, serves a name→def map per scope. */
  function fakeToolsCtx(defs: Record<string, ToolDefinition | undefined>) {
    const lookups: Array<{ name: string; scope: unknown }> = []
    const ctx = {
      tools: {
        schemas: () => Object.keys(defs).map(name => ({ name })),
        get(name: string, scope?: unknown) {
          lookups.push({ name, scope })
          return defs[name]
        },
      },
    } as unknown as Context
    return { ctx, lookups }
  }

  it('captures each deployed native tool as the agent scope sees it', () => {
    const writeDef = fakeNative().tool
    const grepDef = fakeNative().tool
    const { ctx, lookups } = fakeToolsCtx({ write: writeDef, grep: grepDef })
    const agent = { id: 'a1' } as unknown as Agent

    const set = captureNativeTools(ctx, agent)

    expect(set.write).toBe(writeDef)
    expect(set.grep).toBe(grepDef)
    expect(set.glob).toBeUndefined() // host did not deploy native glob
    // The full-snapshot capture resolves every VISIBLE name once (write and
    // grep here; glob was never deployed so it is not enumerated).
    expect(lookups.length).toBe(2)
    for (const { scope } of lookups) expect(scope).toBe(agent)
  })

  it('caches the capture per agent across repeated session starts', () => {
    const writeDef = fakeNative().tool
    const { ctx, lookups } = fakeToolsCtx({ write: writeDef })
    const agent = { id: 'a1' } as unknown as Agent

    const first = captureNativeTools(ctx, agent)
    const second = captureNativeTools(ctx, agent)

    expect(second).toBe(first)
    expect(lookups.length).toBe(1) // one pass over the single visible name, not two

    // A different agent captures independently.
    const other = { id: 'a2' } as unknown as Agent
    const otherSet = captureNativeTools(ctx, other)
    expect(otherSet).not.toBe(first)
    expect(lookups.length).toBe(2)
  })

  it('degrades to an all-undefined set when no native tool is deployed', () => {
    const { ctx } = fakeToolsCtx({})
    const agent = { id: 'a1' } as unknown as Agent
    expect(captureNativeTools(ctx, agent)).toEqual({})
  })
})

describe('write tool — lsp feedback loop (native-tools Wave3)', () => {
  it('attaches the post-write diagnostics summary to the result', async () => {
    const { tool: nativeWrite, calls } = fakeNative()
    const write = createWriteTool({
      nativeWrite,
      postWrite: async () => '1 error(s) — first: TS2345: bad type',
    })
    const result = await write.execute({ file_path: 'src/a.ts', content: 'const x: number = "s"' }, fakeExec())
    expect(calls).toHaveLength(1)
    expect(result).toEqual({ ok: true, diagnostics: '1 error(s) — first: TS2345: bad type' })
  })

  it('omits the diagnostics field when the hook answers undefined (serverless language)', async () => {
    const { tool: nativeWrite } = fakeNative()
    const write = createWriteTool({ nativeWrite, postWrite: async () => undefined })
    const result = await write.execute({ file_path: 'notes.txt', content: 'plain' }, fakeExec())
    expect(result).toEqual({ ok: true })
  })

  it('survives a throwing post-write hook — the write has already landed', async () => {
    const { tool: nativeWrite } = fakeNative()
    const write = createWriteTool({
      nativeWrite,
      postWrite: async () => { throw new Error('server exploded') },
    })
    const result = await write.execute({ file_path: 'a.ts', content: 'x' }, fakeExec())
    expect(result).toEqual({ ok: true })
  })

  it('formats the content before the single native write, and keeps identity when formatting changes nothing', async () => {
    const { tool: nativeWrite, calls } = fakeNative(async args => ({ ok: true, path: args.file_path }))
    const write = createWriteTool({
      nativeWrite,
      preWriteFormat: async (_path, content) => (content.includes('let ') ? content.replace(/let /g, 'const ') : undefined),
    })
    // formatted: the native write receives the REPLACED content
    await write.execute({ file_path: 'a.ts', content: 'let a = 1' }, fakeExec())
    expect((calls[0]!.args as { content: string }).content).toBe('const a = 1')
    // unchanged: the native write receives the SAME arguments object
    const args = { file_path: 'b.ts', content: 'const b = 2' }
    await write.execute(args, fakeExec())
    expect(calls[1]!.args).toBe(args)
  })

  it('routes both hooks through the mounted lsp device with the exact content (integration)', async () => {
    const seen: Array<{ action: string, file: string, content: string }> = []
    const originalLsp = listDvcDevices().get('lsp')
    registerDvcDevice('lsp', {
      summary: 'fake lsp',
      async execute(args: unknown) {
        const record = args as { action: string, file: string, content: string }
        seen.push({ action: record.action, file: record.file, content: record.content })
        if (record.action === 'format') {
          return { ok: true, server: 'fake', file: record.file, formatted: record.content.trimEnd() + '\n', changed: record.content !== record.content.trimEnd() + '\n' }
        }
        return {
          ok: true,
          server: 'fake',
          file: record.file,
          diagnostics: [{ severityName: 'error', message: 'boom: bad import' }],
          summary: '1 error(s)',
        }
      },
    })
    const { preWriteFormat, postWrite } = buildLspWriteFeedback()
    const { tool: nativeWrite, calls } = fakeNative()
    const write = createWriteTool({ nativeWrite, preWriteFormat, postWrite })
    const result = await write.execute({ file_path: 'src/x.ts', content: 'import x from "x"  ' }, fakeExec())
    // format saw the raw content; diagnostics saw the FORMATTED content
    expect(seen.map(entry => entry.action)).toEqual(['format', 'diagnostics'])
    expect(seen[0]!.content).toBe('import x from "x"  ')
    expect(seen[1]!.content).toBe('import x from "x"\n')
    expect((calls[0]!.args as { content: string }).content).toBe('import x from "x"\n')
    expect((result as { diagnostics?: string }).diagnostics).toBe('1 error(s) — first: boom: bad import')
    // restore the module registry: other tests must not see this fake
    registerDvcDevice('lsp', originalLsp ?? (undefined as never))
  })

  it('renders the diagnostics summary into the result text (F4: wire face sees the feedback)', async () => {
    const { tool: nativeWrite } = fakeNative()
    const write = createWriteTool({ nativeWrite, postWrite: async () => '1 error(s) — first: E0308: mismatched types' })
    const render = (write as unknown as { output: { render: (args: unknown, value: unknown) => Array<{ type: string, text: string }> } }).output.render
    const withDiagnostics = render({}, { path: 'src/a.rs', operation: 'update', before: 'old', after: 'new', diagnostics: '1 error(s) — first: E0308: mismatched types' })
    expect(withDiagnostics[0]!.text).toBe('Updated src/a.rs\n1 error(s) — first: E0308: mismatched types')
    const withoutDiagnostics = render({}, { path: 'src/b.rs', operation: 'create', before: null, after: 'new' })
    expect(withoutDiagnostics[0]!.text).toBe('Created src/b.rs')
  })

  it('reads as no feedback when no lsp device is mounted', async () => {
    const { preWriteFormat, postWrite } = buildLspWriteFeedback()
    expect(await preWriteFormat('a.ts', 'x')).toBeUndefined()
    expect(await postWrite('a.ts', 'x')).toBeUndefined()
  })
})
