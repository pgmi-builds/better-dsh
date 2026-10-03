/**
 * AST availability reminder — one-line suffix on landed code-tool results.
 *
 * User rulings baked in here (2026-09-26/27, change 2026-09-26-lsp-ast-reminder):
 * - Scope follows the AST tool's OWN capability surface (ast-grep/tree-sitter
 *   grammars bundled in @oh-my-pi/pi-natives), decoupled from the LSP server
 *   table (user ruling 2026-09-27: "按照 AST 工具支持的编程语言范围去做 hook").
 *   The set below is empirically probed against the shipped natives binary
 *   (2026-09-27): every listed extension produced real ast_grep matches;
 *   prose (.md) and unproven grammars (java/toml) are excluded.
 * - Firing policy: per agent session, at most 5 reminders (user ruling
 *   2026-09-27: "同一个 agent session 里面提醒 5 次就行了"), then silent.
 *   No interaction with the lsp gate family.
 *
 * Pure predicates + one per-session counter — the composition root
 * (url-schemes post-execute hook) owns appending the returned line to the
 * decision content and calling {@link disposeAstReminders} on agent dispose.
 * @module dashr/devices/ast/ast-reminder
 */

import * as path from 'node:path'
import { EXTENSION_TO_LANGUAGE } from './engine/language-map.ts'

/**
 * AST-capable extension set —— 从引擎的语言面**派生**（spec：单一真相源）。
 * 2026-09-27 那版是对 shipped 二进制逐扩展实测的快照；引擎内置后两者必然
 * 一致，不再人工维护第二份。
 */
export const AST_CODE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXTENSION_TO_LANGUAGE))

/** Reminders per agent session (user ruling 2026-09-27: five is enough). */
export const AST_REMINDER_CAP = 5

/** The one-line availability notice (single line, both dvc:// devices). */
const NOTICE =
  'ast_edit / ast_grep available — write dvc://ast_edit (structured rewrite) or dvc://ast_grep (pattern search)'

/** Per-session emitted-reminder counters (disposed with the agent). */
const counters = new Map<string, number>()

/** Drop a session's reminder counter (agent dispose). */
export function disposeAstReminders(sessionId: string): void {
  counters.delete(sessionId)
}

/** Lowercased extension of a path ('' when none). */
function extensionOf(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

/** True when an include/glob string names a file covered by the AST set. */
function includeTargetsCode(include: string): boolean {
  // Flatten brace/comma globs ('*.{ts,tsx}') into dot separators, then check
  // every extension token against the set.
  const flat = include.toLowerCase().replace(/[{},]/g, '.')
  for (const m of flat.matchAll(/\.([a-z0-9]+)/g)) {
    if (AST_CODE_EXTENSIONS.has(`.${m[1]}`)) return true
  }
  return false
}

/** Consume one emission slot for a session; false once the cap is exhausted. */
function consume(sessionId: string): boolean {
  const n = counters.get(sessionId) ?? 0
  if (n >= AST_REMINDER_CAP) return false
  counters.set(sessionId, n + 1)
  return true
}

/**
 * Notice for a landed `write`/`edit` on one file: defined iff the target is
 * an AST-capable file and the session still has reminder budget.
 */
export function astFileNotice(sessionId: string, filePath: string): string | undefined {
  if (!AST_CODE_EXTENSIONS.has(extensionOf(filePath))) return undefined
  return consume(sessionId) ? NOTICE : undefined
}

/**
 * Notice for a landed `grep`: fires for directory/default-path searches, set
 * includes, and code-file targets; silent only for clearly non-code files.
 * Consumes session budget when a notice is emitted.
 */
export function astGrepNotice(sessionId: string, args: { path?: string, include?: string } | undefined): string | undefined {
  const fire = (): string | undefined => (consume(sessionId) ? NOTICE : undefined)
  if (args === undefined) return fire()
  const { path: searchPath, include } = args
  if (typeof include === 'string' && include !== '') {
    return includeTargetsCode(include) ? fire() : undefined
  }
  if (typeof searchPath !== 'string' || searchPath === '') return fire()
  const ext = extensionOf(searchPath)
  if (ext === '') return fire()
  return AST_CODE_EXTENSIONS.has(ext) ? fire() : undefined
}

/** Tool-dispatch shape: route `grep` down the search rule, the rest down the file rule. */
export function astReminderNotice(
  sessionId: string,
  tool: 'edit' | 'write' | 'grep',
  args: { path?: string, file_path?: string, include?: string } | undefined,
): string | undefined {
  if (tool === 'grep') {
    return astGrepNotice(sessionId, args as { path?: string, include?: string } | undefined)
  }
  const filePath = args?.path ?? args?.file_path
  if (typeof filePath !== 'string' || filePath === '') return undefined
  return astFileNotice(sessionId, filePath)
}
