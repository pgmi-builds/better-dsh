/**
 * `grep` tool — URL-aware content search.
 *
 * Two branches, mirroring the read tool:
 * - `scheme://` URL in `path` → resolve the URL to full text through the
 *   {@link UrlResolver}, then run the regex `pattern` over the resolved text.
 *   A scheme URL addresses one resource, so `include` is ignored and line
 *   numbers are relative to the resolved text.
 * - ordinary path → native ripgrep search via `deps.nativeGrep`. Upstream
 *   `@deepseek-ai/dsh-tool-fs-search` is a Cordis plugin (its `applyGrepTool`
 *   registers onto a `Context` and its `runRipgrep` needs `ctx.subprocess`),
 *   so the integration step supplies the native behavior as a function —
 *   delegation, not reimplementation.
 *
 * Services required (for the integration/wiring step):
 * - `resolver` — `UrlResolver` (resolves the scheme URL's text).
 * - `nativeGrep` — wraps `ctx.subprocess` + ripgrep (upstream grep behavior).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { UrlResolver } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'

/** One matched line, with its 1-based line number in the searched text. */
export interface GrepMatch {
  path: string
  line: number
  text: string
}

/** Canonical grep result: flat matches in output order. */
export interface GrepResult {
  matches: GrepMatch[]
}

/** Dependencies captured by the grep tool. */
export interface GrepToolDeps {
  /** Resolves a `scheme://` URL to full text for the URL branch. */
  resolver: UrlResolver
  /** Native ripgrep search for non-URL paths (integration wraps `ctx.subprocess`). */
  nativeGrep: (
    input: { pattern: string; path?: string; include?: string },
    exec: ToolRunContext,
  ) => Promise<GrepResult>
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

/** Run a regex over already-resolved text, yielding one match per hit line. */
function grepText(text: string, pattern: string, path: string): GrepMatch[] {
  let re: RegExp
  try {
    re = new RegExp(pattern)
  } catch (error) {
    throw new UrlSchemaError(
      'GREP_INVALID_PATTERN',
      `invalid grep pattern "${pattern}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return text.split('\n').flatMap((lineText, index) => {
    return re.test(lineText) ? [{ path, line: index + 1, text: lineText }] : []
  })
}

/**
 * Build the `grep` {@link ToolDefinition}: a `scheme://` `path` searches the
 * resolved resource text, an ordinary path delegates to native ripgrep.
 */
export function createGrepTool(deps: GrepToolDeps): ToolDefinition {
  const { resolver, nativeGrep } = deps
  return defineTool({
    name: 'grep',
    description:
      'Search file contents with a regular expression. When `path` is a scheme:// URL, search the resolved resource text instead.',
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
        description: 'Optional file-glob filter (ignored for scheme:// URLs).',
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
                line: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const count = value.matches.length
        const header = `${count} match${count === 1 ? '' : 'es'}`
        const body = value.matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n')
        return [{ type: 'text', text: body.length > 0 ? `${header}\n${body}` : header }]
      },
    },
    async execute(args, exec): Promise<GrepResult> {
      if (args.path !== undefined && isSchemeUrl(args.path)) {
        const text = await resolver.resolve({}, args.path)
        return { matches: grepText(text, args.pattern, args.path) }
      }
      return nativeGrep(args, exec)
    },
  })
}
