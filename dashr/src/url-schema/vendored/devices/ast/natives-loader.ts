/**
 * Platform-addon loader for the vendored `ast_edit`/`ast_grep` dvc devices.
 *
 * Adapted from `upstream/oh-my-pi` @ v18.0.6 (packages/natives,
 * `native/loader-state.js` — MIT; see `../LICENSE-OMP.md`). The npm wrapper
 * `@oh-my-pi/pi-natives` is ESM+Bun-only (`import.meta.dir` breaks under
 * Node 22), so this loader does not import the wrapper: it resolves the
 * platform leaf package — declared as an optionalDependency
 * (`@oh-my-pi/pi-natives-<platform>-<arch>`) — and dlopens its `.node`
 * addon directly, which exposes the same `astGrep`/`astEdit` surface.
 *
 * Loading is best-effort by design: a missing package or an unsupported
 * platform MUST NOT throw here. `loadPiNatives()` returns `undefined` and
 * the device layer turns that into a structured `DVC_DEVICE_ERROR` whose
 * message names the platform package to install.
 *
 * @module dashr/url-schema/vendored/devices/ast/natives-loader
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Native API surface (transcribed from `@oh-my-pi/pi-natives@18.0.6`
// `native/index.d.ts` — only the ast-grep binding types the devices touch).
// ---------------------------------------------------------------------------

/** ast-grep pattern strictness knobs. */
export type AstMatchStrictness = 'cst' | 'smart' | 'ast' | 'relaxed' | 'signature' | 'template'

/** One ast-grep match with source range and optional meta-variables. */
export interface AstFindMatch {
  /** Display path of the matching file, relative to the scanned root. */
  path: string
  /** Matched source text. */
  text: string
  /** Start byte offset in the file (UTF-8 byte index). */
  byteStart: number
  /** End byte offset in the file (exclusive UTF-8 byte index). */
  byteEnd: number
  /** 1-based start line. */
  startLine: number
  /** 1-based start column. */
  startColumn: number
  /** 1-based end line. */
  endLine: number
  /** 1-based end column. */
  endColumn: number
  /** Meta-variable name to captured text, when `includeMeta` was enabled. */
  metaVariables?: Record<string, string>
}

/** Options for `astGrep`: patterns, scan scope, and match limits. */
export interface AstFindOptions {
  /** ast-grep patterns to search for (OR across patterns). */
  patterns?: string[]
  /** Language override; otherwise inferred from file extension per candidate. */
  lang?: string
  /** Single file or directory to scan (combined with `glob` when set). */
  path?: string
  /** Optional glob filter relative to the search root. */
  glob?: string
  /** Rule selector for multi-rule ast-grep configurations. */
  selector?: string
  /** Pattern strictness; defaults to smart matching when omitted. */
  strictness?: AstMatchStrictness
  /** Maximum matches to return after `offset` (default applies when omitted). */
  limit?: number
  /** Number of leading matches to skip before applying `limit`. */
  offset?: number
  /** When true, include meta-variable bindings per match. */
  includeMeta?: boolean
  /** Reserved for contextual snippets; unused by the current native path. */
  context?: number
  /** Optional cancellation handle (library-specific). */
  signal?: unknown
  /** Wall-clock timeout for the worker task in milliseconds. */
  timeoutMs?: number
}

/** Aggregated search statistics and any parse or compile diagnostics. */
export interface AstFindResult {
  /** Page of matches after sort, offset, and limit. */
  matches: AstFindMatch[]
  /** Total matches found before paging (can exceed `matches.length`). */
  totalMatches: number
  /** Distinct files that contained at least one match. */
  filesWithMatches: number
  /** Files examined for the query. */
  filesSearched: number
  /** True when results were truncated by `limit`. */
  limitReached: boolean
  /** Non-fatal parse or pattern errors collected during the run. */
  parseErrors?: string[]
}

/** One textual replacement applied to a file (before/after slice and coordinates). */
export interface AstReplaceChange {
  /** File path, relative to the rewritten root. */
  path: string
  /** Original matched text. */
  before: string
  /** Replacement text. */
  after: string
  /** Start byte offset of the replaced span. */
  byteStart: number
  /** End byte offset of the replaced span (exclusive). */
  byteEnd: number
  /** Length of deleted text in bytes (may differ from the span length). */
  deletedLength: number
  /** 1-based start line of the match. */
  startLine: number
  /** 1-based start column of the match. */
  startColumn: number
  /** 1-based end line of the match. */
  endLine: number
  /** 1-based end column of the match. */
  endColumn: number
}

/** Per-file replacement count after an `astEdit` run. */
export interface AstReplaceFileChange {
  /** File that had replacements. */
  path: string
  /** Number of replacements in that file. */
  count: number
}

/** Options for `astEdit`: rewrite rules, scan scope, safety limits, and dry-run. */
export interface AstReplaceOptions {
  /** Map of pattern string to replacement template. */
  rewrites?: Record<string, string>
  /** Language override applied to every file; otherwise inferred per file. */
  lang?: string
  /** Single file or directory to rewrite. */
  path?: string
  /** Optional glob filter within the search root. */
  glob?: string
  /** Rule selector for multi-rule configurations. */
  selector?: string
  /** Pattern strictness for rewrites. */
  strictness?: AstMatchStrictness
  /** When true (default), compute changes without writing files. */
  dryRun?: boolean
  /** Cap on replacement applications across all files. */
  maxReplacements?: number
  /** Cap on distinct files that may be modified. */
  maxFiles?: number
  /** Fail the operation when a file cannot be parsed for rewriting. */
  failOnParseError?: boolean
  /** Optional cancellation handle. */
  signal?: unknown
  /** Wall-clock timeout for the worker task in milliseconds. */
  timeoutMs?: number
}

/** Summary of an ast-grep rewrite pass, including whether disk writes occurred. */
export interface AstReplaceResult {
  /** Individual replacement records (may be large). */
  changes: AstReplaceChange[]
  /** Replacement counts grouped by file. */
  fileChanges: AstReplaceFileChange[]
  /** Total replacements applied or previewed. */
  totalReplacements: number
  /** Files that had at least one replacement. */
  filesTouched: number
  /** Files considered for rewriting. */
  filesSearched: number
  /** False when `dryRun` prevented writing. */
  applied: boolean
  /** True when limits stopped further replacements. */
  limitReached: boolean
  /** Parse or pattern errors when not failing the whole operation. */
  parseErrors?: string[]
}

/** The binding subset the ast devices consume. */
export interface PiNatives {
  astGrep(options: AstFindOptions): Promise<AstFindResult>
  astEdit(options: AstReplaceOptions): Promise<AstReplaceResult>
}

// ---------------------------------------------------------------------------
// Platform resolution
// ---------------------------------------------------------------------------

/** Platform tags with a published leaf package (mirrors the upstream loader). */
const SUPPORTED_PLATFORM_TAGS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
] as const

export type PiNativesPlatformTag = (typeof SUPPORTED_PLATFORM_TAGS)[number]

/** The supported platform tag for the given (or current) platform/arch, or `undefined`. */
export function piNativesPlatformTag(
  platform: string = process.platform,
  arch: string = process.arch,
): PiNativesPlatformTag | undefined {
  const tag = `${platform}-${arch}`
  return (SUPPORTED_PLATFORM_TAGS as readonly string[]).includes(tag) ? (tag as PiNativesPlatformTag) : undefined
}

/** The npm leaf-package name for the given (or current) platform, or `undefined`. */
export function piNativesPackageName(
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const tag = piNativesPlatformTag(platform, arch)
  return tag === undefined ? undefined : `@oh-my-pi/pi-natives-${tag}`
}

/**
 * Candidate addon filenames inside the leaf package, most-preferred first
 * (mirrors the upstream `getAddonFilenames`): x64 ships modern/baseline CPU
 * variants, other arches a single default binary.
 */
export function piNativesAddonFilenames(tag: string, arch: string, preferModern = true): string[] {
  const defaultFilename = `pi_natives.${tag}.node`
  if (arch !== 'x64') return [defaultFilename]
  const baseline = `pi_natives.${tag}-baseline.node`
  const modern = `pi_natives.${tag}-modern.node`
  return preferModern ? [modern, baseline, defaultFilename] : [baseline, modern, defaultFilename]
}

/**
 * AVX2 probe for the modern/baseline choice on x64. Linux reads
 * `/proc/cpuinfo` (upstream does the same); darwin/win32 x64 assume modern —
 * effectively universal there — and a dlopen failure still falls through to
 * the baseline candidate.
 */
function detectAvx2(platform: string, arch: string): boolean {
  if (arch !== 'x64') return false
  if (platform === 'linux') {
    try {
      return /\bavx2\b/i.test(readFileSync('/proc/cpuinfo', 'utf8'))
    } catch {
      return false
    }
  }
  return platform === 'darwin' || platform === 'win32'
}

// ---------------------------------------------------------------------------
// Package resolution + dlopen
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url))

/** `require` anchored at this module — used to dlopen absolute `.node` paths. */
const requireHere = createRequire(import.meta.url)

/**
 * Locate the leaf package directory: first via `require.resolve` from
 * `fromDir` (honors the usual node_modules walk), then via an explicit
 * node_modules-walk upward from `fromDir`. Returns `undefined` when absent.
 */
function findPackageDir(packageName: string, fromDir: string): string | undefined {
  try {
    const manifest = createRequire(path.join(fromDir, 'noop.js')).resolve(`${packageName}/package.json`)
    return path.dirname(manifest)
  } catch {
    // fall through to the explicit walk
  }
  let dir = fromDir
  for (;;) {
    const candidate = path.join(dir, 'node_modules', packageName)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/** Overrides for `loadPiNatives` — defaults come from the current process. */
export interface PiNativesLoadOptions {
  platform?: string
  arch?: string
  /** Resolution anchor for the package lookup (default: this module's dir). */
  fromDir?: string
}

/** Memoized default-args outcome: `undefined` = not attempted, `null` = attempted and unavailable. */
let cachedDefaultLoad: PiNatives | null | undefined

/**
 * Load the pi-natives platform addon. Never throws: a missing package, an
 * unsupported platform, or a failed dlopen all resolve to `undefined` (the
 * next variant is tried first). Only default-args calls are memoized, so
 * option-bearing probes (tests) never pollute the cache.
 */
export function loadPiNatives(options: PiNativesLoadOptions = {}): PiNatives | undefined {
  const isDefaultLoad =
    options.platform === undefined && options.arch === undefined && options.fromDir === undefined
  if (isDefaultLoad && cachedDefaultLoad !== undefined) {
    return cachedDefaultLoad === null ? undefined : cachedDefaultLoad
  }

  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const tag = piNativesPlatformTag(platform, arch)
  if (tag === undefined) {
    if (isDefaultLoad) cachedDefaultLoad = null
    return undefined
  }
  const packageDir = findPackageDir(`@oh-my-pi/pi-natives-${tag}`, options.fromDir ?? here)
  if (packageDir === undefined) {
    if (isDefaultLoad) cachedDefaultLoad = null
    return undefined
  }

  const preferModern = detectAvx2(platform, arch)
  for (const filename of piNativesAddonFilenames(tag, arch, preferModern)) {
    const addonPath = path.join(packageDir, filename)
    if (!existsSync(addonPath)) continue
    try {
      const bindings = requireHere(addonPath) as Partial<Record<keyof PiNatives, unknown>>
      if (typeof bindings.astGrep !== 'function' || typeof bindings.astEdit !== 'function') continue
      const natives: PiNatives = {
        astGrep: bindings.astGrep.bind(bindings),
        astEdit: bindings.astEdit.bind(bindings),
      }
      if (isDefaultLoad) cachedDefaultLoad = natives
      return natives
    } catch {
      // dlopen failed — try the next variant (e.g. modern → baseline)
    }
  }
  if (isDefaultLoad) cachedDefaultLoad = null
  return undefined
}

/**
 * Test hook for the memoized default-load outcome: a `PiNatives` value is
 * cached as-is, `null` simulates an unavailable addon, and `undefined` drops
 * the cache so the next `loadPiNatives()` call loads for real.
 */
export function setPiNativesForTest(value: PiNatives | null | undefined): void {
  cachedDefaultLoad = value
}
