/**
 * `createSchemeReadTool`: the URL-aware `read` wrapper (scheme branch only).
 *
 * Orthogonality (2026-09-13): this wrapper knows NOTHING about hashline. It
 * serves exactly one branch — `path` starting with a `scheme://` prefix
 * (`skill://name`, `agent://id/transcript`, `dsh://docs`, `dvc://device`,
 * `ctx://…`) — resolved end-to-end by the {@link UrlResolver}. Every other
 * path delegates verbatim to the terminal delegate: the read definition
 * captured before this wrapper registered (the hashline anchored read when
 * that feature is co-mounted, else the captured native read).
 *
 * Chaining contract: exactly ONE definition registers under `read` on the
 * agent's own scope layer (same-layer same-name is a registry error —
 * mapping doc §15.9). The composition root (`../index.ts`) builds the chain
 * hashline-read → scheme-wrapper → native and registers once; standalone
 * (no hashline) the captured native read is the delegate.
 *
 * Service required from the wiring step: `resolver` ({@link UrlResolver}).
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { UrlSchemesError } from '../selector.ts'
import type { ResolverEnv, UrlResolver } from '../resolver.ts'

/** Dependencies for the scheme read wrapper, supplied by the wiring step. */
export interface SchemeReadDeps {
  /** URL resolver for the `scheme://` branch. */
  resolver: UrlResolver
  /** The read definition captured before this wrapper registered (terminal delegate). */
  capturedRead?: ToolDefinition
}

/**
 * The env the URL branch hands the resolver: the calling agent, its session
 * cwd (consumed by `skill://` discovery), and the raw input URL (`http(s)://`
 * needs the complete URL — its scheme-stripped path has lost the host).
 */
type ToolResolverEnv = ResolverEnv & {
  readonly agent?: Agent
  readonly cwd?: string
  readonly rawUrl?: string
}

/** Mirrors `parseUrl`'s scheme prefix so the fork matches the resolver exactly. */

/**
 * Shape args toward the delegate's declared parameters: move the file path
 * between the `path`/`file_path` aliases according to which key the
 * delegate's schema actually declares (host-native read = `file_path`,
 * hashline = `path`). Unknown-key tolerant delegates are unaffected.
 */
function shapeArgsForDelegate(delegate: ToolDefinition, args: Record<string, unknown>, rawPath: string): Record<string, unknown> {
  const shaped = { ...args }
  // Drop the alias pair if empty so "non-empty path" validators pass.
  if (rawPath === '') {
    delete shaped.path
    delete shaped.file_path
    return shaped
  }
  const schema = delegate.parameters as
    | { properties?: Record<string, unknown>, required?: string[] }
    | undefined
  const props = schema?.properties
  if (props === undefined) {
    // Opaque schema: forward VERBATIM — adding keys an unknown validator
    // doesn't declare is exactly the failure mode this shaping exists to
    // avoid.
    return shaped
  }
  const declaresPath = props['path'] !== undefined
  const declaresFilePath = props['file_path'] !== undefined
  if (declaresFilePath && !declaresPath) {
    shaped.file_path = rawPath
    delete shaped.path
  } else if (declaresPath && !declaresFilePath) {
    shaped.path = rawPath
    delete shaped.file_path
  } else {
    shaped.path = rawPath
    shaped.file_path = rawPath
  }
  return shaped
}

const SCHEME_URL_RE = /^[a-z][a-z0-9]*:\/\//

/**
 * Build the scheme-aware `read` wrapper. The URL branch builds the resolver
 * env per call (agent + cwd + rawUrl); the scheme handlers read whichever
 * fields they need off it. File paths delegate to the terminal delegate so
 * the owning feature (hashline anchors or the native read) surfaces its own
 * result — never a silent reimplementation here.
 */
export function createSchemeReadTool(deps: SchemeReadDeps): ToolDefinition {
  const { resolver, capturedRead } = deps
  return defineTool({
    name: 'read',
    description:
      'Read a text file (each line returned as `HASH│content` with a 3-char hash anchor for later edit calls). File reads page with offset/limit. Also accepts resource URIs (skill://, agent://, dsh://, dvc://, ctx://, http(s)://).',
    parameters: {
      path: {
        type: 'string',
        description: 'File path, or a resource URI (skill://, agent://, dsh://, dvc://, ctx://, http(s)://).',
      },
      file_path: {
        type: 'string',
        description: 'Alias of `path` (accepted for host-native compatibility).',
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
      const rawPath = typeof args?.path === 'string'
        ? args.path
        : typeof args?.file_path === 'string' ? args.file_path : ''
      // URL branch: resolve end-to-end via the scheme registry, handing the
      // handlers the calling agent, its cwd, and the raw input URL.
      // Without a resolver the wrapper carries no scheme capability —
      // delegate instead.
      if (resolver !== undefined && SCHEME_URL_RE.test(rawPath)) {
        const cwd = exec.agent?.session.header.cwd
        const env: ToolResolverEnv = cwd === undefined
          ? { agent: exec.agent, rawUrl: rawPath }
          : { agent: exec.agent, cwd, rawUrl: rawPath }
        return resolver.resolve(env, rawPath)
      }

      // Terminal delegate: the definition registered under `read` before this
      // wrapper (hashline's anchored read, or the native tool — capture
      // anchors on the semantic name). Args are shaped to the delegate's own
      // declared parameters (path/file_path alias — the native host read
      // requires `file_path`; hashline takes `path`) and the result is
      // coerced to the string output this wrapper declares.
      if (capturedRead !== undefined && capturedRead.execute !== undefined) {
        const delegated = await capturedRead.execute(shapeArgsForDelegate(capturedRead, args, rawPath), exec)
        if (typeof delegated === 'string') return delegated
        return delegated === undefined || delegated === null ? '' : JSON.stringify(delegated)
      }
      throw new UrlSchemesError(
        'NATIVE_READ_UNAVAILABLE',
        'no read delegate is available: neither hashline nor the native read is in place',
      )
    },
  })
}
