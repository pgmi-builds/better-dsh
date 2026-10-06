import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

/**
 * Use the native index authenticator as a cookie-only admission delegate.
 * A fixed, query-free index path prevents token exchange or redirects here;
 * original Host and Cookie headers preserve the native authority binding and
 * lifetime. No upstream private fields or cookie-format copies are needed.
 */
export function installAuthenticationOnlyAdmission(connection: HostConnectionHandle): () => void {
  const original = connection.requestRejection
  const response = { writeHead() {}, end() {} }
  connection.requestRejection = (request) => connection.authorizeIndex({
    headers: request.headers,
    method: 'GET',
    url: '/index.html',
  }, response) ? undefined : 401
  return () => { connection.requestRejection = original }
}
