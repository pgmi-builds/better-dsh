/**
 * `glob` tool — URL-aware file discovery.
 *
 * Two branches, mirroring the read tool:
 * - `scheme://` URL in `pattern` → resolve the URL to full text through the
 *   {@link UrlResolver} and treat the resolved text as a newline-delimited
 *   listing: each non-empty line is one entry (a roster table, a skill body,
 *   a variable value, …).
 * - ordinary pattern → native ripgrep `--files` discovery via `deps.nativeGlob`.
 *   Upstream `@deepseek-ai/dsh-tool-fs-search` is a Cordis plugin (its
 *   `applyGlobTool` registers onto a `Context` and its `runRipgrep` needs
 *   `ctx.subprocess`), so the integration step supplies the native behavior as
 *   a function — delegation, not reimplementation.
 *
 * Services required (for the integration/wiring step):
 * - `resolver` — `UrlResolver` (resolves the scheme URL's text).
 * - `nativeGlob` — wraps `ctx.subprocess` + ripgrep `--files` (upstream glob behavior).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { UrlResolver } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'

/** Canonical glob result: the matched paths (or listed resource entries). */
export interface GlobResult {
  files: string[]
}

/** Dependencies captured by the glob tool. */
export interface GlobToolDeps {
  /** Resolves a `scheme://` URL to full text for the URL branch. */
  resolver: UrlResolver
  /** Native ripgrep `--files` discovery for non-URL patterns (integration wraps `ctx.subprocess`). */
  nativeGlob: (
    input: { pattern: string; path?: string },
    exec: ToolRunContext,
  ) => Promise<GlobResult>
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

/**
 * Build the `glob` {@link ToolDefinition}: a `scheme://` `pattern` lists the
 * resolved resource, an ordinary pattern delegates to native ripgrep.
 */
export function createGlobTool(deps: GlobToolDeps): ToolDefinition {
  const { resolver, nativeGlob } = deps
  return defineTool({
    name: 'glob',
    description:
      'Discover files matching a glob pattern. When `pattern` is a scheme:// URL, list the resolved resource instead.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Glob pattern, or a scheme:// URL to list the resolved resource.',
      },
      path: {
        type: 'string',
        description: 'Optional search root directory.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        return [{ type: 'text', text: value.files.join('\n') }]
      },
    },
    async execute(args, exec): Promise<GlobResult> {
      if (isSchemeUrl(args.pattern)) {
        const text = await resolver.resolve({}, args.pattern)
        return { files: text.split('\n').filter((line) => line.length > 0) }
      }
      return nativeGlob(args, exec)
    },
  })
}
