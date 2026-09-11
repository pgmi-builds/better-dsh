/**
 * `ast_edit` / `ast_grep` dvc devices — AST-aware rewrite and structured
 * search over ast-grep patterns.
 *
 * Adapted from `upstream/oh-my-pi` @ v18.0.6 (packages/coding-agent,
 * `src/tools/ast-edit.ts` + `src/tools/ast-grep.ts` + `src/tools/path-utils.ts`
 * — MIT; see `../LICENSE-OMP.md`). This is a rewrite against the dvc device
 * contract, not a vendored copy of the tool layer: args keep the omp tool
 * shapes (`ops`/`paths` for edit, `patterns`/`path`/`offset`/`limit`/
 * `includeMeta` for grep), `ops` collapse into the native `rewrites` record
 * with `Object.fromEntries` semantics (a repeated pattern's later op wins),
 * per-`paths` results aggregate like upstream's `runAstEditTargets`, and
 * `dryRun` defaults to true so a bare write never touches disk.
 *
 * `registerAstDevices` is the S10 wiring seam; `index.ts` is not touched.
 *
 * @module dashr/url-schema/vendored/devices/ast/ast-device
 */

import { statSync } from 'node:fs'
import * as path from 'node:path'

import { registerDvcDevice } from '../../../handlers/dvc.ts'
import type { DvcDevice } from '../../../handlers/dvc.ts'
import type {
  AstFindMatch,
  AstFindResult,
  AstReplaceChange,
  AstReplaceResult,
  PiNatives,
} from './natives-loader.ts'
import { loadPiNatives, piNativesPlatformTag } from './natives-loader.ts'

/**
 * Registry seam for mounting the devices. The dvc handler module satisfies
 * this structurally (`registerAstDevices()` with no argument mounts into the
 * real module-level registry); tests inject a Map-backed fake.
 */
export interface DvcRegistry {
  registerDvcDevice(name: string, device: DvcDevice): void
}

/** Per-run cap on distinct rewritten files (upstream `PI_MAX_AST_FILES` default). */
const MAX_FILES = 1000

/** Glob metacharacters that mark a path segment as a pattern (upstream `GLOB_PATH_CHARS`). */
const GLOB_CHARS = /[*?[{]/

/**
 * Load the native bindings or fail the device call with an actionable
 * message — the dvc dispatcher wraps this into `DVC_DEVICE_ERROR`.
 */
function nativesOrThrow(): PiNatives {
  const natives = loadPiNatives()
  if (natives !== undefined) return natives
  const tag = piNativesPlatformTag()
  throw new Error(
    tag === undefined
      ? `pi-natives addon unavailable: platform ${process.platform}-${process.arch} has no published @oh-my-pi/pi-natives@18.0.6 binary`
      : `pi-natives addon unavailable: install the optional dependency @oh-my-pi/pi-natives-${tag}@18.0.6 (e.g. npm install) and retry`,
  )
}

/** The working directory for relative paths: `ctx.cwd` when threaded through, else `process.cwd()`. */
function ctxCwd(ctx: unknown): string {
  if (ctx !== null && typeof ctx === 'object' && typeof (ctx as { cwd?: unknown }).cwd === 'string') {
    return (ctx as { cwd: string }).cwd
  }
  return process.cwd()
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

/** One resolved rewrite/scan target: native root, optional glob tail, and the base native paths are relative to. */
interface Target {
  root: string
  glob?: string
  rebaseBase: string
}

/**
 * Resolve one `paths` entry against `cwd`. An existing literal file or
 * directory wins as-is (upstream `parseSearchPathPreferringLiteral`);
 * otherwise the entry splits at the first glob-ish segment into
 * `{basePath, glob}` (upstream `parseSearchPath`), so a recursive glob
 * under `src` scans `src` as the root with the double-star pattern as the
 * glob tail. For file targets the native reports paths relative to the
 * file's directory, so `rebaseBase` tracks that.
 */
function resolveTarget(entry: string, cwd: string): Target {
  const absolute = path.resolve(cwd, entry)
  try {
    const stats = statSync(absolute)
    return stats.isFile()
      ? { root: absolute, rebaseBase: path.dirname(absolute) }
      : { root: absolute, rebaseBase: absolute }
  } catch {
    // not a literal path — fall through to glob splitting
  }
  const normalized = entry.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const globIndex = segments.findIndex((segment) => GLOB_CHARS.test(segment))
  if (globIndex === -1) {
    // A nonexistent literal path: hand it to the native, which reports zero
    // files searched rather than inventing an error.
    return { root: absolute, rebaseBase: absolute }
  }
  const basePath = globIndex === 0 ? '.' : segments.slice(0, globIndex).join('/')
  const glob = globIndex === 0 ? normalized : segments.slice(globIndex).join('/')
  const root = path.resolve(cwd, basePath)
  return { root, glob, rebaseBase: root }
}

/** Rebase a native-reported file path (relative to the target) to a cwd-relative POSIX path. */
function rebaseNativePath(filePath: string, target: Target, cwd: string): string {
  const relative = path.relative(cwd, path.resolve(target.rebaseBase, filePath))
  return (relative === '' ? '.' : relative).split(path.sep).join('/')
}

/** `ast_edit` — run the validated rewrite across every target, aggregating like upstream's `runAstEditTargets`. */
async function executeAstEdit(args: unknown, ctx?: unknown): Promise<AstReplaceResult> {
  const natives = nativesOrThrow()
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
  let applied = !dryRun
  for (const target of targets) {
    const result = await natives.astEdit({
      rewrites,
      path: target.root,
      glob: target.glob,
      dryRun,
      maxFiles: MAX_FILES,
      failOnParseError: false,
    })
    totalReplacements += result.totalReplacements
    filesSearched += result.filesSearched
    limitReached = limitReached || result.limitReached
    applied = applied && result.applied
    if (result.parseErrors !== undefined) parseErrors.push(...result.parseErrors)
    for (const change of result.changes) {
      changes.push({ ...change, path: rebaseNativePath(change.path, target, cwd) })
    }
    for (const fileChange of result.fileChanges) {
      const rebased = rebaseNativePath(fileChange.path, target, cwd)
      fileCounts.set(rebased, (fileCounts.get(rebased) ?? 0) + fileChange.count)
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

/** `ast_grep` — pass patterns/path/offset/limit/includeMeta straight to the native, rebase match paths. */
async function executeAstGrep(args: unknown, ctx?: unknown): Promise<AstFindResult> {
  const natives = nativesOrThrow()
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

  const result = await natives.astGrep({
    patterns,
    path: target.root,
    ...(target.glob !== undefined ? { glob: target.glob } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(includeMeta !== undefined ? { includeMeta } : {}),
  })
  const matches: AstFindMatch[] = result.matches.map((match) => ({
    ...match,
    path: rebaseNativePath(match.path, target, cwd),
  }))
  return { ...result, matches }
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
