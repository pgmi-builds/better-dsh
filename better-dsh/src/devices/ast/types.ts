/**
 * `dvc://ast_edit` / `dvc://ast_grep` 的结果与选项形状 —— 模型面契约。
 * 原有字段与语义一字不改（spec §1.1）；唯一后端变化是从先前的 native addon 换成内置
 * WASM 引擎。0.2.6 契约扩展：新增**可选**诊断字段 `patternErrors` /
 * `pathNotFound` / `overlapping` —— 有意背离 native 的静默行为，规格见 ast spec
 * "Diagnostic fields (deliberate divergence from the native predecessor)"。
 * 坐标口径：行列 1-based、偏移 UTF-8 字节（native 口径）。
 *
 * @module dashr/devices/ast/types
 */

/** ast-grep pattern strictness knobs. */

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
  /** Per-pattern compile failures (multi-root patterns land here): `pattern <index> ("<pattern>"): <message>`; other patterns still match. */
  patternErrors?: string[]
  /** True only when the resolved target path does not exist on disk. */
  pathNotFound?: boolean
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
  /** Per-`ops[].pat` compile failures (multi-root patterns land here): `pattern <index> ("<pattern>"): <message>`; the op contributes no edits. */
  patternErrors?: string[]
  /** Edits dropped by the overlap guard; present only when > 0. */
  overlapping?: number
  /** True only when at least one resolved target root does not exist on disk. */
  pathNotFound?: boolean
}
