/**
 * `createReadTool`: the URL-aware `read` tool doer.
 *
 * `read` has two branches, forked on the `path` argument:
 *
 * - **URL branch** — `path` starts with a `scheme://` prefix (e.g.
 *   `skill://name`, `agent://id/transcript`, `dsh://docs`, `xd://device`).
 *   The URL is resolved end-to-end by the {@link UrlResolver} (dispatch to the
 *   registered scheme handler, then uniform selector application), and the
 *   resolved text is returned verbatim.
 * - **File branch** — any other `path` is a filesystem path. It flows through
 *   the vendored hashline read pipeline (`readAndServe` over the `ctxFsIO`
 *   bridge), preserving the `HASH│content` anchors + snapshot store that the
 *   vendored `edit` tool depends on. Hashline logic is reused, not re-written.
 *
 * Services required from the wiring step (captured in the constructor closure):
 * - `resolver` — {@link UrlResolver} for the URL branch.
 * - `fs` — the deployment's `ctx.fs` (`FileSystem` from `@deepseek-ai/dsh-fs`),
 *   bridged via `ctxFsIO` so hashline reads honor the sandboxed/remote backend.
 * - `ctx` — the Cordis context, for the fs bridge's `fs/write-intent` +
 *   `fs/observed` policy gate.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { UrlResolver } from '../resolver.ts'
import {
  normalizeRequest as normReq,
  assertReadRequest,
} from '../vendored/hashline/contract.js'
import { ctxFsIO } from '../vendored/hashline/fs-bridge.js'
import { readAndServe } from '../vendored/hashline/read-and-serve.js'
import { execCwd, execSessionKey, withWorkspace } from '../vendored/hashline/session-view.js'

/** Dependencies for the read tool, supplied by the wiring step. */
export interface ReadToolDeps {
  /** URL resolver for the `scheme://` branch. */
  resolver: UrlResolver
  /** Deployment filesystem, bridged for the hashline (file) branch. */
  fs: FileSystem
  /** Cordis context, for the fs bridge's policy/observation events. */
  ctx: Context
}

/** Mirrors `parseUrl`'s scheme prefix so the fork matches the resolver exactly. */
const SCHEME_URL_RE = /^[a-z][a-z0-9]*:\/\//

/**
 * Build the URL-aware `read` tool.
 *
 * The `env` handed to `resolver.resolve` is empty in this wave — scheme
 * handlers capture their providers via their own constructor closures.
 */
export function createReadTool(deps: ReadToolDeps): ToolDefinition {
  const { resolver, fs, ctx } = deps
  // One bridge for the tool's lifetime: closes over `fs` + `ctx` so every
  // hashline read honors the deployment's filesystem and observation policy.
  const io = ctxFsIO(fs, ctx)

  return defineTool({
    name: 'read',
    description:
      'Read a text file (each line returned as `HASH│content` with a 3-char ' +
      'hash anchor for later edit calls) or resolve a `scheme://` URL ' +
      '(skill/agent/dsh/xd) to its selected text. File reads page with ' +
      'offset/limit; URL reads resolve end-to-end and ignore offset/limit.',
    parameters: {
      path: {
        type: 'string',
        description:
          'File path (hashline-anchored read), or a `scheme://` URL to resolve ' +
          '(e.g. skill://name/path, agent://id/transcript, dsh://docs/doc, xd://device).',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed, file reads only)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (file reads only)',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const canonical = normReq(args)
      assertReadRequest(canonical)
      const rawPath = canonical.path

      // URL branch: resolve end-to-end via the scheme registry.
      if (SCHEME_URL_RE.test(rawPath)) {
        return resolver.resolve({}, rawPath)
      }

      // File branch: vendored hashline read-and-serve, wrapped in the session
      // workspace so served-row persistence keys by the right cwd.
      return withWorkspace(execCwd(exec), async () => {
        const cwd = execCwd(exec)
        const sessionKey = execSessionKey(exec)
        const signal = exec.signal
        const { text, absolutePath } = await readAndServe(io, rawPath, cwd, {
          sessionKey,
          signal,
          offset: canonical.offset,
          limit: canonical.limit,
        })
        // Record the observation with the fs policy gate so later built-in
        // write/edit calls see this file at the version the model just read.
        await io.emitObserved(absolutePath, exec, signal)
        return text
      })
    },
  })
}
