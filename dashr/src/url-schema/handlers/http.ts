/**
 * `http://` / `https://` scheme handler — curl-style plain-text HTTP GET.
 *
 * ONE handler instance serves BOTH schemes: the wiring step registers the
 * value returned by {@link createHttpHandler} under every name in
 * {@link HTTP_SCHEMES} (`resolver.register('http', h)` and
 * `resolver.register('https', h)`). The handler carries no per-scheme state.
 *
 * Behavior contract:
 *   - **Strict whole-URL parse.** The complete raw URL is strict-parsed with
 *     `new URL(raw)` and fetched verbatim. http(s) URLs have **no selector**:
 *     `:`, `?`, and `#` are all legal URL characters (port, query, fragment)
 *     and collide with the shared selector syntax (`:N-M`, `?q=`). Parsing
 *     the whole input first naturally swallows the colon — the `:8080` in
 *     `https://host:8080/x` is a port, never a line range — which makes the
 *     behavior predictable: the handler always returns the full body, and
 *     only the resolver-level selector (applied uniformly afterwards) could
 *     ever slice it. This whole-input parse is also why the exact URL rides
 *     on the env (`env.rawUrl`): the scheme-stripped `path` handed to
 *     `resolve` cannot recover the scheme, port, or query.
 *   - **GET only, 20 s budget.** One global `fetch` with `method: 'GET'`,
 *     default redirect following (`'follow'`), and an `AbortController`
 *     deadline of 20 s → `URL_HTTP_TIMEOUT`.
 *   - **2 MiB text cap.** Checked by `Content-Length` precheck first, then
 *     by streaming byte accounting while decoding; over the cap →
 *     `URL_HTTP_TOO_LARGE` with the actual byte count.
 *   - **Text-only media whitelist.** `text/*` plus
 *     `application/{json,xml,yaml,toml,xhtml+xml,javascript,plain}`
 *     (charset parameters ignored); a missing header fails the check too.
 *     Anything else → `URL_HTTP_UNSUPPORTED_MEDIA` — binary decoding is
 *     deliberately NOT guessed.
 *   - Non-2xx → `URL_HTTP_STATUS` (status + statusText); network/DNS
 *     failure → `URL_HTTP_FETCH_FAILED` (with the underlying cause
 *     message). Precedence: status → size precheck → media → streamed body.
 *
 * The resolved text is the disclaimer line below, a blank line, then the
 * body — a plain fetch is not a sandbox read, and the consumer must see
 * that on the first line.
 */

import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/** The schemes one handler instance serves; register it under each of these. */
export const HTTP_SCHEMES = ['http', 'https'] as const

/**
 * Fields the http(s) handler reads off the resolver env. The tool layer
 * builds the env per call and should always include `rawUrl` — see the
 * module doc for why the scheme-stripped `path` is not enough.
 */
export interface HttpResolverEnv extends ResolverEnv {
  /** The complete raw URL, exactly as passed to `UrlResolver.resolve`. */
  readonly rawUrl?: string
}

/** Hard cap on a fetched body: 2 MiB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024
/** Abort the GET after this many milliseconds. */
const TIMEOUT_MS = 20_000

/** First line of every resolved http(s) URL: flags plain-fetch semantics. */
const DISCLAIMER =
  '[url-fetch] plain-text result of a direct HTTP GET (curl-equivalent). No JS execution or interaction — use browser tools, if any, for that.'

/** `application/` MIME types treated as text (any `text/*` also is). */
const APPLICATION_TEXT_TYPES: Record<string, true> = {
  'application/json': true,
  'application/xml': true,
  'application/yaml': true,
  'application/toml': true,
  'application/xhtml+xml': true,
  'application/javascript': true,
  'application/plain': true,
}

/** Strict whitelist: `text/*` or a known textual `application/*` MIME. A
 * missing header fails the check — binary decoding is never guessed. */
function isTextContentType(headerValue: string | null): boolean {
  if (headerValue === null) return false
  const mime = headerValue.split(';', 1)[0]!.trim().toLowerCase()
  return mime.startsWith('text/') || mime in APPLICATION_TEXT_TYPES
}

/** Best-effort `err.cause` message — undici nests DNS/socket failures there. */
function causeMessageOf(err: unknown): string | null {
  const cause = (err as { cause?: unknown } | null | undefined)?.cause
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string' && cause !== '') return cause
  return null
}

/** Stream the body as UTF-8 text, throwing past the 2 MiB byte cap. */
async function readBodyCapped(body: ReadableStream<Uint8Array>, href: string): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read().catch((err: unknown) => {
        // The 20 s timer aborts the fetch mid-stream; a pending read then
        // rejects with AbortError — surface it as the structured timeout,
        // never a bare DOMException.
        if (err instanceof Error && err.name === 'AbortError') {
          throw new UrlSchemaError(
            'URL_HTTP_TIMEOUT',
            `HTTP GET ${href} aborted after the ${TIMEOUT_MS / 1000} s deadline`,
          )
        }
        throw err
      })
      if (done) break
      received += value.byteLength
      if (received > MAX_BODY_BYTES) {
        throw new UrlSchemaError(
          'URL_HTTP_TOO_LARGE',
          `body of ${href} exceeded the ${MAX_BODY_BYTES}-byte (2 MiB) text limit after ${received} bytes`,
        )
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    // On the too-large bail this stops the download; on a finished stream
    // it is a no-op. Either way the reader lock is released.
    await reader.cancel().catch(() => {})
  }
}

/** One capped, whitelisted GET of `url`; returns the decoded body text. */
async function getUrl(url: URL): Promise<string> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, TIMEOUT_MS)

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
    } catch (err) {
      if (timedOut || (err instanceof Error && err.name === 'AbortError')) {
        throw new UrlSchemaError(
          'URL_HTTP_TIMEOUT',
          `HTTP GET ${url.href} aborted after the ${TIMEOUT_MS / 1000} s deadline`,
        )
      }
      const cause = causeMessageOf(err)
      const message = err instanceof Error ? err.message : String(err)
      throw new UrlSchemaError(
        'URL_HTTP_FETCH_FAILED',
        `HTTP GET ${url.href} failed: ${message}${cause === null ? '' : ` (${cause})`}`,
      )
    }
    if (!response.ok) {
      const statusText = response.statusText === '' ? '' : ` ${response.statusText}`
      throw new UrlSchemaError(
        'URL_HTTP_STATUS',
        `HTTP GET ${url.href} returned ${response.status}${statusText}`,
      )
    }

    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const bytes = Number(declared)
      if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) {
        throw new UrlSchemaError(
          'URL_HTTP_TOO_LARGE',
          `body of ${url.href} is ${bytes} bytes, over the ${MAX_BODY_BYTES}-byte (2 MiB) text limit`,
        )
      }
    }

    const contentType = response.headers.get('content-type')
    if (!isTextContentType(contentType)) {
      throw new UrlSchemaError(
        'URL_HTTP_UNSUPPORTED_MEDIA',
        `content-type of ${url.href} is "${contentType ?? '(none)'}", outside the text whitelist `
          + `(text/* or application/{json,xml,yaml,toml,xhtml+xml,javascript,plain}) `
          + '— binary decoding is deliberately not guessed',
      )
    }

    if (response.body === null) {
      // Degenerate runtime without a body stream: buffer, then re-check size.
      const text = await response.text()
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > MAX_BODY_BYTES) {
        throw new UrlSchemaError(
          'URL_HTTP_TOO_LARGE',
          `body of ${url.href} is ${bytes} bytes, over the ${MAX_BODY_BYTES}-byte (2 MiB) text limit`,
        )
      }
      return text
    }
    return await readBodyCapped(response.body, url.href)
  } finally {
    // The deadline covers the WHOLE GET — headers AND body streaming. A
    // mid-stream abort rejects the pending read as AbortError, which
    // readBodyCapped maps to URL_HTTP_TIMEOUT.
    clearTimeout(timer)
  }
}

/**
 * Build the `http://`/`https://` handler. Register the returned instance
 * under BOTH schemes ({@link HTTP_SCHEMES}); it is stateless and safe to
 * share.
 */
export function createHttpHandler(): SchemeHandler {
  return {
    async resolve(env: ResolverEnv, path: string): Promise<string> {
      // Prefer the exact raw URL from the env; the https fallback exists
      // only for direct calls that skip the resolver env wiring.
      const raw = (env as HttpResolverEnv).rawUrl ?? `https://${path}`

      let url: URL
      try {
        url = new URL(raw)
      } catch (err) {
        throw new UrlSchemaError(
          'URL_INVALID',
          `invalid http(s) URL "${raw}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new UrlSchemaError('URL_INVALID', `not an http(s) URL: "${raw}"`)
      }

      const body = await getUrl(url)
      return `${DISCLAIMER}\n\n${body}`
    },
  }
}
