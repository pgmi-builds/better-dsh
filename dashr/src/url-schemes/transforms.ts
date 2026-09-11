/**
 * Read transforms: the ordered stages of the read chassis (`tools/read.ts`).
 *
 * ONE registration owns `read` on the agent's own scope layer (same-layer
 * same-name is a registry error — mapping doc §15.9); read-side features
 * compose as TRANSFORMS. Each transform decides via `test` whether it serves
 * the request; the first matching transform serves it (`run`) — `next()`
 * continues down the chain for transforms that only pre-process. The terminal
 * delegate (the read definition captured before the chassis registered) sits
 * behind the whole chain.
 *
 * v1 ships two transforms:
 * - `createUrlTransform` — `scheme://` paths resolve end-to-end through the
 *   `UrlResolver` (gated by `gates.urlSchemes`).
 * - `createAnchorTransform` — ordinary file paths run the vendored hashline
 *   read-and-serve pipeline (`HASH│content` anchors + served-row store),
 *   gated by `gates.hashline`; it never calls `next()` — while the anchor
 *   feature is enabled it IS the read implementation for files.
 *
 * Composition convention: every read-interested feature ships a transform and
 * delegates what it does not serve; installation order is then irrelevant.
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { readAndServe } from './vendored/hashline/read-and-serve.js'
import { ctxFsIO } from './vendored/hashline/fs-bridge.js'
import { execCwd, withWorkspace } from './vendored/hashline/session-view.js'

/** Feature gates (patch-line `config:` block; both default on). */
export interface ReadGates {
  readonly urlSchemes: boolean
  readonly hashline: boolean
}

/** The normalized request the chassis hands down the chain. */
export interface ReadRequest {
  readonly path: string
  readonly offset?: number
  readonly limit?: number
}

/** One ordered stage of the read chassis. */
export interface ReadTransform {
  readonly name: string
  test(rawPath: string): boolean
  run(rawPath: string, request: ReadRequest, exec: ToolExecution, next: () => Promise<string>): Promise<string>
}

/** Scheme-prefix fork — kept in ONE place so every stage agrees on the split. */
export const SCHEME_URL_RE = /^[a-z][a-z0-9]*:\/\//

/** The fs bridge the anchor transform serves through (mirror of the tool layer's). */
export type CtxFsIO = ReturnType<typeof ctxFsIO>

/**
 * URL transform: `scheme://` paths resolve end-to-end via the `UrlResolver`,
 * handing handlers the calling agent, its session cwd, and the raw input URL
 * (http(s) needs the complete URL — the scheme-stripped path lost the host).
 */
export function createUrlTransform(deps: {
  resolver: { resolve(env: unknown, url: string): Promise<string> }
  gates: ReadGates
}): ReadTransform {
  return {
    name: 'url',
    test: rawPath => deps.gates.urlSchemes && SCHEME_URL_RE.test(rawPath),
    run: async (rawPath, _request, exec) => {
      const cwd = exec.agent?.session.header.cwd
      const env = cwd === undefined
        ? { agent: exec.agent, rawUrl: rawPath }
        : { agent: exec.agent, cwd, rawUrl: rawPath }
      return deps.resolver.resolve(env, rawPath)
    },
  }
}

/**
 * Hashline anchor transform: ordinary file paths run the vendored hashline
 * read-and-serve pipeline over the fs bridge (anchors + served-row store +
 * `fs/observed` recording so later write/edit calls see the read version).
 * Serves directly — `next()` is not called: this pipeline is the read
 * implementation for files while the anchor feature is enabled.
 */
export function createAnchorTransform(deps: { io: CtxFsIO; gates: ReadGates }): ReadTransform {
  return {
    name: 'hashline-anchor',
    test: rawPath => deps.gates.hashline && !SCHEME_URL_RE.test(rawPath),
    run: async (rawPath, request, exec) =>
      withWorkspace(execCwd(exec), async () => {
        const cwd = execCwd(exec)
        const { text, absolutePath } = await readAndServe(deps.io, rawPath, cwd, {
          signal: exec.signal,
          offset: request.offset,
          limit: request.limit,
        })
        // Record the observation with the fs policy gate so later built-in
        // write/edit calls see this file at the version the model just read.
        await deps.io.emitObserved(absolutePath, exec, exec.signal)
        return text
      }),
  }
}
