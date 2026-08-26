import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpHandler, HTTP_SCHEMES } from '../../src/url-schema/handlers/http.ts'
import type { HttpResolverEnv } from '../../src/url-schema/handlers/http.ts'
import { UrlResolver } from '../../src/url-schema/resolver.ts'

// Independent copy of the handler's first line: the exact disclaimer text is
// part of the contract, so the test must not import it from the module.
const DISCLAIMER =
  '[url-fetch] plain-text result of a direct HTTP GET (curl-equivalent). No JS execution or interaction — use browser tools, if any, for that.'

const handler = createHttpHandler()

/** Env carrying the full raw URL, as the tool layer is wired to do. */
function envWith(rawUrl: string): HttpResolverEnv {
  return { rawUrl }
}

/** A 2xx text response with the given body and content-type. */
function textResponse(body: string, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { headers: { 'content-type': contentType } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createHttpHandler: happy path', () => {
  it('returns the disclaimer, a blank line, then the body for a 2xx text response', async () => {
    const fetchMock = vi.fn(async (_input?: unknown, _init?: RequestInit) =>
      textResponse('hello world'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await handler.resolve(envWith('https://example.com/a.txt'), '')

    expect(out).toBe(`${DISCLAIMER}\n\nhello world`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('https://example.com/a.txt')
    expect(init?.method).toBe('GET')
    expect(init?.redirect).toBe('follow')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the port and query from the raw URL (whole-URL strict parse)', async () => {
    const fetchMock = vi.fn(async (_input?: unknown, _init?: RequestInit) => textResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)

    await handler.resolve(envWith('https://example.com:8443/x?q=1'), '')

    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://example.com:8443/x?q=1')
  })

  it('falls back to https://<path> when the env has no rawUrl', async () => {
    const fetchMock = vi.fn(async (_input?: unknown, _init?: RequestInit) => textResponse('fb'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(handler.resolve({}, 'example.com/fallback')).resolves.toBe(
      `${DISCLAIMER}\n\nfb`,
    )
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://example.com/fallback')
  })
})

describe('createHttpHandler: timeout', () => {
  it('aborts with URL_HTTP_TIMEOUT when the 20 s deadline fires', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input?: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const aborted = new Error('This operation was aborted')
              aborted.name = 'AbortError'
              reject(aborted)
            })
          }),
      ),
    )

    const pending = handler.resolve(envWith('https://slow.example.com/'), '')
    const check = expect(pending).rejects.toMatchObject({ code: 'URL_HTTP_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(20_000)
    await check
  })

  it('classifies an immediate AbortError rejection as a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const aborted = new Error('This operation was aborted')
        aborted.name = 'AbortError'
        throw aborted
      }),
    )

    await expect(handler.resolve(envWith('https://example.com/'), '')).rejects.toMatchObject({
      code: 'URL_HTTP_TIMEOUT',
    })
  })
})

describe('createHttpHandler: status', () => {
  it('raises URL_HTTP_STATUS (with status + statusText) on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('nope', {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    )

    await expect(handler.resolve(envWith('https://example.com/missing'), '')).rejects.toMatchObject(
      {
        code: 'URL_HTTP_STATUS',
        message: expect.stringContaining('404 Not Found'),
      },
    )
  })
})

describe('createHttpHandler: 2 MiB cap', () => {
  it('rejects URL_HTTP_TOO_LARGE from the Content-Length precheck without reading the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({
            'content-type': 'text/plain',
            'content-length': String(5 * 1024 * 1024),
          }),
          body: null,
          text: async () => {
            throw new Error('body must not be read when Content-Length already overflows')
          },
        }) as unknown as Response,
      ),
    )

    await expect(handler.resolve(envWith('https://example.com/huge'), '')).rejects.toMatchObject({
      code: 'URL_HTTP_TOO_LARGE',
      message: expect.stringMatching(/5242880 bytes/),
    })
  })

  it('rejects URL_HTTP_TOO_LARGE while streaming an over-cap chunked body', async () => {
    const encoder = new TextEncoder()
    const chunk = encoder.encode('x'.repeat(64 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 3 * 1024 * 1024) {
          controller.close()
          return
        }
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/plain' } })),
    )

    await expect(handler.resolve(envWith('https://example.com/chunked'), '')).rejects.toMatchObject(
      {
        code: 'URL_HTTP_TOO_LARGE',
        message: expect.stringMatching(/2 MiB.*after \d+ bytes/),
      },
    )
  })
})

describe('createHttpHandler: media whitelist', () => {
  it.each([
    'text/plain',
    'text/plain; charset=iso-8859-1',
    'text/html; charset=utf-8',
    'text/markdown',
    'application/json',
    'application/xml',
    'application/yaml',
    'application/toml',
    'application/xhtml+xml',
    'application/javascript',
    'application/plain',
    'application/JSON; charset=utf-8',
  ])('accepts %s', async (contentType) => {
    vi.stubGlobal('fetch', vi.fn(async () => textResponse('ok-body', contentType)))

    await expect(handler.resolve(envWith('https://example.com/x'), '')).resolves.toBe(
      `${DISCLAIMER}\n\nok-body`,
    )
  })

  it.each(['image/png', 'application/octet-stream', 'application/pdf', 'audio/mpeg'])(
    'raises URL_HTTP_UNSUPPORTED_MEDIA (naming the type) for %s',
    async (contentType) => {
      vi.stubGlobal('fetch', vi.fn(async () => textResponse('ignored', contentType)))

      await expect(handler.resolve(envWith('https://example.com/bin'), '')).rejects.toMatchObject({
        code: 'URL_HTTP_UNSUPPORTED_MEDIA',
        message: expect.stringContaining(contentType),
      })
    },
  )

  it('raises URL_HTTP_UNSUPPORTED_MEDIA for a missing content-type instead of guessing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          body: null,
          text: async () => 'opaque',
        }) as unknown as Response,
      ),
    )

    await expect(handler.resolve(envWith('https://example.com/none'), '')).rejects.toMatchObject({
      code: 'URL_HTTP_UNSUPPORTED_MEDIA',
      message: expect.stringContaining('(none)'),
    })
  })
})

describe('createHttpHandler: network failures', () => {
  it('raises URL_HTTP_FETCH_FAILED with the cause message on a DNS miss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: new Error('getaddrinfo ENOTFOUND no-such-host.invalid'),
        })
      }),
    )

    await expect(handler.resolve(envWith('https://no-such-host.invalid/x'), '')).rejects.toMatchObject(
      {
        code: 'URL_HTTP_FETCH_FAILED',
        message: expect.stringContaining('getaddrinfo ENOTFOUND no-such-host.invalid'),
      },
    )
  })
})

describe('createHttpHandler: URL validation', () => {
  it.each(['https://', 'http://[bad-ipv6', 'notaurl'])(
    'raises URL_INVALID for raw URL "%s"',
    async (rawUrl) => {
      await expect(handler.resolve(envWith(rawUrl), '')).rejects.toMatchObject({
        code: 'URL_INVALID',
      })
    },
  )

  it('raises URL_INVALID for a non-http(s) raw URL', async () => {
    await expect(handler.resolve(envWith('ftp://example.com/x'), '')).rejects.toMatchObject({
      code: 'URL_INVALID',
      message: expect.stringContaining('not an http(s) URL'),
    })
  })

  it('raises URL_INVALID when the fallback path cannot form a URL', async () => {
    await expect(handler.resolve({}, '')).rejects.toMatchObject({ code: 'URL_INVALID' })
  })
})

describe('http/https scheme routing', () => {
  it('routes both schemes to the one handler instance through the resolver', async () => {
    const resolver = new UrlResolver()
    for (const scheme of HTTP_SCHEMES) {
      resolver.register(scheme, handler)
    }
    const fetchMock = vi.fn(async (input?: unknown, _init?: RequestInit) =>
      textResponse(`body-of ${String(input)}`),
    )
    vi.stubGlobal('fetch', fetchMock)

    const httpEnv: HttpResolverEnv = { rawUrl: 'http://plain.example.com/a' }
    const httpsEnv: HttpResolverEnv = { rawUrl: 'https://secure.example.com/b' }
    const httpOut = await resolver.resolve(httpEnv, 'http://plain.example.com/a')
    const httpsOut = await resolver.resolve(httpsEnv, 'https://secure.example.com/b')

    expect(httpOut).toBe(`${DISCLAIMER}\n\nbody-of http://plain.example.com/a`)
    expect(httpsOut).toBe(`${DISCLAIMER}\n\nbody-of https://secure.example.com/b`)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('http through UrlResolver: selector exemption', () => {
  // Regression: parseUrl once treated the first `:`/`?` after `scheme://`
  // as a selector marker, so `:8443` (a port) threw URL_BAD_SELECTOR and
  // `?q=…` (a server query) was applied as the resolver's line filter,
  // silently eating the disclaimer. http(s) must be selector-exempt: the
  // whole remainder is the path. These tests go through the REAL
  // UrlResolver.resolve — the handler-direct tests above cannot catch this.

  /** Resolver with the http handler registered under both schemes, as index.ts wires it. */
  function resolverWithHttp(): UrlResolver {
    const r = new UrlResolver()
    for (const scheme of HTTP_SCHEMES) r.register(scheme, handler)
    return r
  }

  it('resolves a port URL end-to-end without URL_BAD_SELECTOR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse('port body')),
    )
    const out = await resolverWithHttp().resolve(
      { rawUrl: 'https://example.com:8443/doc' },
      'https://example.com:8443/doc',
    )
    expect(out).toBe(`${DISCLAIMER}\n\nport body`)
  })

  it('treats a query string as part of the URL, never a content filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => textResponse('alpha line\nbeta line\ngamma one')),
    )
    const out = await resolverWithHttp().resolve(
      { rawUrl: 'https://example.com/doc?q=one' },
      'https://example.com/doc?q=one',
    )
    // The disclaimer line and every body line survive — no ?q= filtering.
    expect(out).toBe(`${DISCLAIMER}\n\nalpha line\nbeta line\ngamma one`)
  })

  it('parses port and query URLs with no selector at all', async () => {
    const { parseUrl } = await import('../../src/url-schema/selector.ts')
    expect(parseUrl('http://h.example:8080/a?b=c')).toEqual({
      scheme: 'http',
      path: 'h.example:8080/a?b=c',
      selector: null,
    })
    expect(parseUrl('https://plain.example/x')).toEqual({
      scheme: 'https',
      path: 'plain.example/x',
      selector: null,
    })
  })
})
