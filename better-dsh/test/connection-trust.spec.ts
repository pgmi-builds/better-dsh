import { Context } from '@deepseek-ai/cordis'
import * as nativeConnection from '@deepseek-ai/dsh-client-connection'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyTrust } from '../src/web-trust.ts'

const roots: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await root.fiber.dispose()
})

async function mounted() {
  const root = new Context()
  roots.push(root)
  const records = new Map<CredentialKey, CredentialRecord>()
  root.provide('credentials', {
    readRecord: async (key: CredentialKey) => records.get(key),
    modifyRecord: async (key: CredentialKey, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const current = records.get(key)
      const next = await mutate(current)
      if (next !== undefined) records.set(key, next)
      return next ?? current
    },
  } as CredentialProvider)
  const native = root.plugin(nativeConnection, { trustedHosts: [], cookieMaxAgeDays: 1 })
  await native.await()
  return { root, connection: root.connection }
}

function cookieFor(connection: nativeConnection.HostConnectionHandle, host: string): string {
  const url = new URL(connection.authenticatedUrl(`http://${host}/`))
  let cookie: string | undefined
  connection.authorizeIndex({ headers: { host }, method: 'GET', url: `${url.pathname}${url.search}` }, {
    writeHead(_status, headers) { cookie = headers?.['set-cookie']?.split(';', 1)[0] },
    end() {},
  })
  if (cookie === undefined) throw new Error('native token exchange did not mint a cookie')
  return cookie
}

describe('authentication-only connection admission', () => {
  it('accepts authenticated hosts and origins absent from the native allowlist, and restores the fence on unload', async () => {
    const { root, connection } = await mounted()
    const host = 'unlisted.example:4999'
    const headers = { host, cookie: cookieFor(connection, host), origin: 'https://other.example', 'sec-fetch-site': 'cross-site' }
    expect(connection.requestRejection({ headers })).toBe(403)
    const trust = root.plugin({ apply: applyTrust }, { trustAllHosts: true })
    await trust.await()
    expect(connection.admit({ headers })).toHaveProperty('peer')
    expect(connection.requestRejection({ headers: new Headers(headers) })).toBeUndefined()
    await trust.dispose()
    expect(connection.requestRejection({ headers })).toBe(403)
  })

  it('still rejects missing, invalid, wrong-authority and expired cookies using the native lifetime', async () => {
    const { root, connection } = await mounted()
    const host = '192.168.31.130:4999'
    const cookie = cookieFor(connection, host)
    const trust = root.plugin({ apply: applyTrust }, { trustAllHosts: true })
    await trust.await()
    expect(connection.requestRejection({ headers: { host, cookie } })).toBeUndefined()
    expect(connection.requestRejection({ headers: { host } })).toBe(401)
    expect(connection.requestRejection({ headers: { host, cookie: cookie + 'tampered' } })).toBe(401)
    expect(connection.requestRejection({ headers: { host: 'other.example:4999', cookie } })).toBe(401)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 24 * 60 * 60 * 1000)
    expect(connection.requestRejection({ headers: { host, cookie } })).toBe(401)
  })

  it('keeps native admission when the mode is not enabled', async () => {
    const { root, connection } = await mounted()
    const host = 'unlisted.example:4999'
    const trust = root.plugin({ apply: applyTrust }, {})
    await trust.await()
    expect(connection.requestRejection({ headers: { host, cookie: cookieFor(connection, host) } })).toBe(403)
  })
})
