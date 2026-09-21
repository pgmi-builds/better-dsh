/**
 * `dsh-url-schemes`: the single source of truth for the scheme set.
 *
 * The scheme enumeration used to be written out by hand in several places —
 * the `url-schema:general` system-prompt section, the `read` tool's description
 * and its `path` hint, `write`'s registered-scheme list, and the resolver's
 * no-scheme error. The copies drifted, and they drifted in the worst possible
 * direction: `ctx://` — the only scheme that reaches the *running* session's own
 * log — has been missing from every `read` description since the feature landed
 * (`074b6ae` v0.1.8c), because that copy listed five names and someone counted
 * to five without re-reading the set.
 *
 * Everything model-facing about the scheme set is now rendered from
 * {@link SCHEME_CATALOGUE}: the structured table in the system prompt, the short
 * example hint on `read`, and the registered-name list used in error messages.
 * Add or change a scheme here and every surface follows; there is nothing left
 * to forget to update.
 *
 * This module is deliberately dependency-free (no imports from `selector.ts` or
 * the handlers) so the low-level modules can render their messages from it
 * without introducing a cycle.
 */

/** How a scheme accepts a `write`. */
export type SchemeWrite = 'read-only' | 'json-args'

/** One scheme's model-facing contract. */
export interface SchemeDoc {
  /** Every scheme token this entry covers, as it appears in a URL. */
  readonly names: readonly string[]
  /** Display form used in prose and error messages. */
  readonly display: string
  /** Addressable paths, in the shapes the handler actually parses. */
  readonly paths: string
  /** What the resource is, in one clause. */
  readonly purpose: string
  /** A concrete, copyable URL (`<…>` marks the parts a caller must supply). */
  readonly example: string
  /** The scheme's write channel. */
  readonly write: SchemeWrite
  /**
   * Deviation from the uniform selector syntax, when there is one. Omitted
   * means "takes all four selector forms".
   */
  readonly selector?: string
}

/**
 * The scheme set, in declaration order.
 *
 * `paths` mirrors each handler's own path parsing, not an idealised grammar:
 * `dvc://` addresses a device by its FIRST segment only (a trailing `/sub` is
 * parsed and then dropped), and `ctx://` addresses collection elements with a
 * `[n]` bracket that lives in the *path*, not in the selector.
 */
export const SCHEME_CATALOGUE: readonly SchemeDoc[] = [
  {
    names: ['skill'],
    display: 'skill://',
    paths: 'skill://<name>[/<file>]',
    purpose: "a registered skill's files",
    example: 'skill://<name>/SKILL.md',
    write: 'read-only',
  },
  {
    names: ['agent'],
    display: 'agent://',
    paths: 'agent://[<id>[/transcript]]',
    purpose: 'agent roster / a LIVE agent transcript',
    example: 'agent://<id>/transcript:1-40',
    write: 'read-only',
  },
  {
    names: ['dsh'],
    display: 'dsh://',
    paths: 'dsh://docs[/<doc>] · dsh://config',
    purpose: 'harness docs / live resolved config',
    example: 'dsh://config:path/agent-loop.maxParallelToolCalls',
    write: 'read-only',
  },
  {
    names: ['ctx'],
    display: 'ctx://',
    paths: 'ctx://session/<face>',
    purpose:
      "THIS session's own log; face ∈ transcript, compactions, thinking, system, " +
      'user_prompts[n], tool_calls[n], agent_responses[n]',
    example: 'ctx://session/tool_calls[0]',
    write: 'read-only',
    selector:
      '`:raw` | `:N-M[,N2-M2]` | `:raw:N-M` (composite ≡ `:N-M`); `[n]` is path syntax ' +
      '(0-based ordinal or event seq)',
  },
  {
    names: ['dvc'],
    display: 'dvc://',
    paths: 'dvc://[<device>]',
    purpose: 'device registry; `write dvc://<device>` with JSON args RUNS it',
    example: 'dvc://ast_grep',
    write: 'json-args',
  },
  {
    names: ['http', 'https'],
    display: 'http(s)://',
    paths: 'http(s)://<host>/<path>',
    purpose: 'plain fetch',
    example: 'https://example.com',
    write: 'read-only',
    selector: 'exempt — the whole remainder is the path (`:8443` port, `?x=1` query)',
  },
]

/** Every registered scheme token, sorted — the list error messages report. */
export const SCHEME_NAMES: readonly string[] = SCHEME_CATALOGUE.flatMap((doc) => doc.names).sort()

/** The schemes as display tokens (`skill://`, `http(s)://`, …) — prose + error messages. */
export const SCHEME_DISPLAYS: readonly string[] = SCHEME_CATALOGUE.map((doc) => doc.display)

/** Number of schemes with no write channel (every entry except `dvc://`). */
export const READ_ONLY_SCHEME_COUNT: number = SCHEME_CATALOGUE.filter(
  (doc) => doc.write === 'read-only',
).length

/** The uniform selector syntax, as one clause. */
const SELECTOR_CLAUSE =
  'selectors `:raw` | `:N-M[,N2-M2]` (1-based lines) | `:path/<a.b>` (JSON dot-path) | ' +
  '`?q=<q>` (dot-path, else line filter)'

/**
 * The `url-schema:general` system-prompt section: grammar, the structured
 * scheme table with one example each, the selector caveats, and the bulk-read
 * discipline. Rendered entirely from {@link SCHEME_CATALOGUE} so a new scheme
 * appears here without anyone remembering to edit this file.
 */
export function renderGeneralSectionText(): string {
  const table = SCHEME_CATALOGUE.map((doc) => {
    const caveat = doc.selector === undefined ? '' : ` — ${doc.selector}`
    return `- \`${doc.paths}\` — ${doc.purpose}  e.g. \`${doc.example}\`${caveat}`
  }).join('\n')
  return [
    '# Internal URLs (dsh-url-schemes)',
    'read/write/grep/glob take a `scheme://` URL as a path: `scheme://<path>[:selector]` — ' +
      `${SELECTOR_CLAUSE}. Bare \`read <scheme>://\` lists the surface.`,
    table,
    `Only \`dvc://\` is writable; the other ${READ_ONLY_SCHEME_COUNT} schemes are read-only. ` +
      'Bulk: prefer grep or `:N-M` windows over full reads.',
  ].join('\n')
}

/**
 * A short comma-joined `e.g.` hint for a tool's `path` parameter, drawn from the
 * catalogue's concrete examples (`<…>` placeholders excluded) so the hint and
 * the prompt table can never disagree.
 */
export function renderExampleHint(limit = 3): string {
  return SCHEME_CATALOGUE.filter((doc) => !doc.example.includes('<'))
    .slice(0, limit)
    .map((doc) => doc.example)
    .join(', ')
}
