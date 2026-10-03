/**
 * `ast_edit` / `ast_grep` dvc devices — AST-aware rewrite and structured
 * search over ast-grep patterns.
 *
 * Adapted from `upstream/oh-my-pi` @ v18.0.6 (packages/coding-agent,
 * `src/tools/ast-edit.ts` + `src/tools/ast-grep.ts` + `src/tools/path-utils.ts`
 * — MIT; see `../NOTICE-OMP.md`). This is a rewrite against the dvc device
 * contract, not a vendored copy of the tool layer: args keep the omp tool
 * shapes (`ops`/`paths` for edit, `patterns`/`path`/`offset`/`limit`/
 * `includeMeta` for grep), `ops` collapse into the engine `rewrites` record
 * with `Object.fromEntries` semantics (a repeated pattern's later op wins),
 * per-`paths` results aggregate like upstream's `runAstEditTargets`, and
 * `dryRun` defaults to true so a bare write never touches disk.
 *
 * The backend is the in-package WASM engine: this adapter walks each target
 * (`walker.ts`), infers the language (`engine/language-map.ts`), and runs
 * `findInSource`/`editSource` per file, re-owning every reported path to a
 * cwd-relative POSIX display path. A language whose grammar failed to load is
 * skipped and recorded into `parseErrors`; an engine-level failure surfaces as
 * the dvc layer's `DVC_DEVICE_ERROR`.
 *
 * `registerAstDevices` is the S10 wiring seam; `index.ts` is not touched.
 *
 * @module dashr/devices/ast/ast-device
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { registerDvcDevice } from '../../url-schemes/handlers/dvc.ts'
import type { DvcDevice } from '../../url-schemes/handlers/dvc.ts'
import { ensureLanguages, isLanguageAvailable } from './engine/grammars.ts'
import { editSource } from './engine/edit.ts'
import { findInSource } from './engine/match.ts'
import { languageForPath } from './engine/language-map.ts'
import { walkSources } from './walker.ts'
import type {
  AstFindMatch,
  AstFindResult,
  AstReplaceChange,
  AstReplaceResult,
} from './types.ts'
/**
 * Registry seam for mounting the devices. The dvc handler module satisfies
 * this structurally (`registerAstDevices()` with no argument mounts into the
 * real module-level registry); tests inject a Map-backed fake.
 */
export interface DvcRegistry {
  registerDvcDevice(name: string, device: DvcDevice): void
}

/** Per-run cap on distinct scanned files (upstream `PI_MAX_AST_FILES` default). */
const MAX_FILES = 1000

/** Glob metacharacters that mark a path segment as a pattern (upstream `GLOB_PATH_CHARS`). */
const GLOB_CHARS = /[*?[{]/

/** The working directory for relative paths: `ctx.cwd` when threaded through, else `process.cwd()`. */
function ctxCwd(ctx: unknown): string {
  if (ctx !== null && typeof ctx === 'object' && typeof (ctx as { cwd?: unknown }).cwd === 'string') {
    return (ctx as { cwd: string }).cwd
  }
  return process.cwd()
}

/** The cwd-relative POSIX display path for an absolute walked file. */
function rel(file: string, cwd: string): string {
  return path.relative(cwd, file).split(path.sep).join('/')
}

/** A validated args object for a device call. */
function argsRecord(args: unknown, device: string): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(`${device}: args must be a JSON object`)
  }
  return args as Record<string, unknown>
}

/** A non-empty array of non-empty strings. */
function stringArray(value: unknown, field: string, device: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${device}: \`${field}\` must be a non-empty array of strings`)
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`${device}: \`${field}\` entries must be non-empty strings`)
    }
  }
  return value as string[]
}

/** An optional boolean field. */
function optionalBoolean(value: unknown, field: string, device: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${device}: \`${field}\` must be a boolean`)
  return value
}

/** An optional non-negative integer field. */
function optionalCount(value: unknown, field: string, device: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${device}: \`${field}\` must be a non-negative integer`)
  }
  return value
}

/** One resolved rewrite/scan target: walk root and optional glob tail. */
interface Target {
  root: string
  glob?: string
}

/**
 * Resolve one `paths` entry against `cwd`. An existing literal file or
 * directory wins as-is (upstream `parseSearchPathPreferringLiteral`);
 * otherwise the entry splits at the first glob-ish segment into
 * `{basePath, glob}` (upstream `parseSearchPath`), so a recursive glob
 * under `src` scans `src` as the root with the double-star pattern as the
 * glob tail.
 */
function resolveTarget(entry: string, cwd: string): Target {
  const absolute = path.resolve(cwd, entry)
  try {
    statSync(absolute)
    return { root: absolute }
  } catch {
    // not a literal path — fall through to glob splitting
  }
  const normalized = entry.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const globIndex = segments.findIndex((segment) => GLOB_CHARS.test(segment))
  if (globIndex === -1) {
    // A nonexistent literal path: hand it to the walker, which reports zero
    // files searched rather than inventing an error.
    return { root: absolute }
  }
  const basePath = globIndex === 0 ? '.' : segments.slice(0, globIndex).join('/')
  const glob = globIndex === 0 ? normalized : segments.slice(globIndex).join('/')
  const root = path.resolve(cwd, basePath)
  return { root, glob }
}

/** `ast_edit` — run the validated rewrite across every target, aggregating like upstream's `runAstEditTargets`. */
async function executeAstEdit(args: unknown, ctx?: unknown): Promise<AstReplaceResult> {
  await ensureLanguages()
  const cwd = ctxCwd(ctx)
  const record = argsRecord(args, 'ast_edit')

  const rawOps = record.ops
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    throw new Error('ast_edit: `ops` must be a non-empty array of {pat, out} objects')
  }
  const rewrites: Record<string, string> = {}
  rawOps.forEach((rawOp, index) => {
    if (rawOp === null || typeof rawOp !== 'object' || Array.isArray(rawOp)) {
      throw new Error(`ast_edit: ops[${index}] must be a {pat, out} object`)
    }
    const op = rawOp as Record<string, unknown>
    if (typeof op.pat !== 'string' || op.pat.length === 0) {
      throw new Error(`ast_edit: ops[${index}].pat must be a non-empty pattern`)
    }
    if (typeof op.out !== 'string') {
      throw new Error(`ast_edit: ops[${index}].out must be a string`)
    }
    // Object.fromEntries semantics: a repeated pattern's later op wins.
    rewrites[op.pat] = op.out
  })

  const targets = stringArray(record.paths, 'paths', 'ast_edit').map((entry) => resolveTarget(entry, cwd))
  const dryRun = optionalBoolean(record.dryRun, 'dryRun', 'ast_edit') ?? true

  const changes: AstReplaceChange[] = []
  const fileCounts = new Map<string, number>()
  const parseErrors: string[] = []
  let totalReplacements = 0
  let filesSearched = 0
  let limitReached = false
  const applied = !dryRun
  for (const target of targets) {
    const walked = await walkSources(target.root, { glob: target.glob, maxFiles: MAX_FILES })
    filesSearched += walked.files.length
    limitReached = limitReached || walked.limitReached
    for (const file of walked.files) {
      const lang = languageForPath(file)
      if (lang === undefined) continue
      if (!isLanguageAvailable(lang)) {
        parseErrors.push(`${rel(file, cwd)}: language unavailable`)
        continue
      }
      let source: string
      try {
        source = readFileSync(file, 'utf8')
      } catch { continue }
      const result = await editSource(source, lang, rewrites)
      if (result.parseErrorCount > 0) {
        parseErrors.push(`${rel(file, cwd)}: ${result.parseErrorCount} parse error(s)`)
      }
      if (result.changes.length === 0) continue
      const display = rel(file, cwd)
      changes.push(...result.changes.map((change) => ({ ...change, path: display })))
      fileCounts.set(display, (fileCounts.get(display) ?? 0) + result.totalReplacements)
      totalReplacements += result.totalReplacements
      // Single write per file: the engine's `rewritten` goes to disk in one
      // shot (no delete-then-write, no second I/O).
      if (!dryRun) writeFileSync(file, result.rewritten, 'utf8')
    }
  }
  const fileChanges = [...fileCounts].map(([filePath, count]) => ({ path: filePath, count }))
  return {
    changes,
    fileChanges,
    totalReplacements,
    filesTouched: fileChanges.length,
    filesSearched,
    applied,
    limitReached,
    ...(parseErrors.length > 0 ? { parseErrors } : {}),
  }
}

/** `ast_grep` — walk the target, run every pattern per file (OR), merge, then page. */
async function executeAstGrep(args: unknown, ctx?: unknown): Promise<AstFindResult> {
  await ensureLanguages()
  const cwd = ctxCwd(ctx)
  const record = argsRecord(args, 'ast_grep')

  const patterns = stringArray(record.patterns, 'patterns', 'ast_grep')
  const rawPath = record.path
  if (rawPath !== undefined && typeof rawPath !== 'string') {
    throw new Error('ast_grep: `path` must be a string')
  }
  const target = resolveTarget(rawPath !== undefined && rawPath.length > 0 ? rawPath : '.', cwd)
  const offset = optionalCount(record.offset, 'offset', 'ast_grep')
  const limit = optionalCount(record.limit, 'limit', 'ast_grep')
  const includeMeta = optionalBoolean(record.includeMeta, 'includeMeta', 'ast_grep')

  const walked = await walkSources(target.root, { glob: target.glob, maxFiles: MAX_FILES })
  const matches: AstFindMatch[] = []
  const parseErrors: string[] = []
  let filesWithMatches = 0
  for (const file of walked.files) {
    const lang = languageForPath(file)
    if (lang === undefined) continue
    if (!isLanguageAvailable(lang)) {
      parseErrors.push(`${rel(file, cwd)}: language unavailable`)
      continue
    }
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch { continue }
    // Multi-pattern OR: each pattern runs over the same source, results merge
    // in document order within the file (native ran one combined query).
    const perFile: AstFindMatch[] = []
    for (const pattern of patterns) {
      const found = await findInSource(source, lang, pattern, { includeMeta })
      perFile.push(...found.matches)
    }
    if (perFile.length === 0) continue
    filesWithMatches += 1
    perFile.sort((a, b) => a.byteStart - b.byteStart || a.byteEnd - b.byteEnd)
    matches.push(...perFile.map((match) => ({ ...match, path: rel(file, cwd) })))
  }
  // offset/limit slice AFTER the merge; totalMatches is the pre-slice length.
  const totalMatches = matches.length
  const start = offset ?? 0
  const paged = matches.slice(start, start + (limit ?? Infinity))
  return {
    matches: paged,
    totalMatches,
    filesWithMatches,
    filesSearched: walked.files.length,
    limitReached: totalMatches > paged.length,
    ...(parseErrors.length > 0 ? { parseErrors } : {}),
  }
}

/** Mount both ast devices on the registry (defaults to the real dvc registry). */
export function registerAstDevices(registry: DvcRegistry = { registerDvcDevice }): void {
  registry.registerDvcDevice('ast_edit', { summary: summaries.ast_edit, execute: executeAstEdit })
  registry.registerDvcDevice('ast_grep', { summary: summaries.ast_grep, execute: executeAstGrep })
}

/** Roster summaries for the device nameplate — one line per device. */
export const summaries = {
  ast_edit:
    'AST-aware structural rewrite: {ops: [{pat, out}], paths: string[], dryRun?: boolean} — ast-grep patterns; dryRun defaults true, set false to write files',
  ast_grep:
    'AST pattern search: {patterns: string[], path?: string, offset?: number, limit?: number, includeMeta?: boolean} — returns structured matches with optional meta variables',
}
