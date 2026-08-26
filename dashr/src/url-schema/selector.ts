/**
 * URL scheme parsing + unified selector application for `dsh-url-schema`.
 *
 * All five schemes (`skill://`, `agent://`, `dsh://`, `ctx://`, `dvc://`)
 * share one URL grammar and one selector syntax (aligned with OMP):
 *
 *     scheme "://" path [ selector ]
 *
 * `path` runs from after `scheme://` to the first `:` or `?`. The optional
 * trailing selector is one of:
 *
 *   - `:raw`                      → the returned text verbatim
 *   - `:N`, `:N-M`, `:N-M,N2-M2`  → 1-based inclusive line slices (`N-` = open tail)
 *   - `:path/<subpath>`           → a sub-resource inside the returned text (JSON dot-path)
 *   - `?q=<query>`                → a query over the returned text (JSON dot-path, else a line filter)
 *
 * `SchemeHandler.resolve` returns the full text; the caller applies the
 * selector via {@link applySelector}. `parseUrl` only enforces that the URL
 * has a `scheme://` prefix — scheme *registration* is the resolver's job.
 */

/** The four unified selector forms, as a discriminated union. */
export type Selector =
  | { kind: 'raw' }
  | { kind: 'lines'; ranges: Array<[number, number]> }
  | { kind: 'path'; value: string }
  | { kind: 'query'; q: string }

/** A parsed URL: scheme prefix, handler-facing path, and optional selector. */
export interface ParsedUrl {
  scheme: string
  path: string
  selector: Selector | null
}

/** Structured error thrown by the URL-schema layer. */
export class UrlSchemaError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UrlSchemaError'
    this.code = code
  }
}

/** Matches `scheme://rest` with a lowercase alphanumeric scheme. */
const SCHEME_RE = /^([a-z][a-z0-9]*):\/\/(.*)$/
/** One line range token: `N`, `N-M`, or open `N-`. */
const RANGE_RE = /^(\d+)(?:-(\d*))?$/
/**
 * Schemes whose URL syntax reserves `:` and `?` (ports, query strings): the
 * whole remainder is the path and NO selector is parsed. The http(s) handler
 * is documented as selector-free for exactly this reason — `:8443` is a port
 * and `?q=` a server query, never a line range or content filter.
 */
const SELECTOR_EXEMPT: Record<string, true> = { http: true, https: true }

/**
 * Parse a `scheme://` URL into `{ scheme, path, selector }`.
 *
 * Throws a structured {@link UrlSchemaError} (code `URL_NO_SCHEME`) when the
 * URL has no `scheme://` prefix. Any lowercase scheme is accepted here; the
 * resolver rejects schemes with no registered handler. Selector-exempt
 * schemes ({@link SELECTOR_EXEMPT}) return the whole remainder as the path.
 */
export function parseUrl(raw: string): ParsedUrl {
  const m = SCHEME_RE.exec(raw)
  if (m === null) {
    throw new UrlSchemaError(
      'URL_NO_SCHEME',
      `URL "${raw}" has no scheme — expected "scheme://" (skill://, agent://, dsh://, ctx://, dvc://, http://, https://)`,
    )
  }
  const scheme = m[1]!
  const rest = m[2]!

  // Selector-exempt schemes: `:`/`?` belong to the URL itself (port, query).
  if (SELECTOR_EXEMPT[scheme] === true) {
    return { scheme, path: rest, selector: null }
  }

  const colon = rest.indexOf(':')
  const question = rest.indexOf('?')
  const hasColon = colon !== -1
  const hasQuestion = question !== -1

  // No selector marker: the whole remainder is the path.
  if (!hasColon && !hasQuestion) {
    return { scheme, path: rest, selector: null }
  }

  // The first marker wins; `:` or `?` inside a query value is not re-scanned.
  const isQuery = hasQuestion && (!hasColon || question < colon)
  const marker = isQuery ? question : colon
  const path = rest.slice(0, marker)
  const selPart = rest.slice(marker + 1)

  const selector = isQuery
    ? { kind: 'query' as const, q: selPart.startsWith('q=') ? selPart.slice(2) : selPart }
    : parseColonSelector(selPart)

  return { scheme, path, selector }
}

/** `:raw`, `:path/<subpath>`, or a `:N-M` line range list. */
function parseColonSelector(selPart: string): Selector {
  if (selPart === 'raw') return { kind: 'raw' }
  if (selPart.startsWith('path/')) return { kind: 'path', value: selPart.slice('path/'.length) }
  return { kind: 'lines', ranges: parseRanges(selPart) }
}

/** `N`, `N-M`, `N-`, comma-separated → `[[start, end], ...]` (1-based). */
function parseRanges(spec: string): Array<[number, number]> {
  return spec.split(',').map((part): [number, number] => {
    const token = part.trim()
    const m = RANGE_RE.exec(token)
    if (m === null) {
      throw new UrlSchemaError(
        'URL_BAD_SELECTOR',
        `invalid line selector ":${spec}" — expected N, N-M, or N-M,N2-M2`,
      )
    }
    const start = Number(m[1]!)
    if (start < 1) {
      throw new UrlSchemaError(
        'URL_BAD_SELECTOR',
        `line numbers are 1-based — got ${start} in ":${spec}"`,
      )
    }
    const end = m[2] === undefined ? start : m[2] === '' ? Infinity : Number(m[2])
    if (end !== Infinity && end < start) {
      throw new UrlSchemaError(
        'URL_BAD_SELECTOR',
        `line range ${start}-${end} is empty — end must be >= start`,
      )
    }
    return [start, end]
  })
}

/**
 * Apply a selector to already-resolved text.
 *
 * `null` and `{ kind: 'raw' }` return the text unchanged. `lines` performs a
 * 1-based inclusive slice (open tail via `Infinity`). `path` navigates a JSON
 * sub-resource by dot-path. `query` navigates JSON by dot-path when the text
 * parses as JSON, and otherwise keeps the lines containing the query string.
 */
export function applySelector(text: string, sel: Selector | null): string {
  if (sel === null) return text
  switch (sel.kind) {
    case 'raw':
      return text
    case 'lines':
      return applyLines(text, sel.ranges)
    case 'path':
      return applyPath(text, sel.value)
    case 'query':
      return applyQuery(text, sel.q)
  }
}

/** 1-based inclusive line slicing; `Infinity` end = open tail. */
function applyLines(text: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return ''
  const lines = text.split('\n')
  const out: string[] = []
  for (const [startRaw, endRaw] of ranges) {
    const start = Math.max(1, startRaw)
    const end = endRaw === Infinity ? lines.length : Math.min(lines.length, endRaw)
    if (start <= end) out.push(...lines.slice(start - 1, end))
  }
  return out.join('\n')
}

/** Navigate a JSON sub-resource by dot-path; non-JSON text passes through. */
function applyPath(text: string, value: string): string {
  if (value === '') return text
  const parsed = tryParseJson(text)
  if (parsed === undefined) return text
  const node = navigate(parsed, value)
  return node === undefined ? text : stringifyNode(node)
}

/** JSON dot-path query when the text is JSON, else a substring line filter. */
function applyQuery(text: string, q: string): string {
  if (q === '') return text
  const parsed = tryParseJson(text)
  if (parsed !== undefined) {
    const node = navigate(parsed, q)
    return node === undefined ? text : stringifyNode(node)
  }
  return text.split('\n').filter((line) => line.includes(q)).join('\n')
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Walk a dot-path through a parsed JSON value (numeric segments index arrays). */
function navigate(node: unknown, path: string): unknown {
  let current: unknown = node
  for (const segment of path.split('.')) {
    if (segment === '') return undefined
    if (Array.isArray(current)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx) || idx < 0) return undefined
      current = current[idx]
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** Render a navigated leaf as text. */
function stringifyNode(node: unknown): string {
  if (typeof node === 'string') return node
  try {
    return JSON.stringify(node) ?? ''
  } catch {
    return String(node)
  }
}
