/**
 * `write` tool — URL-aware full-file write (delegation architecture).
 *
 * Two branches:
 * - ordinary path → the captured NATIVE `write` {@link ToolDefinition},
 *   forwarded verbatim (`nativeWrite.execute(args, exec)`): the native
 *   write-intent policy gate, sandbox resolution, and observation events all
 *   stay intact. The definition comes from `captureNativeTools` BEFORE this
 *   wrapper registers on the agent's own scope layer — a later capture would
 *   resolve back to this wrapper (infinite recursion). Without a native
 *   delegate the branch reports the structured `NATIVE_WRITE_UNAVAILABLE`
 *   error instead of silently reimplementing a write.
 * - `scheme://` URL → structured scheme dispatch. Every write channel is
 *   rejected this wave: `dvc://` has no device layer (`DVC_NO_DEVICE`),
 *   `ctx://` is a curated read-only snapshot (`URL_READ_ONLY`), any other
 *   registered scheme has no write channel wired (`URL_WRITE_UNSUPPORTED`),
 *   and an unregistered scheme gets the resolver-style generic error. The
 *   optional `writeScheme` hook lets the integration step override the
 *   dispatch as real write channels land.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { ResolverEnv } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'

/**
 * Canonical write outcome (mirrors the upstream `dsh-tool-fs` write result
 * shape, so a delegated native return value validates against this tool's
 * declared output schema unchanged).
 */
export interface WriteOutcome {
  path: string
  operation: 'create' | 'update'
  /** The replaced content (`null` when the file was created). */
  before: string | null
  /** The written content. */
  after: string
}

/** Dependencies captured by the write tool. */
export interface WriteToolDeps {
  /** Native write definition captured before this wrapper registered. */
  nativeWrite?: ToolDefinition
  /** Optional per-scheme write dispatch; defaults to the all-rejected placeholder. */
  writeScheme?: (
    scheme: string,
    path: string,
    content: string,
    env: ResolverEnv,
  ) => Promise<WriteOutcome>
}

/**
 * Schemes the URL schema registers (v0.1.8d): the default write dispatch
 * keys off this static table; the integration step can replace the whole
 * dispatch through `writeScheme` when it needs the live registry.
 */
const REGISTERED_SCHEMES = ['agent', 'ctx', 'dsh', 'dvc', 'http', 'https', 'skill'] as const

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

/** Default scheme-write dispatch: every write channel is rejected this wave. */
function defaultSchemeWrite(scheme: string, path: string): WriteOutcome {
  if (scheme === 'dvc') {
    throw new UrlSchemaError(
      'DVC_NO_DEVICE',
      'dvc:// write dispatch: no devices mounted to route the write to',
    )
  }
  if (scheme === 'ctx') {
    throw new UrlSchemaError(
      'URL_READ_ONLY',
      `ctx:// is a curated read-only snapshot — write to ctx://${path} is not supported`,
    )
  }
  if ((REGISTERED_SCHEMES as readonly string[]).includes(scheme)) {
    throw new UrlSchemaError(
      'URL_WRITE_UNSUPPORTED',
      `write to ${scheme}:// is not supported (read-only scheme, or its write channel is not wired yet)`,
    )
  }
  throw new UrlSchemaError(
    'URL_UNREGISTERED_SCHEME',
    `no handler registered for scheme "${scheme}" (registered: ${REGISTERED_SCHEMES.join(', ')})`,
  )
}

/**
 * Build the `write` {@link ToolDefinition}: `scheme://` paths route to the
 * scheme write dispatch, ordinary paths delegate to the captured native
 * write definition with args and exec passed through untouched.
 */
export function createWriteTool(deps: WriteToolDeps): ToolDefinition {
  const { nativeWrite } = deps
  const writeScheme = deps.writeScheme ?? defaultSchemeWrite
  return defineTool({
    name: 'write',
    description:
      'Create or fully replace a file. `file_path` may be a filesystem path or a scheme:// URL (URL writes are rejected per scheme until a write channel is wired).',
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
          before: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          after: { type: 'string', required: true },
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
      if (nativeWrite === undefined) {
        throw new UrlSchemaError(
          'NATIVE_WRITE_UNAVAILABLE',
          'the host did not deploy a native write tool — URL-aware write cannot delegate filesystem writes',
        )
      }
      return nativeWrite.execute(args, exec) as Promise<WriteOutcome>
    },
  })
}

