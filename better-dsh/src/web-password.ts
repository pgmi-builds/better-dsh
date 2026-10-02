/**
 * `dashr-web-password` — the browser session gate: a password stands in for the
 * native launch-token exchange, and the cookie it mints is the native one.
 *
 * The native flow hands the operator a per-boot `?token=` URL. Exchanging that
 * token mints a signed browser cookie (`dsh-auth-<hash-of-authority>` carrying
 * `v1.<payload>.<hmac>` over `{version, authority, issuedAt, expiresAt}`) whose
 * HMAC key is durable in this Harness home's credential store under
 * `client-connection/browser-session`. The launch token itself is process
 * memory (a private WeakMap inside `@deepseek-ai/dsh-client-connection`), so no
 * plugin can mint a session by way of it — but the COOKIE is a fully specified
 * durable artifact and its key is readable through the credential seam. This
 * row therefore mints the native cookie itself, after a password check; the
 * token is not weakened, it is simply never the only door.
 *
 * The seam is the webserver's exact-route table. Dispatch is exact → longest
 * prefix → fallback, and no row claims exact `/`. The fallback owner serves the
 * SPA and authenticates only its index responses through
 * `ctx.connection.authorizeIndex` — the sole place a launch token is exchanged,
 * and only for `GET /` with exactly one `token` query parameter. Owning exact
 * `/` therefore retires the token path. An authenticated `GET /` is answered here
 * by rendering the SPA index itself — with the Web runtime's own dist resolver
 * and the same `<base href="./">` insertion the fallback owner applies — so
 * sign-in costs no redirect and the browser URL stays the clean `/?`-free `/`.
 * `/index.html` and every other path keep going through the native verifier
 * (which passes, because this row's cookie is native-format). `/api` is
 * untouched: `connection.admit` runs the native `isAuthenticated` against the
 * same cookie.
 * the native verifier and passes because this row's cookie is native-format.
 * `/api` is untouched: `connection.admit` runs the native `isAuthenticated`
 * against the same cookie.
 *
 * The password is one credential record (`dashr-web-password/passphrase`, a
 * scrypt hash). It is seeded on first activation with the well-known default
 * `admin`, so a fresh home has no setup step; rotating it means replacing that
 * record — no UI, no CLI, no config schema for it.
 *
 * Fail-closed: while the session secret or the password record cannot be read,
 * every request answers 503 rather than a page.
 *
 * @module better-dsh/web-password
 */

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { } from '@deepseek-ai/dsh-host-webserver'
import z from '#schemastery'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000

/** Length of the native browser-session HMAC key. */
const SECRET_BYTES = 32
/** Native cookie name prefix; the rest is the base64url SHA-256 of the authority. */
const COOKIE_PREFIX = 'dsh-auth-'
/** Native cookie envelope version. */
const COOKIE_PAYLOAD_VERSION = 1
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

const SALT_BYTES = 16
const HASH_BYTES = 32
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const PASSWORD_RECORD_VERSION = 1

/** The seeded password a fresh home starts with (no setup step). */
const DEFAULT_PASSWORD = 'admin'
const DEFAULT_COOKIE_MAX_AGE_DAYS = 30
/**
 * Native `browser-auth` rejects a cookie whose lifetime exceeds its own
 * `cookieMaxAgeDays` (default 30), so a longer lifetime here would mint a
 * cookie the verifier refuses. Cap at the upstream default.
 */
const MAX_COOKIE_MAX_AGE_DAYS = 30

/** A login form is a few hundred bytes; anything larger is not one. */
const MAX_FORM_BYTES = 4096
/** Failed attempts tolerated per peer before the backoff starts. */
const FREE_FAILURES = 5
const BASE_BACKOFF_MILLISECONDS = 2_000
const MAX_BACKOFF_MILLISECONDS = 60_000

/** The native browser-session signing secret (owned by `client-connection`). */
const SESSION_RECORD_KEY = credentialKey('client-connection', 'browser-session')
/** This row's own password record. */
const PASSWORD_RECORD_KEY = credentialKey('dashr-web-password', 'passphrase')

/** What the native verifier expects inside a browser cookie. */
export interface BrowserCookiePayload {
  readonly version: typeof COOKIE_PAYLOAD_VERSION
  readonly authority: string
  readonly issuedAt: number
  readonly expiresAt: number
}

/** This row's stored password record payload. */
export interface StoredPasswordPayload {
  readonly version: typeof PASSWORD_RECORD_VERSION
  readonly algorithm: 'scrypt'
  /** base64url salt. */
  readonly salt: string
  /** base64url derived key. */
  readonly hash: string
  readonly N: number
  readonly r: number
  readonly p: number
  readonly keylen: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** base64url-encode bytes without padding (the native cookie's alphabet). */
export function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

/**
 * Decode a canonical base64url string; non-canonical input is rejected rather
 * than silently normalized, which is what makes a tampered payload fail closed.
 * @param value - the candidate string.
 * @returns the bytes, or `undefined` when it is not canonical base64url.
 */
export function decodeBase64Url(value: string): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) return undefined
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
  return encodeBase64Url(decoded) === value ? decoded : undefined
}

/**
 * The native cookie name for one request authority.
 * @param authority - canonical `host` or `host:port`.
 * @returns the cookie name.
 */
export function cookieName(authority: string): string {
  return COOKIE_PREFIX + encodeBase64Url(createHash('sha256').update(authority).digest())
}

function signature(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest()
}

/**
 * Mint a native-format browser-session cookie value.
 * @param payload - the session claims.
 * @param secret - the native signing key.
 * @returns `v1.<base64url payload>.<base64url HMAC>`.
 */
export function encodeSessionCookie(payload: BrowserCookiePayload, secret: Buffer): string {
  const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `v1.${body}.${encodeBase64Url(signature(secret, body))}`
}

/**
 * Verify and decode a native-format browser-session cookie value.
 * @param value - the cookie value.
 * @param secret - the native signing key.
 * @returns the claims, or `undefined` when the envelope, signature, or shape fails.
 */
export function decodeSessionCookie(value: string, secret: Buffer): BrowserCookiePayload | undefined {
  const parts = value.split('.')
  const [version, body, encodedSignature] = parts
  if (parts.length !== 3 || version !== 'v1' || body === undefined || encodedSignature === undefined) {
    return undefined
  }
  const actualSignature = decodeBase64Url(encodedSignature)
  if (actualSignature === undefined) return undefined
  const expectedSignature = signature(secret, body)
  if (actualSignature.byteLength !== expectedSignature.byteLength
    || !timingSafeEqual(actualSignature, expectedSignature)) return undefined
  let decoded: unknown
  try {
    const bodyBytes = decodeBase64Url(body)
    if (bodyBytes === undefined) return undefined
    decoded = JSON.parse(bodyBytes.toString('utf8'))
  } catch {
    return undefined
  }
  if (!isRecord(decoded)
    || decoded.version !== COOKIE_PAYLOAD_VERSION
    || typeof decoded.authority !== 'string'
    || !Number.isSafeInteger(decoded.issuedAt)
    || !Number.isSafeInteger(decoded.expiresAt)) return undefined
  return decoded as unknown as BrowserCookiePayload
}

function header(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Canonical request authority: the native cookie name and its signed audience.
 * @param headers - the incoming request headers.
 * @returns `host` or `host:port`, lowercased, or `undefined` without a usable Host.
 */
export function requestAuthority(headers: IncomingMessage['headers']): string | undefined {
  const host = header(headers, 'host')
  if (host === undefined) return undefined
  try {
    return new URL(`http://${host}`).host
  } catch {
    return undefined
  }
}

/** Read the exact generated cookie without implementing general Cookie decoding. */
function cookieValue(headerValue: string, name: string): string | undefined {
  for (const segment of headerValue.split(';')) {
    const at = segment.indexOf('=')
    if (at === -1 || segment.slice(0, at).trim() !== name) continue
    return segment.slice(at + 1).trim()
  }
  return undefined
}

/**
 * Serialize the fixed browser-session attributes; generated names and values
 * are cookie-safe base64url. Mirrors the native attribute set exactly.
 */
export function sessionCookieHeader(
  name: string,
  value: string,
  expiresAt: number,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Max-Age=${String(maxAgeSeconds)}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
}

/**
 * Verify the native browser cookie on one request, with the native checks:
 * authority binding, issued/expiry window, and a lifetime no longer than ours.
 * @param headers - incoming request headers carrying Host and Cookie.
 * @param secret - the native signing key.
 * @param maxAgeMilliseconds - the longest lifetime this deployment accepts.
 * @returns true only for a live cookie signed by the native key for this authority.
 */
export function sessionAuthenticated(
  headers: IncomingMessage['headers'],
  secret: Buffer,
  maxAgeMilliseconds: number,
): boolean {
  const authority = requestAuthority(headers)
  const rawCookie = header(headers, 'cookie')
  if (authority === undefined || rawCookie === undefined) return false
  const value = cookieValue(rawCookie, cookieName(authority))
  if (value === undefined) return false
  const payload = decodeSessionCookie(value, secret)
  if (payload === undefined || payload.authority !== authority) return false
  const now = Date.now()
  return payload.issuedAt <= now
    && payload.expiresAt > now
    && payload.expiresAt > payload.issuedAt
    && payload.expiresAt - payload.issuedAt <= maxAgeMilliseconds
}

/**
 * Derive the scrypt key for one password.
 * @param password - the submitted password.
 * @param payload - salt and work factors.
 * @returns the derived key.
 */
export function derivePasswordKey(
  password: string,
  payload: Pick<StoredPasswordPayload, 'salt' | 'N' | 'r' | 'p' | 'keylen'>,
): Promise<Buffer> {
  const salt = decodeBase64Url(payload.salt)
  if (salt === undefined) return Promise.reject(new Error('dashr-web-password: stored salt is not base64url'))
  return new Promise((resolve, reject) => {
    scrypt(password, salt, payload.keylen, { N: payload.N, r: payload.r, p: payload.p }, (error, key) => {
      if (error !== null) reject(error)
      else resolve(key)
    })
  })
}

/**
 * Constant-time password check against a stored payload.
 * @param password - the submitted password.
 * @param payload - the stored record.
 * @returns true only on an exact match.
 */
export async function verifyPassword(password: string, payload: StoredPasswordPayload): Promise<boolean> {
  const expected = decodeBase64Url(payload.hash)
  if (expected === undefined) return false
  const actual = await derivePasswordKey(password, payload)
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}

/**
 * Build a fresh stored payload for one password (random salt).
 * @param password - the password to store.
 * @returns the payload to write into the credential record.
 */
export async function seedPasswordPayload(password: string): Promise<StoredPasswordPayload> {
  const salt = randomBytes(SALT_BYTES)
  const base: StoredPasswordPayload = {
    version: PASSWORD_RECORD_VERSION,
    algorithm: 'scrypt',
    salt: encodeBase64Url(salt),
    hash: '',
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keylen: HASH_BYTES,
  }
  const key = await derivePasswordKey(password, base)
  return { ...base, hash: encodeBase64Url(key) }
}

/**
 * Interpret one password record; a present-but-unsupported record is loud
 * (fail closed) rather than silently treated as absent.
 * @param record - the stored record, when any.
 * @returns the payload, or `undefined` when no record is stored.
 */
export function parsePasswordPayload(record: CredentialRecord | undefined): StoredPasswordPayload | undefined {
  if (record === undefined) return undefined
  if (record.kind !== 'grant' || !isRecord(record.payload) || record.payload.version !== PASSWORD_RECORD_VERSION) {
    throw new Error('dashr-web-password: password record has an unsupported format')
  }
  const payload = record.payload
  const integers = [payload.N, payload.r, payload.p, payload.keylen]
  if (payload.algorithm !== 'scrypt'
    || typeof payload.salt !== 'string' || typeof payload.hash !== 'string'
    || !integers.every(value => Number.isSafeInteger(value) && (value as number) > 0)) {
    throw new Error('dashr-web-password: password record has an invalid payload')
  }
  if (decodeBase64Url(payload.salt) === undefined || decodeBase64Url(payload.hash) === undefined) {
    throw new Error('dashr-web-password: password record has invalid encoding')
  }
  return payload as unknown as StoredPasswordPayload
}

/**
 * Read the password record, seeding the well-known default when the home has
 * none. Mirrors the native secret-initialization pattern: the create is
 * read-decide-replace under the provider's lock, so two processes racing on a
 * fresh home converge on one record.
 * @param provider - the credential seam.
 * @returns the stored password payload.
 */
async function loadOrSeedPassword(provider: CredentialProvider): Promise<StoredPasswordPayload> {
  const existing = parsePasswordPayload(await provider.readRecord(PASSWORD_RECORD_KEY))
  if (existing !== undefined) return existing
  const generated = await seedPasswordPayload(DEFAULT_PASSWORD)
  const record = await provider.modifyRecord(PASSWORD_RECORD_KEY, (current) => {
    if (current !== undefined) return Promise.resolve(undefined)
    return Promise.resolve({ kind: 'grant', payload: generated } satisfies CredentialRecord)
  })
  const parsed = parsePasswordPayload(record)
  if (parsed === undefined) throw new Error('dashr-web-password: password record was not created')
  return parsed
}

/**
 * Read the native browser-session signing key that `client-connection` created
 * during its own activation.
 * @param provider - the credential seam.
 * @returns the 32-byte key.
 */
async function loadSessionSecret(provider: CredentialProvider): Promise<Buffer> {
  const record = await provider.readRecord(SESSION_RECORD_KEY)
  if (record === undefined) {
    throw new Error('dashr-web-password: no client-connection/browser-session record; nothing to mint with')
  }
  if (record.kind !== 'grant' || !isRecord(record.payload) || record.payload.version !== 1) {
    throw new Error('dashr-web-password: browser-session record has an unsupported format')
  }
  const secret = record.payload.secret
  if (typeof secret !== 'string') {
    throw new Error('dashr-web-password: browser-session record has no secret')
  }
  const decoded = decodeBase64Url(secret)
  if (decoded === undefined || decoded.byteLength !== SECRET_BYTES) {
    throw new Error('dashr-web-password: browser-session record has an invalid secret')
  }
  return decoded
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

/**
 * The sign-in page. Server-rendered, self-contained, no external resource: it
 * is the only thing an unauthenticated request ever receives.
 * @param notice - optional failure text.
 * @returns the complete HTML document.
 */
export function loginPage(notice?: string): string {
  const banner = notice === undefined
    ? ''
    : `      <p class="notice">${escapeHtml(notice)}</p>\n`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>dsh web</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e6e8ec;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{width:min(22rem,calc(100vw - 3rem));padding:1.75rem;border:1px solid #262b36;border-radius:14px;background:#151922}
h1{margin:0 0 .25rem;font-size:1.05rem;letter-spacing:.02em}
p.sub{margin:0 0 1.25rem;font-size:.82rem;color:#8b93a5}
label{display:block;margin-bottom:.4rem;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:#8b93a5}
input{width:100%;padding:.65rem .75rem;border:1px solid #2c3341;border-radius:9px;background:#0f1115;color:inherit;font:inherit}
input:focus{outline:none;border-color:#4c8dff;box-shadow:0 0 0 3px #4c8dff26}
button{width:100%;margin-top:1rem;padding:.65rem;border:0;border-radius:9px;background:#4c8dff;color:#08101f;font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#6aa2ff}
.notice{margin:0 0 1rem;padding:.55rem .7rem;border:1px solid #5c2b33;border-radius:9px;background:#2a161a;color:#ffb4bd;font-size:.85rem}
</style>
</head>
<body>
<form method="post" action="/">
  <h1>dsh web</h1>
  <p class="sub">Enter the session password to continue.</p>
${banner}  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">Unlock</button>
</form>
</body>
</html>
`
}

/**
 * Resolve the dist index this composition serves, through the Web runtime's
 * own exported resolver. That keeps the dist anchor an assembly fact of
 * `@deepseek-ai/dsh-web-app` (which derives it from the installed frontend
 * package) instead of a copy of the path here. Imported lazily: this row is
 * dormant in any composition without a Web runtime, and must not require that
 * package to load.
 * @returns the absolute path of the served index.html.
 */
async function resolveDistIndex(): Promise<string> {
  const webApp = await import('@deepseek-ai/dsh-web-app')
  return webApp.internals.resolveDistIndex()
}

/**
 * Insert the relative base the served dist needs, exactly as the native
 * fallback owner does, so every asset reference resolves under the mount.
 * @param html - the rendered index markup.
 * @returns the markup with `<base href="./">` after the head open tag.
 */
export function withBaseHref(html: string): string {
  return html.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="./">`)
}

interface AttemptState {
  failures: number
  blockedUntil: number
}

interface GateState {
  readonly password: StoredPasswordPayload
  readonly secret: Buffer
  readonly maxAgeMilliseconds: number
}

/**
 * The root-route gate: one exact `/` handler owning the door, and the only
 * place a browser session is minted.
 */
class PasswordGate {
  private state: Promise<GateState> | undefined
  private distIndex: Promise<string> | undefined
  private readonly attempts = new Map<string, AttemptState>()
  private readonly log: ReturnType<Context['logger']>

  constructor(private readonly ctx: Context, private readonly maxAgeDays: number) {
    this.log = ctx.logger('dashr-web-password')
  }

  /** Start the durable reads so a misconfigured home is loud at activation. */
  warm(): void {
    void this.gateState().then(
      () => { this.log.info('password gate armed on GET/POST /') },
      (error: unknown) => { this.log.warn(`password gate not armed: ${messageOf(error)}`) },
    )
  }

  /** Memoized durable reads; a rejection is retained so every request fails closed. */
  private gateState(): Promise<GateState> {
    return this.state ??= (async () => ({
      password: await loadOrSeedPassword(this.ctx.credentials),
      secret: await loadSessionSecret(this.ctx.credentials),
      maxAgeMilliseconds: this.maxAgeDays * DAY_MILLISECONDS,
    }))()
  }

  /**
   * Serve the SPA index at `/` itself. The Web runtime's own resolver supplies
   * the dist anchor, so these are the bytes its fallback would have served for
   * this exact path — reached without a redirect, which is what keeps the
   * browser URL at `/` after sign-in.
   * @param res - the response this handler owns.
   * @param head - true for a HEAD request (headers only).
   */
  private async serveIndex(res: ServerResponse, head: boolean): Promise<void> {
    const distIndex = await (this.distIndex ??= resolveDistIndex())
    const body = withBaseHref(this.ctx.webServer.renderIndex(await readFile(distIndex, 'utf8')))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(head ? undefined : body)
  }

  /**
   * Serve one request on exact `/`.
   * @param req - the incoming request.
   * @param res - the response this handler owns.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const state = await this.gateState()
      if (req.method === 'POST') {
        await this.handleLogin(req, res, state)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'allow': 'GET, HEAD, POST', 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (sessionAuthenticated(req.headers, state.secret, state.maxAgeMilliseconds)) {
        try {
          await this.serveIndex(res, req.method === 'HEAD')
        } catch (error: unknown) {
          // Degrade to the redirect rather than the 503 door: only the dist
          // anchor failed, authentication itself is intact.
          this.log.warn(`serving the index at / failed, redirecting instead: ${messageOf(error)}`)
          this.distIndex = undefined
          redirect(res, '/index.html')
        }
        return
      }
      const head = req.method === 'HEAD'
      res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' })
      res.end(head ? undefined : loginPage())
    } catch (error: unknown) {
      this.log.warn(`password gate unavailable: ${messageOf(error)}`)
      res.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web: password gate unavailable (the browser-session secret or the password record is unreadable).\n')
    }
  }

  private async handleLogin(req: IncomingMessage, res: ServerResponse, state: GateState): Promise<void> {
    const authority = requestAuthority(req.headers)
    const peer = `${req.socket.remoteAddress ?? 'unknown'}|${authority ?? 'unknown'}`
    const now = Date.now()
    const blocked = this.attempts.get(peer)?.blockedUntil ?? 0
    if (blocked > now) {
      const retryAfter = Math.ceil((blocked - now) / 1000)
      this.respondForm(res, 429, loginPage(`Too many attempts. Try again in ${String(retryAfter)}s.`), {
        'retry-after': String(retryAfter),
      })
      return
    }
    let body: string
    try {
      body = await readFormBody(req, MAX_FORM_BYTES)
    } catch {
      this.respondForm(res, 413, loginPage('Request too large.'))
      return
    }
    if (authority === undefined) {
      this.respondForm(res, 400, loginPage('Malformed request.'))
      return
    }
    const password = new URLSearchParams(body).get('password') ?? ''
    if (password.length === 0 || !(await verifyPassword(password, state.password))) {
      this.recordFailure(peer, now)
      this.log.warn(`rejected password attempt from ${peer}`)
      this.respondForm(res, 401, loginPage('Wrong password.'))
      return
    }
    this.attempts.delete(peer)
    const issuedAt = Date.now()
    const expiresAt = issuedAt + state.maxAgeMilliseconds
    const value = encodeSessionCookie(
      { version: COOKIE_PAYLOAD_VERSION, authority, issuedAt, expiresAt },
      state.secret,
    )
    res.writeHead(303, {
      'cache-control': 'no-store',
      'location': '/',
      'referrer-policy': 'no-referrer',
      'set-cookie': sessionCookieHeader(
        cookieName(authority), value, expiresAt, Math.floor(state.maxAgeMilliseconds / 1000),
      ),
    })
    res.end()
    this.log.info(`minted a browser session for ${authority}`)
  }

  private respondForm(res: ServerResponse, status: number, html: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      ...extra,
    })
    res.end(html)
  }

  private recordFailure(peer: string, now: number): void {
    const failures = (this.attempts.get(peer)?.failures ?? 0) + 1
    const over = failures - FREE_FAILURES
    const blockedUntil = over <= 0
      ? 0
      : now + Math.min(BASE_BACKOFF_MILLISECONDS * 2 ** (over - 1), MAX_BACKOFF_MILLISECONDS)
    this.attempts.set(peer, { failures, blockedUntil })
  }
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { 'cache-control': 'no-store', 'location': location, 'referrer-policy': 'no-referrer' })
  res.end()
}

/** Read one urlencoded form body, refusing anything past the limit. */
function readFormBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('form body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Row config: the only knob is how long a minted session lives. */
export interface WebPasswordConfig {
  /** Absolute browser-session lifetime in days. Default: 30 (the native default). */
  cookieMaxAgeDays?: number
}

export const Config = z.object({
  cookieMaxAgeDays: z.natural().min(1).max(MAX_COOKIE_MAX_AGE_DAYS).default(DEFAULT_COOKIE_MAX_AGE_DAYS),
})

/** Cordis plugin name; also the scope of this row's credential record. */
export const name = 'dashr-web-password'

/**
 * No static injects: the gate is composed around `webServer`, `connection`
 * (which owns the session secret), and `credentials`, so a composition without
 * a browser surface loads this row dormant.
 */
export const inject: string[] = []

/**
 * Claim exact `/` and put the password in front of it.
 * @param ctx - host plugin context.
 * @param config - the row config.
 */
export function apply(ctx: Context, config?: WebPasswordConfig): void {
  const maxAgeDays = config?.cookieMaxAgeDays ?? DEFAULT_COOKIE_MAX_AGE_DAYS
  ctx.inject(['webServer', 'connection', 'credentials'], (scoped) => {
    const gate = new PasswordGate(scoped, maxAgeDays)
    gate.warm()
    scoped.effect(
      () => scoped.webServer.register({
        kind: 'exact',
        path: '/',
        handler: (req, res) => gate.handle(req, res),
      }),
      'dashr-web-password: root gate',
    )
  })
}

export default { name, inject, Config, apply }
