/**
 * `write` tool — URL-aware full-file write.
 *
 * Two branches, mirroring the read tool:
 * - `scheme://` URL → scheme write dispatch (the framework). This wave wires
 *   only `xd://`, which fails with the structured `XD_NO_DEVICE` error via
 *   {@link dispatchXdWrite}; every other scheme falls back to a structured
 *   `URL_WRITE_UNSUPPORTED` error until its write channel lands (e.g. the
 *   `ctx://` kernel set channel in wave 6). The optional `writeScheme` deps
 *   hook is the extension point the integration step fills as schemes gain
 *   write handlers.
 * - ordinary path → the native write executor captured in `deps.nativeWrite`.
 *   Upstream `@deepseek-ai/dsh-tool-fs` is a Cordis plugin: its
 *   `applyWriteTool` registers onto a `Context` and is NOT exported, so the
 *   integration step supplies the native behavior as a function — delegation,
 *   not reimplementation.
 *
 * Services required (for the integration/wiring step):
 * - `nativeWrite` — wraps `ctx.fs.writeText` (upstream write behavior).
 * - `writeScheme` (optional) — per-scheme write dispatch; defaults to the
 *   xd://-error-only placeholder defined in this module.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { ResolverEnv } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'
import { dispatchXdWrite } from '../handlers/xd.ts'

/** Canonical write outcome (mirrors upstream `dsh-tool-fs` write result shape). */
export interface WriteOutcome {
  path: string
  operation: 'create' | 'update'
}

/** Dependencies captured by the write tool. */
export interface WriteToolDeps {
  /** Native write for non-URL paths (the integration step wraps `ctx.fs.writeText`). */
  nativeWrite: (filePath: string, content: string, exec: ToolRunContext) => Promise<WriteOutcome>
  /** Optional per-scheme write dispatch; defaults to the xd://-error-only placeholder. */
  writeScheme?: (scheme: string, path: string, content: string, env: ResolverEnv) => Promise<WriteOutcome>
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

/** Default scheme-write dispatch: only `xd://` is wired (as an error) this wave. */
function defaultSchemeWrite(scheme: string, path: string, content: string): Promise<WriteOutcome> {
  if (scheme === 'xd') {
    dispatchXdWrite(path, content)
  }
  throw new UrlSchemaError(
    'URL_WRITE_UNSUPPORTED',
    `write to ${scheme}:// is not supported (read-only scheme, or its write channel is not wired yet)`,
  )
}

/**
 * Build the `write` {@link ToolDefinition}: `scheme://` paths route to the
 * scheme write dispatch, ordinary paths to the native write executor.
 */
export function createWriteTool(deps: WriteToolDeps): ToolDefinition {
  const { nativeWrite } = deps
  const writeScheme = deps.writeScheme ?? defaultSchemeWrite
  return defineTool({
    name: 'write',
    description:
      'Create or fully replace a file. `file_path` may be a filesystem path or a scheme:// URL (xd:// write dispatch errors until a device layer is mounted).',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Target filesystem path or scheme:// URL to write.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Full new content (an empty string writes an empty file).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] as const },
        },
      },
      render: (_args, value) => {
        const verb = value.operation === 'update' ? 'Updated' : 'Created'
        return [{ type: 'text', text: `${verb} ${value.path}` }]
      },
    },
    async execute(args, exec): Promise<WriteOutcome> {
      if (isSchemeUrl(args.file_path)) {
        const parsed = parseUrl(args.file_path)
        return writeScheme(parsed.scheme, parsed.path, args.content, {})
      }
      return nativeWrite(args.file_path, args.content, exec)
    },
  })
}
