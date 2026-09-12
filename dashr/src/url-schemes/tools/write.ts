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

import { SCHEME_NAMES } from '../catalog.ts'
import { dispatchDvcWrite } from '../handlers/dvc.ts'
import type { FsSandboxController } from '../vendored/hashline/sandbox.js'
import type { ResolverEnv } from '../resolver.ts'
import { parseUrl, UrlSchemesError } from '../selector.ts'

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
  /**
   * Escalation advertisement surface (v0.2.2-c): when a confining backend is
   * mounted, the wrapper RE-DECLARES the native write tool's escalation
   * fields (`sandbox_permissions`/`justification`) in its own `parameters`.
   * This registration shadows the native tool, so without it the model's
   * advertised schema loses the fields and a schema-obedient model can never
   * honor the denial marker's escalation hint (2026-09-06 incident: GLM-5.3
   * looped on plain denials while the args passthrough itself was intact —
   * the model simply never sent fields the schema never solicited).
   */
  sandbox?: Pick<FsSandboxController, 'escalationModes' | 'schemaFields'>
}

/**
 * Schemes the URL schema registers (v0.1.8d): the default write dispatch
 * keys off this table; the integration step can replace the whole
 * dispatch through `writeScheme` when it needs the live registry.
 *
 * Rendered from `catalog.ts` rather than written out here — this literal was
 * one of the hand-maintained copies that drifted from the scheme set.
 */
const REGISTERED_SCHEMES = SCHEME_NAMES

/** Detects a `scheme://` prefix with the resolver layer's own parser. */
function isSchemeUrl(raw: string): boolean {
  try {
    parseUrl(raw)
    return true
  } catch (error) {
    if (error instanceof UrlSchemesError && error.code === 'URL_NO_SCHEME') return false
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
    throw new UrlSchemesError(
      'URL_READ_ONLY',
      `ctx:// is a curated read-only snapshot — write to ctx://${path} is not supported`,
    )
  }
  if ((REGISTERED_SCHEMES as readonly string[]).includes(scheme)) {
    throw new UrlSchemesError(
      'URL_WRITE_UNSUPPORTED',
      `write to ${scheme}:// is not supported (read-only scheme, or its write channel is not wired yet)`,
    )
  }
  throw new UrlSchemesError(
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
  const { nativeWrite, postWrite, preWriteFormat, sandbox } = deps
  const writeScheme = deps.writeScheme ?? defaultSchemeWrite
  return defineTool({
    name: 'write',
    description:
      'Create or fully replace a UTF-8 text file.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to write, resolved by the filesystem backend.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Full UTF-8 text content to write.',
      },
      // v0.2.2-c: re-advertise the native escalation fields under a confining
      // backend — the delegated execute forwards args verbatim, but a field
      // the schema never solicited is a field the model never sends (the
      // 09-03 fix covered edit's call-site drop; this closes write's
      // advertisement gap of the same symptom class).
      ...sandbox !== undefined && sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
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
        // F4 hot-fix (v0.1.9-b): the diagnostics summary rides the RESULT TEXT
        // too — the wire face renders text, and the feedback loop must reach
        // the model on a direct call, not only inside a cell's raw JSON.
        let text = value.diagnostics === undefined
          ? `${verb} ${value.path}`
          : `${verb} ${value.path}\n${value.diagnostics}`
        // Device executions (dvc://) carry their result payload ONLY in the
        // structured `after` field — the wire face must surface it too, or
        // ast_grep/lsp/browser results are invisible to the model on a direct
        // call (six-scheme audit §3.1).
        if (value.operation === 'execute' && value.after !== undefined) text += `\n${value.after}`
        return [{ type: 'text', text }]
      },
    },
    async execute(args, exec): Promise<WriteOutcome> {
      if (isSchemeUrl(args.file_path)) {
        const parsed = parseUrl(args.file_path)
        return writeScheme(parsed.scheme, parsed.path, args.content, {})
      }
      if (nativeWrite === undefined) {
        throw new UrlSchemesError(
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

