/**
 * `dsh://` scheme handler: harness self-description via resolved settings and
 * static docs.
 *
 * Two resources, per design.md D3:
 * - `dsh://docs[/<doc>]` — harness documentation. Bare `dsh://docs` returns a
 *   JSON manifest (recursive list of readable doc paths); `dsh://docs/<doc>`
 *   returns the doc's text (a directory path yields that subtree's manifest).
 * - `dsh://config[/<namespace>]` — the current *resolved* user settings from
 *   `ctx.settings`. Bare `dsh://config` returns every registered namespace
 *   keyed by name; `dsh://config/<namespace>` returns one namespace. Secrets
 *   are stripped twice: schema-declared `role('secret')` fields via
 *   `SettingsProvider.describe({ redactSecrets: true })`, then a defensive
 *   key-name denylist (credentials / env / API key / token / password / …).
 *
 * Services required (supplied by the integration step through `deps`):
 * - `settings` — the `ctx.settings` service (`@deepseek-ai/dsh-settings`
 *   `SettingsProvider`), powers `dsh://config`.
 * - `docsDir` — optional absolute directory holding harness docs. When omitted,
 *   this handler falls back to `<package-root>/docs` and `<repo-root>/docs`.
 *   Docs are trusted harness text read directly from disk (not `ctx.fs`): the
 *   doc source is not a user file.
 */

import { promises as fsp, type Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type SettingsProvider from '@deepseek-ai/dsh-settings'

import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/** Services `createDshHandler` captures by closure and uses inside `resolve`. */
export interface DshHandlerDeps {
  /** `ctx.settings` seam (resolved user settings) powering `dsh://config`. */
  settings?: SettingsProvider
  /** Absolute directory holding harness docs powering `dsh://docs`. */
  docsDir?: string
}

/** File extensions considered readable harness documentation. */
const DOC_EXTENSIONS: Record<string, true> = {
  '.md': true,
  '.markdown': true,
  '.txt': true,
}

/**
 * Key-name patterns for the defensive secret denylist, matched against a
 * normalized key (lowercased, separators removed). Complements schema-declared
 * `role('secret')` redaction for fields a schema did not mark secret.
 */
const SECRET_KEY_PATTERNS: RegExp[] = [
  /secret/,
  /password/,
  /passwd/,
  /credential/,
  /token/,
  /apikey/,
  /authorization/,
  /privatekey/,
  /accesskey/,
]

/** True when a settings field name names credentials/env/API-key material. */
function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized === 'env' || normalized === 'environment') return true
  return SECRET_KEY_PATTERNS.some((re) => re.test(normalized))
}

/** Deep-copy a settings value, dropping every key the denylist names. */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key)) continue
      out[key] = stripSecrets(item)
    }
    return out
  }
  return value
}

/** True when `name` has a doc extension (case-insensitive). */
function isDocFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return DOC_EXTENSIONS[name.slice(dot).toLowerCase()] === true
}

/** Recursive, sorted list of readable doc paths relative to `dir`. */
async function listDocs(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const child of await listDocs(abs)) out.push(join(entry.name, child))
    } else if (isDocFile(entry.name)) {
      out.push(entry.name)
    }
  }
  return out
}

/** Read one `<doc>` path inside `dir`, guarding against path traversal. */
async function readDoc(dir: string, docPath: string): Promise<string> {
  const abs = resolve(dir, docPath)
  const rel = relative(dir, abs)
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new UrlSchemaError(
      'URL_DOC_NOT_FOUND',
      `dsh://docs/${docPath}: path escapes the docs directory`,
    )
  }

  let stat: Stats
  try {
    stat = await fsp.stat(abs)
  } catch {
    throw new UrlSchemaError('URL_DOC_NOT_FOUND', `dsh://docs/${docPath}: document not found`)
  }
  if (stat.isDirectory()) return JSON.stringify(await listDocs(abs), null, 2)
  if (stat.isFile()) return await fsp.readFile(abs, 'utf8')
  throw new UrlSchemaError('URL_DOC_NOT_FOUND', `dsh://docs/${docPath}: not a regular file`)
}

/** Create the `dsh://` scheme handler, capturing `deps` by closure. */
export function createDshHandler(deps: DshHandlerDeps): SchemeHandler {
  const { settings, docsDir } = deps

  // Cached discovery so repeated `dsh://docs` resolves stat once.
  let docsDirPromise: Promise<string | undefined> | undefined
  function findDocsDir(): Promise<string | undefined> {
    if (docsDirPromise === undefined) {
      docsDirPromise = (async () => {
        const candidates: string[] = []
        if (docsDir !== undefined) candidates.push(docsDir)
        const pkgRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
        candidates.push(join(pkgRoot, 'docs'), join(pkgRoot, '..', 'docs'))
        for (const dir of candidates) {
          try {
            if ((await fsp.stat(dir)).isDirectory()) return dir
          } catch {
            // not present — try the next candidate
          }
        }
        return undefined
      })()
    }
    return docsDirPromise
  }

  return {
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const [root, ...rest] = path.split('/')
      const restPath = rest.join('/')

      if (root === 'docs') {
        const dir = await findDocsDir()
        if (dir === undefined) {
          throw new UrlSchemaError(
            'URL_DOCS_UNAVAILABLE',
            'dsh://docs: no docs directory found (provide `docsDir` to createDshHandler)',
          )
        }
        if (restPath === '') return JSON.stringify(await listDocs(dir), null, 2)
        return await readDoc(dir, restPath)
      }

      if (root === 'config') {
        if (settings === undefined) {
          throw new UrlSchemaError(
            'URL_SETTINGS_UNAVAILABLE',
            'dsh://config: no ctx.settings service is mounted',
          )
        }
        const descriptors = settings.describe({ redactSecrets: true })
        if (restPath === '') {
          const out: Record<string, unknown> = {}
          for (const descriptor of descriptors) {
            out[String(descriptor.ns)] = stripSecrets(descriptor.value)
          }
          return JSON.stringify(out, null, 2)
        }
        const found = descriptors.find((descriptor) => String(descriptor.ns) === restPath)
        if (found === undefined) {
          throw new UrlSchemaError(
            'URL_UNKNOWN_SETTINGS_NAMESPACE',
            `dsh://config/${restPath}: unknown settings namespace`,
          )
        }
        return JSON.stringify(stripSecrets(found.value), null, 2)
      }

      throw new UrlSchemaError(
        'URL_UNKNOWN_RESOURCE',
        `dsh://: unknown resource "${root || '(empty)'}" — expected "docs" or "config"`,
      )
    },
  }
}
