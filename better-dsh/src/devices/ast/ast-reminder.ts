/**
 * AST availability reminder — one-line suffix on landed code-tool results.
 *
 * User rulings baked in here (2026-09-26, change 2026-09-26-lsp-ast-reminder):
 * - Firing policy: EVERY matching non-error result, no per-session cap, no
 *   gate interaction with the lsp device family ("每次都提醒，能浪费多少时间").
 * - Scope: the Python/TypeScript finite extension set — the same two language
 *   families the LSP must-have set covers; nothing else nags.
 * - grep is the ast_grep entry point: remind on directory/default-path
 *   searches (the common code-tree case) and on py/ts includes or code-file
 *   targets; stay silent only when the target is clearly a non-code file.
 *
 * Pure functions only — the composition root (url-schemes post-execute hook)
 * owns appending the returned line to the decision content.
 * @module dashr/devices/ast/ast-reminder
 */

import * as path from 'node:path'

/** Python/TypeScript finite set (user ruling: two LSPs → two families). */
export const AST_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
])

/** The one-line availability notice (single line, both dvc:// devices). */
const NOTICE =
  'ast_edit / ast_grep available for Python/TypeScript — write dvc://ast_edit (structured rewrite) or dvc://ast_grep (pattern search)'

/** Lowercased extension of a path ('' when none). */
function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

/** True when an include/glob string names python or typescript files. */
function includeTargetsCode(include: string): boolean {
  // Token-ish match so '*.md' stays silent while '*.{ts,tsx}' and '*.py' fire.
  return /(?:^|[^a-z])tsx?(?:$|[^a-z])|(?:^|[^a-z])py(?:$|[^a-z])/i.test(include)
}

/**
 * Notice for a landed `write`/`edit` on one file: defined iff the target is a
 * Python/TypeScript file.
 */
export function astFileNotice(filePath: string): string | undefined {
  return AST_CODE_EXTENSIONS.has(extensionOf(filePath)) ? NOTICE : undefined
}

/**
 * Notice for a landed `grep`: fires for directory/default-path searches, py/ts
 * includes, and code-file targets; silent only for clearly non-code files.
 */
export function astGrepNotice(args: { path?: string, include?: string } | undefined): string | undefined {
  if (args === undefined) return NOTICE
  const { path: searchPath, include } = args
  if (typeof include === 'string' && include !== '') {
    return includeTargetsCode(include) ? NOTICE : undefined
  }
  if (typeof searchPath !== 'string' || searchPath === '') return NOTICE
  const ext = extensionOf(searchPath)
  if (ext === '') return NOTICE
  return AST_CODE_EXTENSIONS.has(ext) ? NOTICE : undefined
}

/** Tool-dispatch shape: route `grep` down the search rule, the rest down the file rule. */
export function astReminderNotice(
  tool: 'edit' | 'write' | 'grep',
  args: { path?: string, file_path?: string, include?: string } | undefined,
): string | undefined {
  if (tool === 'grep') {
    return astGrepNotice(args as { path?: string, include?: string } | undefined)
  }
  const filePath = args?.path ?? args?.file_path
  if (typeof filePath !== 'string' || filePath === '') return undefined
  return astFileNotice(filePath)
}
