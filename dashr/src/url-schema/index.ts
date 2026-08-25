/**
 * `dsh-url-schema`: DASHR's URL-aware I/O backend.
 *
 * Owns the URL resolver + URL-aware read/write/grep/glob tools + the vendored
 * hashline + the five scheme handlers (`skill://`, `agent://`, `dsh://`,
 * `ctx://`, `xd://`). Mounted by `dashr-repl` (`src/index.ts`) via
 * `ctx.plugin()` — one plugin, one row, following the same mount pattern as
 * `DashrRuntime`.
 *
 * The four tools are registered on the AGENT's own scope layer (via
 * `agent/session-start` + `agent.ctx.effect`), so they shadow the preset's
 * built-in `read`/`write`/`grep`/`glob` for that agent (nearest layer wins in
 * dsh's tool registry) and unwind automatically when the agent is disposed —
 * the same pattern as `dsh-better-edit`. Host-plane services (`fs`, `skills`,
 * `sessions`, `settings`, `subagents`) are read from the plugin's own context,
 * never the agent's scoped one (whose fiber chain does not declare them).
 */

import { promises as fsp, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
// Type-only: each empty import brings the service's `ctx.<name>` Context merge
// (and event typing) into this program — the same idiom as `dashr-repl`.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'

import type { ReplRuntimeSurface } from '../runtime-surface.ts'
import { createAgentHandler } from './handlers/agent.ts'
import { createCtxHandler } from './handlers/ctx.ts'
import { createDshHandler } from './handlers/dsh.ts'
import { createSkillHandler } from './handlers/skill.ts'
import { createXdHandler } from './handlers/xd.ts'
import { UrlResolver } from './resolver.ts'
import { createGlobTool } from './tools/glob.ts'
import type { GlobResult } from './tools/glob.ts'
import { createGrepTool } from './tools/grep.ts'
import type { GrepMatch, GrepResult } from './tools/grep.ts'
import { createReadTool } from './tools/read.ts'
import { createWriteTool } from './tools/write.ts'
import type { WriteOutcome } from './tools/write.ts'
import { execCwd } from './vendored/hashline/session-view.js'

/** Cordis plugin name. */
export const name = 'dsh-url-schema'

/**
 * Required host-plane services. `replRuntime` is deliberately NOT listed: it
 * is mode-dependent (mounted by `DashrRuntime` before this plugin), so the
 * `ctx://` handler is registered inside a `ctx.inject(['replRuntime'], …)`
 * callback below — exactly as `dashr-repl` reads it at use time.
 */
export const inject = ['tools', 'fs', 'skills', 'subagents', 'sessions', 'settings']

/** Plugin config — no options yet. */
export type Config = unknown

/** Translate a `*`/`**`/`?` glob into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  let out = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i + 1] === '*') i++
        out += '.*'
      } else {
        out += '[^/]*'
      }
    } else if (char === '?') {
      out += '[^/]'
    } else if ('\\^$+?.()|[]{}'.includes(char)) {
      out += '\\' + char
    } else {
      out += char
    }
  }
  return new RegExp(out + '$')
}

/** Normalize a path to `/`-separated segments for glob matching. */
function slashPath(path: string): string {
  return path.split(sep).join('/')
}

/**
 * Resolve the harness `docs/` directory by walking up from this module. The
 * fixed-depth `dirname×N(import.meta.url)` anchor in the `dsh://` handler is
 * wrong under tsdown bundling (where `import.meta.url` is `lib/index.js`); a
 * search survives both the dev layout (`src/url-schema/index.ts`) and the
 * bundled one (`lib/index.js`).
 */
function resolveDocsDir(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'docs')
    try {
      if (statSync(candidate).isDirectory()) return candidate
    } catch {
      // no `docs/` here — walk up one level
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Fallback native grep: recurse the filesystem from `input.path` (or the
 * session cwd) and run the JS `RegExp` over each text file, skipping files
 * that fail the optional `include` glob.
 *
 * Tradeoff (documented): the preset's native grep runs ripgrep `--json`, which
 * honors ignore files, skips hidden/VCS directories, rejects binary files, and
 * streams. This fallback is a plain `readdir` + `RegExp` scan: it does NOT
 * honor ignore files, DOES descend into hidden/VCS directories, reads every
 * file into memory, and uses JS regex semantics (not Rust's). It keeps
 * `dsh-url-schema` free of a `@vscode/ripgrep`/`ctx.subprocess` dependency and
 * can be swapped for a ripgrep-backed executor later.
 */
async function nativeGrepFallback(
  input: { pattern: string; path?: string; include?: string },
  exec: ToolRunContext,
): Promise<GrepResult> {
  const cwd = execCwd(exec)
  const matcher = new RegExp(input.pattern)
  const include = input.include !== undefined ? globToRegExp(input.include) : undefined
  const matches: GrepMatch[] = []

  const grepFile = async (abs: string): Promise<void> => {
    const rel = slashPath(relative(cwd, abs))
    if (include !== undefined && !include.test(rel)) return
    let text: string
    try {
      text = await fsp.readFile(abs, 'utf8')
    } catch {
      return
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (matcher.test(line)) matches.push({ path: rel, line: i + 1, text: line })
    }
  }

  const walk = async (dir: string): Promise<void> => {
    if (exec.signal.aborted) throw new Error('grep aborted (tool timeout or caller cancellation)')
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) await walk(abs)
      else if (entry.isFile()) await grepFile(abs)
    }
  }

  const root = input.path !== undefined ? resolve(cwd, input.path) : cwd
  const stat = await fsp.stat(root).catch(() => undefined)
  if (stat === undefined) return { matches }
  if (stat.isFile()) await grepFile(root)
  else if (stat.isDirectory()) await walk(root)
  return { matches }
}

/**
 * Fallback native glob: recurse the filesystem from `input.path` (or the
 * session cwd) and match each file's root-relative path against the `pattern`.
 *
 * Tradeoff (documented): see {@link nativeGrepFallback}. This fallback does
 * not honor ignore files, does not support `{a,b}` brace alternation, and
 * descends into hidden/VCS directories.
 */
async function nativeGlobFallback(
  input: { pattern: string; path?: string },
  exec: ToolRunContext,
): Promise<GlobResult> {
  const cwd = execCwd(exec)
  const root = input.path !== undefined ? resolve(cwd, input.path) : cwd
  const matcher = globToRegExp(input.pattern)
  const files: string[] = []

  const walk = async (dir: string): Promise<void> => {
    if (exec.signal.aborted) throw new Error('glob aborted (tool timeout or caller cancellation)')
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        const rel = slashPath(relative(root, abs))
        if (matcher.test(rel)) files.push(rel)
      }
    }
  }

  await walk(root)
  return { files }
}

/** Register the four URL-aware tools on one agent's own scope layer. */
function installAgentTools(
  rootCtx: Context,
  agent: Agent,
  resolver: UrlResolver,
  nativeWrite: (filePath: string, content: string, exec: ToolRunContext) => Promise<WriteOutcome>,
): void {
  agent.ctx.effect(async () => {
    const disposers: Array<() => void> = []
    disposers.push(agent.ctx.tools.register(createReadTool({ resolver, fs: rootCtx.fs, ctx: rootCtx })))
    disposers.push(agent.ctx.tools.register(createWriteTool({ nativeWrite })))
    disposers.push(agent.ctx.tools.register(createGrepTool({ resolver, nativeGrep: nativeGrepFallback })))
    disposers.push(agent.ctx.tools.register(createGlobTool({ resolver, nativeGlob: nativeGlobFallback })))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Mount the resolver + scheme handlers, then install the tools per agent. */
export function apply(ctx: Context, config: Config): void {
  const resolver = new UrlResolver()

  resolver.register('skill', createSkillHandler({ skills: ctx.skills, fs: ctx.fs }))
  resolver.register('agent', createAgentHandler({ sessions: ctx.sessions, subagents: ctx.subagents }))
  // Pass `docsDir` explicitly so the handler's fixed-depth `dirname×N` fallback
  // (broken under tsdown bundling) is never reached.
  resolver.register('dsh', createDshHandler({ settings: ctx.settings, docsDir: resolveDocsDir() }))
  resolver.register('xd', createXdHandler())

  // `ctx://` reads the kernel namespace through the mode-dependent
  // `ctx.replRuntime` service (mounted by `DashrRuntime` before this plugin).
  // Register its handler once the runtime is available — the same use-time
  // idiom as the `eval` transport.
  ctx.inject(['replRuntime'], (runtimeCtx) => {
    const replRuntime = runtimeCtx.get('replRuntime') as ReplRuntimeSurface
    resolver.register('ctx', createCtxHandler({ replRuntime }))
  })

  const nativeWrite = async (
    filePath: string,
    content: string,
    exec: ToolRunContext,
  ): Promise<WriteOutcome> => {
    const target = await ctx.fs.resolve(filePath, { cwd: execCwd(exec), signal: exec.signal })
    const outcome = await ctx.fs.writeText(target, content, undefined, exec.signal)
    return { path: target.displayPath, operation: outcome.operation }
  }

  const registered = new WeakSet<Agent>()
  ctx.on('agent/session-start', ({ agent }) => {
    if (registered.has(agent)) return
    registered.add(agent)
    try {
      installAgentTools(ctx, agent, resolver, nativeWrite)
    } catch (error) {
      ctx.logger('dsh-url-schema').warn(
        `failed to install URL-aware tools for agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}

export default { name, inject, apply }
