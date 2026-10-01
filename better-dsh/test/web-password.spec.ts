import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// The REAL native implementation, imported from the upstream source export —
// the point of these tests is that this row mints and accepts exactly what the
// native verifier does, so the oracle is the shipped class, not a copy of it.
import { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import {
  apply as applyGate,
  cookieName,
  decodeBase64Url,
  decodeSessionCookie,
  encodeBase64Url,
  encodeSessionCookie,
  loginPage,
  parsePasswordPayload,
  seedPasswordPayload,
  sessionAuthenticated,
  verifyPassword,
  withBaseHref,
} from '../src/web-password.ts'
import { internals as webAppInternals } from '@deepseek-ai/dsh-web-app'

const DAY = 24 * 60 * 60 * 1000
const AUTHORITY = 'dsh.example:3080'

interface Captured {
  status?: number
  headers?: Readonly<Record<string, string>>
  ended: boolean
}

/** Minimal credential seam over a Map: the two methods this row and the native class use. */
function stubProvider(store: Map<string, CredentialRecord>): CredentialProvider {
  return {
    readRecord: async (key: CredentialKey) => store.get(key as unknown as string),
    modifyRecord: async (
      key: CredentialKey,
      mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
    ) => {
      const current = store.get(key as unknown as string)
      const next = await mutate(current)
      if (next !== undefined) store.set(key as unknown as string, next)
      return next ?? current
    },
  } as unknown as CredentialProvider
}

function sessionStore(secret: Buffer): Map<string, CredentialRecord> {
  return new Map([[
    'client-connection/browser-session',
    { kind: 'grant', payload: { version: 1, secret: encodeBase64Url(secret) } },
  ]])
}

function capturingResponse(): { captured: Captured; response: { writeHead: (s: number, h?: Record<string, string>) => void; end: () => void } } {
  const captured: Captured = { ended: false }
  return {
    captured,
    response: {
      writeHead: (status, headers) => { captured.status = status; captured.headers = headers },
      end: () => { captured.ended = true },
    },
  }
}

describe('base64url codec', () => {
  it('round-trips arbitrary bytes without padding', () => {
    const bytes = randomBytes(32)
    const encoded = encodeBase64Url(bytes)
    expect(encoded).not.toContain('=')
    expect(decodeBase64Url(encoded)?.equals(bytes)).toBe(true)
  })

  it('rejects non-canonical encoding instead of normalizing it', () => {
    expect(decodeBase64Url('a+b')).toBeUndefined()
    expect(decodeBase64Url('a/b')).toBeUndefined()
    expect(decodeBase64Url('abcd=')).toBeUndefined()
    expect(decodeBase64Url('a')).toBeUndefined()
    expect(decodeBase64Url('')).toBeDefined()
  })
})

describe('native cookie format', () => {
  const secret = randomBytes(32)

  it('derives the cookie name from the authority, natively', () => {
    const name = cookieName(AUTHORITY)
    expect(name.startsWith('dsh-auth-')).toBe(true)
    expect(name).toBe(cookieName(AUTHORITY))
    expect(name).not.toBe(cookieName('other.example'))
  })

  it('round-trips a minted cookie', () => {
    const now = Date.now()
    const payload = { version: 1 as const, authority: AUTHORITY, issuedAt: now, expiresAt: now + 30 * DAY }
    const value = encodeSessionCookie(payload, secret)
    expect(value.startsWith('v1.')).toBe(true)
    expect(decodeSessionCookie(value, secret)).toEqual(payload)
  })

  it('refuses a tampered body, a tampered signature, and a foreign key', () => {
    const now = Date.now()
    const payload = { version: 1 as const, authority: AUTHORITY, issuedAt: now, expiresAt: now + DAY }
    const value = encodeSessionCookie(payload, secret)
    const [version, body, sig] = value.split('.') as [string, string, string]
    const forged = encodeBase64Url(Buffer.from(JSON.stringify({ ...payload, authority: 'evil.example' }), 'utf8'))
    expect(decodeSessionCookie(`${version}.${forged}.${sig}`, secret)).toBeUndefined()
    expect(decodeSessionCookie(`${version}.${body}.${encodeBase64Url(randomBytes(32))}`, secret)).toBeUndefined()
    expect(decodeSessionCookie(value, randomBytes(32))).toBeUndefined()
    expect(decodeSessionCookie('garbage', secret)).toBeUndefined()
  })

  it('accepts only a live, correctly bound cookie for the request authority', () => {
    const now = Date.now()
    const live = encodeSessionCookie(
      { version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + DAY }, secret,
    )
    const headers = (host: string, value: string | undefined) => (value === undefined
      ? { host }
      : { host, cookie: `${cookieName(host)}=${value}` })

    expect(sessionAuthenticated(headers(AUTHORITY, live), secret, 30 * DAY)).toBe(true)
    expect(sessionAuthenticated(headers(AUTHORITY, undefined), secret, 30 * DAY)).toBe(false)
    expect(sessionAuthenticated(headers('other.example', live), secret, 30 * DAY)).toBe(false)

    const expired = encodeSessionCookie(
      { version: 1, authority: AUTHORITY, issuedAt: now - 2 * DAY, expiresAt: now - DAY }, secret,
    )
    expect(sessionAuthenticated(headers(AUTHORITY, expired), secret, 30 * DAY)).toBe(false)

    const tooLong = encodeSessionCookie(
      { version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 400 * DAY }, secret,
    )
    expect(sessionAuthenticated(headers(AUTHORITY, tooLong), secret, 30 * DAY)).toBe(false)
  })
})

describe('interoperability with the shipped native class', () => {
  it('mints a cookie the native verifier accepts', async () => {
    const secret = randomBytes(32)
    const auth = await BrowserAuth.create({}, stubProvider(sessionStore(secret)), 30)
    const now = Date.now()
    const value = encodeSessionCookie(
      { version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 30 * DAY }, secret,
    )
    expect(auth.isAuthenticated({ headers: { host: AUTHORITY, cookie: `${cookieName(AUTHORITY)}=${value}` } }))
      .toBe(true)
    // And the negative: a wrong authority cookie is refused by the native check too.
    expect(auth.isAuthenticated({ headers: { host: AUTHORITY, cookie: `${cookieName('other.example')}=${value}` } }))
      .toBe(false)
  })

  it('accepts the cookie the native token exchange mints', async () => {
    const secret = randomBytes(32)
    const auth = await BrowserAuth.create({}, stubProvider(sessionStore(secret)), 30)
    const tokenized = new URL(auth.authenticatedUrl(`http://${AUTHORITY}/`))
    const token = tokenized.searchParams.get('token')
    expect(token).not.toBeNull()

    const { captured, response } = capturingResponse()
    const served = auth.authorizeIndex(
      { url: `/?token=${String(token)}`, method: 'GET', headers: { host: AUTHORITY } },
      response,
    )
    expect(served).toBe(false)
    expect(captured.status).toBe(303)
    const setCookie = captured.headers?.['set-cookie'] ?? ''
    const value = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
    // The native exchange minted it; this row must recognize it as a session.
    expect(decodeSessionCookie(value, secret)?.authority).toBe(AUTHORITY)
    expect(sessionAuthenticated(
      { host: AUTHORITY, cookie: `${cookieName(AUTHORITY)}=${value}` }, secret, 30 * DAY,
    )).toBe(true)
  })
})

describe('password record', () => {
  it('seeds the default and verifies only the exact password', async () => {
    const payload = await seedPasswordPayload('admin')
    expect(await verifyPassword('admin', payload)).toBe(true)
    expect(await verifyPassword('Admin', payload)).toBe(false)
    expect(await verifyPassword('', payload)).toBe(false)
    expect(payload.algorithm).toBe('scrypt')
    expect(payload.keylen).toBe(32)
  })

  it('salts every seed independently', async () => {
    const [a, b] = await Promise.all([seedPasswordPayload('admin'), seedPasswordPayload('admin')])
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it('rejects a malformed hash as a failed check, not a crash', async () => {
    const payload = await seedPasswordPayload('admin')
    expect(await verifyPassword('admin', { ...payload, hash: 'not base64url!' })).toBe(false)
  })

  it('reads a stored payload and refuses unsupported or invalid ones loudly', () => {
    const good: CredentialRecord = {
      kind: 'grant',
      payload: { version: 1, algorithm: 'scrypt', salt: encodeBase64Url(randomBytes(16)), hash: encodeBase64Url(randomBytes(32)), N: 16384, r: 8, p: 1, keylen: 32 },
    }
    expect(parsePasswordPayload(undefined)).toBeUndefined()
    expect(parsePasswordPayload(good)?.algorithm).toBe('scrypt')
    expect(() => parsePasswordPayload({ kind: 'grant', payload: { version: 2 } })).toThrow()
    expect(() => parsePasswordPayload({ kind: 'grant', payload: { version: 1, algorithm: 'md5' } })).toThrow()
    expect(() => parsePasswordPayload({ kind: 'api-key' })).toThrow()
  })
})

describe('sign-in page', () => {
  it('escapes the notice it renders', () => {
    expect(loginPage('<script>alert(1)</script>')).toContain('&lt;script&gt;')
    expect(loginPage()).not.toContain('class="notice"')
  })

  it('posts back to the root and carries no external resource', () => {
    const html = loginPage()
    expect(html).toContain('action="/"')
    expect(html).toContain('type="password"')
    expect(html).not.toMatch(/https?:\/\//u)
  })
})

describe('index rendering at the root', () => {
  it('inserts the relative base exactly as the native fallback owner does', () => {
    expect(withBaseHref('<html><head><title>x</title></head></html>'))
      .toBe('<html><head><base href="./"><title>x</title></head></html>')
    expect(withBaseHref('<html><head lang="en">y</head></html>'))
      .toBe('<html><head lang="en"><base href="./">y</head></html>')
    expect(withBaseHref('<html>no head</html>')).toBe('<html>no head</html>')
  })
})

/**
 * End-to-end over the real plugin `apply`, with the smallest host that can
 * carry it: a route table, a renderer, and the credential stub. The dist index
 * is a temp file injected through the Web runtime's own `internals` seam, so
 * the suite never depends on a built frontend.
 */
describe('root gate over a fake host', () => {
  const store = new Map<string, CredentialRecord>()
  let tempDir = ''
  let originalResolve: () => string

  beforeEach(() => {
    store.clear()
    store.set('client-connection/browser-session', {
      kind: 'grant', payload: { version: 1, secret: encodeBase64Url(randomBytes(32)) },
    })
    tempDir = mkdtempSync(join(tmpdir(), 'dashr-web-password-'))
    const distIndex = join(tempDir, 'index.html')
    writeFileSync(distIndex, '<html><head><!-- dsh-index-injections --></head><body>app</body></html>')
    originalResolve = webAppInternals.resolveDistIndex
    webAppInternals.resolveDistIndex = () => distIndex
  })

  afterEach(() => {
    webAppInternals.resolveDistIndex = originalResolve
    rmSync(tempDir, { recursive: true, force: true })
  })

  interface FakeRoute {
    kind: string
    path: string
    handler: (req: unknown, res: unknown) => void | Promise<void>
  }

  function fakeHost(): { ctx: never, route: () => FakeRoute } {
    const routes = new Map<string, FakeRoute>()
    const ctx = {
      logger: () => ({ info: () => {}, warn: () => {} }),
      credentials: stubProvider(store),
      webServer: {
        register: (route: FakeRoute) => {
          routes.set(route.path, route)
          return () => { routes.delete(route.path) }
        },
        renderIndex: (html: string) => html.replace('<!-- dsh-index-injections -->', 'INJECTED'),
      },
      inject: (_deps: string[], callback: (scoped: unknown) => void) => { callback(ctx) },
      effect: (fn: () => unknown) => { fn() },
    }
    applyGate(ctx as never, undefined)
    return {
      ctx: ctx as never,
      route: () => {
        const route = routes.get('/')
        if (route === undefined) throw new Error('the gate did not claim exact /')
        return route
      },
    }
  }

  interface Captured {
    status: number
    headers: Record<string, string>
    body?: string
  }

  function response(): { captured: Captured, res: never } {
    const captured: Captured = { status: 0, headers: {} }
    const res = {
      writeHead: (status: number, headers?: Record<string, string>) => {
        captured.status = status
        Object.assign(captured.headers, headers ?? {})
      },
      end: (body?: string) => { captured.body = body },
    }
    return { captured, res: res as never }
  }

  function request(method: string, headers: Record<string, string>, body?: string): never {
    const listeners = new Map<string, ((chunk?: Buffer) => void)[]>()
    const req = {
      method, url: '/', headers, socket: { remoteAddress: '127.0.0.1' },
      on: (event: string, fn: (chunk?: Buffer) => void) => {
        const list = listeners.get(event) ?? []
        list.push(fn)
        listeners.set(event, list)
        if (event === 'data' && body !== undefined) queueMicrotask(() => { fn(Buffer.from(body)) })
        if (event === 'end') queueMicrotask(() => { fn() })
        return req
      },
      destroy: () => {},
    }
    return req as never
  }

  it('answers an unauthenticated root with the sign-in page and no cookie', async () => {
    const { route } = fakeHost()
    const { captured, res } = response()
    await route().handler(request('GET', { host: AUTHORITY }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toContain('action="/"')
    expect(captured.headers['set-cookie']).toBeUndefined()
  })

  it('treats a launch token on the root as no door at all', async () => {
    const { route } = fakeHost()
    const { captured, res } = response()
    await route().handler(request('GET', { host: AUTHORITY, 'x-token': 'ignored' }), res)
    expect(captured.status).toBe(200)
    expect(captured.headers['set-cookie']).toBeUndefined()
  })

  it('mints the native cookie and redirects to / (not /index.html)', async () => {
    const { route } = fakeHost()
    const { captured, res } = response()
    await route().handler(request('POST', { host: AUTHORITY }, 'password=admin'), res)
    expect(captured.status).toBe(303)
    expect(captured.headers['location']).toBe('/')
    const setCookie = captured.headers['set-cookie'] ?? ''
    expect(setCookie).toContain('HttpOnly')
    const value = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
    const sessionRecord = store.get('client-connection/browser-session') as { payload: { secret: string } }
    const secret = decodeBase64Url(sessionRecord.payload.secret)!

    expect(sessionAuthenticated(
      { host: AUTHORITY, cookie: `${cookieName(AUTHORITY)}=${value}` }, secret, 30 * DAY,
    )).toBe(true)
  })

  it('serves the SPA index at / for a signed-in browser, with no redirect', async () => {
    const { route } = fakeHost()
    const login = response()
    await route().handler(request('POST', { host: AUTHORITY }, 'password=admin'), login.res)
    const setCookie = login.captured.headers['set-cookie'] ?? ''
    const value = setCookie.slice(setCookie.indexOf('=') + 1, setCookie.indexOf(';'))
    const { captured, res } = response()
    await route().handler(
      request('GET', { host: AUTHORITY, cookie: `${cookieName(AUTHORITY)}=${value}` }), res,
    )
    expect(captured.status).toBe(200)
    expect(captured.headers['location']).toBeUndefined()
    expect(captured.body).toContain('INJECTED')
    expect(captured.body).toContain('<base href="./">')
  })

  it('refuses a wrong password without minting anything', async () => {
    const { route } = fakeHost()
    const { captured, res } = response()
    await route().handler(request('POST', { host: AUTHORITY }, 'password=nope'), res)
    expect(captured.status).toBe(401)
    expect(captured.headers['set-cookie']).toBeUndefined()
  })
})
