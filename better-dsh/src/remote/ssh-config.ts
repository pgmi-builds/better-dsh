/**
 * Minimal `~/.ssh/config` parser — pure module, seed source for the remote
 * target registry (plan docs/10_plans/2026-09-22-dashr-remote-tool-rm0.md,
 * Task 1).
 *
 * Line-based `key value` parsing, just enough to enumerate concrete host
 * aliases and resolve their effective connection parameters with real ssh
 * semantics:
 *
 * - Keys are case-insensitive; full-line `#` comments are dropped (OpenSSH
 *   does not honor trailing inline comments, so neither do we); `=` also
 *   separates key from value (`HostName=x`).
 * - A `Host` line opens a block; its patterns split on whitespace and
 *   commas. Patterns support `*` (any run), `?` (one char) and `!pat`
 *   negation (a negated hit makes the whole block not match); comparison
 *   is case-insensitive, like ssh.
 * - Within a block the FIRST occurrence of each parameter wins; the entry
 *   exposes only the fields the registry consumes (hostName / user / port /
 *   identityFiles / proxyJump). `IdentityFile` values accumulate in
 *   appearance order with `~/` expanded. Every other directive (`Include`,
 *   `Match`, `ServerAliveInterval`, …) lands in `skipped` — deduped
 *   case-insensitively (first spelling kept), order preserved.
 * - {@link resolveSshHost} resolves an alias with ssh's first-obtained-wins
 *   rule across ALL matching blocks (a wildcard block contributes defaults,
 *   its parameters never override an already-obtained value), but only
 *   names concretely declared by some block — a literal, non-negated
 *   pattern equal to the name — resolve at all; anything else returns
 *   undefined (a wildcard-only match must not fabricate a target).
 *
 * @module dashr/remote/ssh-config
 */

import { homedir } from 'node:os'

export interface SshConfigEntry {
  /** 首个 Host 模式行的第一个模式（别名），如 'dev3' */
  host: string
  hostName?: string
  user?: string
  port?: number
  identityFiles: string[]   // `~/` 已展开，按出现序
  proxyJump?: string
}
export interface ParsedSshConfig { entries: SshConfigEntry[]; skipped: string[] } // skipped: Include/Match 等不支持指令

/** Per-entry Host-line pattern lists — module-private, so the public entry shape stays exactly as declared. */
const PATTERNS = new WeakMap<SshConfigEntry, string[]>()

/** ssh pattern → anchored case-insensitive RegExp: `*` = any run, `?` = exactly one char. */
function patternRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\*?]/g, (ch) =>
    ch === '*' ? '[\\s\\S]*'
    : ch === '?' ? '.'
    : `\\${ch}`)
  return new RegExp(`^${source}$`, 'i')
}

/**
 * First positively matching pattern of a block's pattern list, or undefined
 * when a `!pat` negation excludes the name (whole block does not match).
 */
function matchBlock(patterns: string[], name: string): string | undefined {
  let firstMatched: string | undefined
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (patternRegExp(pattern.slice(1)).test(name)) return undefined
    } else if (firstMatched === undefined && patternRegExp(pattern).test(name)) {
      firstMatched = pattern
    }
  }
  return firstMatched
}

/** `~` / `~/` prefix → real home directory (IdentityFile only). */
function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return homedir() + path.slice(1)
  return path
}

export function parseSshConfig(text: string): ParsedSshConfig {
  const entries: SshConfigEntry[] = []
  const skipped: string[] = []
  const skippedSeen = new Set<string>()
  let current: SshConfigEntry | undefined

  // 记入 skipped：去重（key 大小写不敏感）、保序、保留首次书写形式
  const skip = (key: string) => {
    const lower = key.toLowerCase()
    if (!skippedSeen.has(lower)) {
      skippedSeen.add(lower)
      skipped.push(key)
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    // key 与 value 以空白或 `=` 分隔：`HostName x` / `HostName= x` / `HostName=x` 同形
    const match = /^([^\s=]+)\s*(?:=\s*)?(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]!
    const value = (match[2] ?? '').trim()

    if (key.toLowerCase() === 'host') {
      const patterns = value.split(/[\s,]+/).filter((p) => p !== '')
      if (patterns.length === 0) { skip(key); continue } // 退化：无模式的 Host 行
      current = { host: patterns[0]!, identityFiles: [] }
      PATTERNS.set(current, patterns)
      entries.push(current)
      continue
    }

    switch (key.toLowerCase()) {
      case 'hostname':
        if (current !== undefined && current.hostName === undefined) current.hostName = value
        break
      case 'user':
        if (current !== undefined && current.user === undefined) current.user = value
        break
      case 'port': {
        if (current === undefined) break
        const port = /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined
        if (current.port === undefined) {
          if (port === undefined) skip(key) // 首个 Port 值非法 → 记为不支持
          else current.port = port
        }
        break
      }
      case 'identityfile':
        if (current !== undefined) current.identityFiles.push(expandHome(value))
        break
      case 'proxyjump':
        if (current !== undefined && current.proxyJump === undefined) current.proxyJump = value
        break
      default:
        skip(key) // Include / Match 及一切未支持指令
    }
  }

  return { entries, skipped }
}

/** ssh 语义：别名精确命中优先；否则自上而下第一个模式匹配的块；参数跨块 first-obtained-wins */
export function resolveSshHost(entries: SshConfigEntry[], name: string): SshConfigEntry | undefined {
  const lower = name.toLowerCase()
  // 存在性门槛：名字必须被某个块以字面（无通配、非否定）模式声明——通配块只是
  // 默认值来源，不得为任意名字凭空造出条目。
  const declared = entries.some((entry) =>
    (PATTERNS.get(entry) ?? [entry.host]).some((pattern) =>
      !pattern.startsWith('!') && !/[*?]/.test(pattern) && pattern.toLowerCase() === lower))
  if (!declared) return undefined

  const resolved: SshConfigEntry = { host: name, identityFiles: [] }
  for (const entry of entries) {
    if (matchBlock(PATTERNS.get(entry) ?? [entry.host], name) === undefined) continue
    if (resolved.hostName === undefined) resolved.hostName = entry.hostName
    if (resolved.user === undefined) resolved.user = entry.user
    if (resolved.port === undefined) resolved.port = entry.port
    if (resolved.proxyJump === undefined) resolved.proxyJump = entry.proxyJump
    resolved.identityFiles.push(...entry.identityFiles)
  }
  return resolved
}
