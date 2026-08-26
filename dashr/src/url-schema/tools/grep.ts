/**
 * `grep` tool — URL-aware content search (delegation architecture).
 *
 * Two branches:
 * - ordinary path → the captured NATIVE `grep` {@link ToolDefinition},
 *   forwarded verbatim (`nativeGrep.execute(args, exec)`): the native
 *   ripgrep invocation, caps, and spill behavior all stay intact. The
 *   definition comes from `captureNativeTools` BEFORE this wrapper registers
 *   on the agent's own scope layer — a later capture would resolve back to
 *   this wrapper (infinite recursion). Without a native delegate every call
 *   reports the structured `NATIVE_GREP_UNAVAILABLE` error instead of
 *   reimplementing a simplified search.
 * - `scheme://` URL in `path` → still the native engine, over translated
 *   input:
 *   - **path-backed** schemes (`skill://`, `dsh://docs`) implement the
 *     handler's optional `resolvePath`, so the URL is translated to its real
 *     disk path and only `args.path` is rewritten before delegating.
 *   - **content-backed** schemes (agent, ctx, `dsh://config`, http, …) have
 *     no disk location: the URL is resolved to full text, materialized into
 *     a fresh temp directory, the search is pointed at the temp file, and
 *     the directory is removed afterwards whatever the outcome.
 */

import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { ResolverEnv, UrlResolver } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'
import { withTempMaterialization } from './materialize.ts'

/**
 * One matched line (native ripgrep result shape: `path`, 1-based
 * `lineNumber`, matched `line` text — so a delegated native return value
 * validates against this tool's declared output schema unchanged).
 */
export interface GrepMatch {
  path: string
  lineNumber: number
  line: string
}

/** Canonical grep result: flat matches in output order (native shape). */
export interface GrepResult {
  matches: GrepMatch[]
}

/** Dependencies captured by the grep tool. */
export interface GrepToolDeps {
  /** Resolves and path-translates a `scheme://` URL for the URL branch. */
  resolver: UrlResolver
  /** Native ripgrep search definition captured before this wrapper registered. */
  nativeGrep?: ToolDefinition
}

/** The env the tool layer hands the resolver: the calling agent, its cwd, and
 * the raw URL (the `http(s)://` handler needs the complete input — its
 * scheme-stripped path has lost the host). */
type ToolResolverEnv = ResolverEnv & {
  readonly agent?: Agent
  readonly cwd?: string
  readonly rawUrl?: string
}

/** Build the resolver env from one tool execution (agent + session cwd + raw URL). */
function execEnv(exec: ToolRunContext, rawUrl: string): ToolResolverEnv {
  return { agent: exec.agent, cwd: exec.agent?.session.header.cwd, rawUrl }
}

/** Detects a `scheme://` prefix with the resolver layer's own parser. */
function isSchemeUrl(raw: string): boolean {
  try {
    parseUrl(raw)
    return true
  } catch (error) {
    if (error instanceof UrlSchemaError && error.code === 'URL_NO_SCHEME') return false
    throw error
  }
}

/** Structured error for calls that cannot run without the native delegate. */
function nativeUnavailable(): UrlSchemaError {
  return new UrlSchemaError(
    'NATIVE_GREP_UNAVAILABLE',
    'the host did not deploy a native grep tool — URL-aware grep cannot delegate searches',
  )
}

/**
 * Build the `grep` {@link ToolDefinition}: a `scheme://` `path` translates
 * (path-backed) or materializes (content-backed) the resource and delegates
 * to native ripgrep; an ordinary path delegates with args and exec passed
 * through untouched.
 */
export function createGrepTool(deps: GrepToolDeps): ToolDefinition {
  const { resolver, nativeGrep } = deps
  return defineTool({
    name: 'grep',
    description:
      'Search file contents with a regular expression. When `path` is a scheme:// URL, search the resolved resource: path-backed schemes search their real disk location, content-backed schemes search the resolved text.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Regular expression to search for.',
      },
      path: {
        type: 'string',
        description: 'Search root: a filesystem path, or a scheme:// URL to search the resolved resource.',
      },
      include: {
        type: 'string',
        description: 'Optional file-glob filter.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                lineNumber: { type: 'integer', required: true },
                line: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const count = value.matches.length
        const header = `${count} match${count === 1 ? '' : 'es'}`
        const body = value.matches.map((m) => `${m.path}:${m.lineNumber}: ${m.line}`).join('\n')
        return [{ type: 'text', text: body.length > 0 ? `${header}\n${body}` : header }]
      },
    },
    async execute(args, exec): Promise<GrepResult> {
      if (nativeGrep === undefined) throw nativeUnavailable()

      if (args.path !== undefined && isSchemeUrl(args.path)) {
        const env = execEnv(exec, args.path)
        // Path-backed scheme: translate the URL to its real disk path.
        const diskPath = await resolver.resolvePath(env, args.path)
        if (diskPath !== undefined) {
          return nativeGrep.execute({ ...args, path: diskPath }, exec) as Promise<GrepResult>
        }
        // Content-backed scheme: resolve the text, search its temp copy.
        const text = await resolver.resolve(env, args.path)
        return withTempMaterialization(text, (tempDir) =>
          nativeGrep.execute({ ...args, path: join(tempDir, 'content.txt') }, exec) as Promise<GrepResult>,
        )
      }

      return nativeGrep.execute(args, exec) as Promise<GrepResult>
    },
  })
}
