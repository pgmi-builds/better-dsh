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
 * - `scheme://` URL → structured scheme dispatch. `dvc://<device>` writes
 *   route to the device registry via `dispatchDvcWrite` — routing/args
 *   failures throw `DVC_NO_DEVICE` / `DVC_UNKNOWN_DEVICE` / `DVC_BAD_ARGS`
 *   and device failures reject as `DVC_DEVICE_ERROR`. Every other write
 *   channel is rejected: `ctx://` is a curated read-only snapshot
 *   (`URL_READ_ONLY`), any other registered scheme has no write channel
 *   wired (`URL_WRITE_UNSUPPORTED`), and an unregistered scheme gets the
 *   resolver-style generic error. The optional `writeScheme` hook lets the
 *   integration step override the dispatch as real write channels land.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { dispatchDvcWrite } from '../handlers/dvc.ts'
import type { ResolverEnv } from '../resolver.ts'
import { parseUrl, UrlSchemaError } from '../selector.ts'

/**
 * Canonical write outcome (mirrors the upstream `dsh-tool-fs` write result
 * shape, so a delegated native return value validates against this tool's
 * declared output schema unchanged).
 */
export interface WriteOutcome {
  path: string
  /** `execute` is the `dvc://` device-dispatch outcome (no file involved). */
  operation: 'create' | 'update' | 'execute'
  /** The replaced content (`null` when the file was created). */
  before: string | null
  /** The written content (`dvc://` writes carry the device result, JSON-rendered). */
  after: string
  /** Lsp diagnostics summary for the written content (present only when a language server applied). */
  diagnostics?: string
}

/** Post-write feedback: a diagnostics summary string for the JUST-WRITTEN content, or undefined when none applies. */
export type PostWriteFeedback = (filePath: string, content: string) => Promise<string | undefined>

/** Pre-write formatting: the formatted replacement for `content`, or undefined to keep it as-is. */
export type PreWriteFormat = (filePath: string, content: string) => Promise<string | undefined>

/** Dependencies captured by the write tool. */
export interface WriteToolDeps {
  /** Native write definition captured before this wrapper registered. */
  nativeWrite?: ToolDefinition
  /** Optional lsp feedback hook (write/edit loop closure): diagnostics summary attached to the result. */
  postWrite?: PostWriteFeedback
  /** Optional lsp format hook: formats the content before the single native write lands. */
  preWriteFormat?: PreWriteFormat
  /** Optional per-scheme write dispatch; defaults to the dvc-dispatching built-in. */
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

/**
 * Default scheme-write dispatch: `dvc://` routes through the device
 * registry (`dispatchDvcWrite`); every other write channel is rejected.
 */
async function defaultSchemeWrite(scheme: string, path: string, content: string): Promise<WriteOutcome> {
  if (scheme === 'dvc') {
    // The dispatch's structured errors (DVC_NO_DEVICE / DVC_UNKNOWN_DEVICE /
    // DVC_BAD_ARGS, plus the DVC_DEVICE_ERROR wrap) bubble unchanged.
    const result = await dispatchDvcWrite(path, content)
    return {
      path: `dvc://${path}`,
      operation: 'execute',
      before: '',
      after: JSON.stringify(result, null, 2),
    }
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
  const { nativeWrite, postWrite, preWriteFormat } = deps
  const writeScheme = deps.writeScheme ?? defaultSchemeWrite
  return defineTool({
    name: 'write',
    description:
      'Create or fully replace a file. `file_path` may be a filesystem path or a scheme:// URL (`dvc://<device>` executes the device with a JSON args payload; other scheme writes are rejected).',
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
          operation: { type: 'string', required: true, enum: ['create', 'update', 'execute'] as const },
          before: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          after: { type: 'string', required: true },
          diagnostics: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const verb = value.operation === 'update' ? 'Updated' : value.operation === 'execute' ? 'Executed' : 'Created'
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
      // The lsp feedback loop (native-tools Wave3): format BEFORE the single
      // native write (one write-intent audit, before/after stay truthful),
      // then attach the post-write diagnostics summary for what just landed.
      // Both hooks fail silent — a serverless language changes nothing.
      let content = args.content
      try {
        const formatted = await preWriteFormat?.(args.file_path, content)
        if (formatted !== undefined && formatted !== content) content = formatted
      } catch { /* formatting is best-effort; the write itself must land */ }
      // Identity-preserving passthrough: an unchanged (or formatterless)
      // write forwards the SAME arguments object the caller supplied.
      const writeArgs = content === args.content ? args : { ...args, content }
      const outcome = await nativeWrite.execute(writeArgs, exec) as WriteOutcome
      try {
        const diagnostics = await postWrite?.(args.file_path, content)
        if (diagnostics !== undefined) return { ...outcome, diagnostics }
      } catch { /* diagnostics are best-effort feedback, never a write failure */ }
      return outcome
    },
  })
}

