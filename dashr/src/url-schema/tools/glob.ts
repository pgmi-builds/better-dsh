/**
 * `glob` tool — URL-aware file discovery (delegation architecture).
 *
 * Two branches, forked on whether a `scheme://` URL appears in `pattern` or
 * `path`:
 *
 * - ordinary pattern → the captured NATIVE `glob` {@link ToolDefinition},
 *   forwarded verbatim (`nativeGlob.execute(args, exec)`): the native
 *   ripgrep `--files` discovery, ordering, and caps all stay intact. The
 *   definition comes from `captureNativeTools` BEFORE this wrapper registers
 *   on the agent's own scope layer — a later capture would resolve back to
 *   this wrapper (infinite recursion). Without a native delegate the branch
 *   reports the structured `NATIVE_GLOB_UNAVAILABLE` error instead of
 *   reimplementing a simplified walk.
 * - URL in `pattern` (the URL addresses the resource to LIST):
 *   - **path-backed** schemes (`skill://`, `dsh://docs`) implement the
 *     handler's optional `resolvePath`, so the call becomes a native
 *     any-depth glob rooted at the resource's real disk directory.
 *   - **content-backed** schemes resolve to text whose non-empty lines ARE
 *     the listing (a roster table, a config dump, …) — returned directly,
 *     no native call involved.
 * - URL in `path` (the URL addresses the search ROOT, pattern stays a glob):
 *   path-backed schemes get the root translated; content-backed schemes get
 *   the resolved text materialized into a fresh temp directory that is
 *   removed afterwards whatever the outcome.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { ResolverEnv, UrlResolver } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'
import { withTempMaterialization } from './materialize.ts'

/**
 * Canonical glob result (native ripgrep `--files` shape: search `root` plus
 * matched `paths` — so a delegated native return value validates against
 * this tool's declared output schema unchanged).
 */
export interface GlobResult {
  /** The search root the paths are relative to. */
  root: string
  /** The matched file paths. */
  paths: string[]
}

/** Dependencies captured by the glob tool. */
export interface GlobToolDeps {
  /** Resolves and path-translates a `scheme://` URL for the URL branches. */
  resolver: UrlResolver
  /** Native ripgrep `--files` discovery captured before this wrapper registered. */
  nativeGlob?: ToolDefinition
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
    'NATIVE_GLOB_UNAVAILABLE',
    'the host did not deploy a native glob tool — URL-aware glob cannot delegate discovery',
  )
}

/**
 * Build the `glob` {@link ToolDefinition}: a `scheme://` URL lists the
 * addressed resource (disk directory when path-backed, resolved lines when
 * content-backed); an ordinary pattern delegates to native discovery with
 * args and exec passed through untouched.
 */
export function createGlobTool(deps: GlobToolDeps): ToolDefinition {
  const { resolver, nativeGlob } = deps
  return defineTool({
    name: 'glob',
    description:
      'Discover files matching a glob pattern. A scheme:// URL addresses a resource instead: in `pattern` it lists that resource, in `path` it scopes the glob to the resource.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Glob pattern, or a scheme:// URL addressing the resource to list.',
      },
      path: {
        type: 'string',
        description: 'Optional search root directory, or a scheme:// URL scoping the glob.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        return [{ type: 'text', text: value.paths.join('\n') }]
      },
    },
    async execute(args, exec): Promise<GlobResult> {
      // URL in `pattern`: list the addressed resource.
      if (isSchemeUrl(args.pattern)) {
        const env = execEnv(exec, args.pattern)
        // Path-backed scheme: native glob over the resource's disk directory.
        const diskDir = await resolver.resolvePath(env, args.pattern)
        if (diskDir !== undefined) {
          if (nativeGlob === undefined) throw nativeUnavailable()
          return nativeGlob.execute(
            { ...args, pattern: '**/*', path: diskDir },
            exec,
          ) as Promise<GlobResult>
        }
        // Content-backed scheme: the resolved text is the listing itself.
        const text = await resolver.resolve(env, args.pattern)
        return { root: args.pattern, paths: text.split('\n').filter((line) => line.length > 0) }
      }

      // URL in `path`: translate or materialize the search root.
      if (args.path !== undefined && isSchemeUrl(args.path)) {
        if (nativeGlob === undefined) throw nativeUnavailable()
        const env = execEnv(exec, args.path)
        const diskDir = await resolver.resolvePath(env, args.path)
        if (diskDir !== undefined) {
          return nativeGlob.execute({ ...args, path: diskDir }, exec) as Promise<GlobResult>
        }
        const text = await resolver.resolve(env, args.path)
        return withTempMaterialization(text, (tempDir) =>
          nativeGlob.execute({ ...args, path: tempDir }, exec) as Promise<GlobResult>,
        )
      }

      if (nativeGlob === undefined) throw nativeUnavailable()
      return nativeGlob.execute(args, exec) as Promise<GlobResult>
    },
  })
}
