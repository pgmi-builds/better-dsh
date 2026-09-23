/**
 * Roster — the attention entry point (plan Ruling P19): `remote({})` lists
 * known target NAMES from local sources only (zero dialing, zero
 * reachability checks — those belong to the per-target on-demand probe):
 *
 * - ssh hosts parsed from `~/.ssh/config` (literal aliases; wildcard-only
 *   blocks are defaults, not targets, and are not listed);
 * - docker containers (`docker ps -a`, name + state);
 * - incus containers (`incus list`, name + state);
 * - live pty sessions (the one thing the model cannot see with its own
 *   tools — the daemon-side pool inventory).
 *
 * Everything is a cheap local scan; each section degrades independently and
 * honestly (native error one-liner, never a fabricated list).
 *
 * @module dashr/remote/roster
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runOneShot, type OneShotOptions, type OneShotResult } from './oneshot.ts'
import { parseSshConfig } from './ssh-config.ts'

export interface RosterOptions {
  /** 测试缝：替代 runOneShot 的容器扫描执行器。 */
  runner?: (argv: string[], opts?: OneShotOptions) => Promise<OneShotResult>
  /** 测试缝：替代 ~/.ssh/config 读取。 */
  readSshConfig?: () => Promise<string>
  hardTimeoutSec?: number
}

function oneLine(s: string): string {
  return s.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
}

/** ssh config 里的字面别名（无通配、非否定的首个模式）；通配块是默认值来源不是目标。 */
export function literalHosts(text: string): { hosts: string[]; wildcardBlocks: number } {
  const { entries } = parseSshConfig(text)
  const hosts: string[] = []
  let wildcardBlocks = 0
  for (const entry of entries) {
    if (/[*?]/.test(entry.host) || entry.host.startsWith('!')) wildcardBlocks++
    else hosts.push(entry.host)
  }
  return { hosts, wildcardBlocks }
}

/**
 * Build the roster text. Sections render independently; a failing section
 * renders its native error (honest vocabulary: never invent, never hide).
 */
export async function renderRoster(
  sessions: ReadonlyArray<{ target: string; state: string; idleSec: number | null }>,
  opts: RosterOptions = {},
): Promise<string> {
  const runner = opts.runner ?? runOneShot
  const readSshConfig = opts.readSshConfig ?? (async () => await readFile(join(homedir(), '.ssh', 'config'), 'utf8'))
  const hard = opts.hardTimeoutSec ?? 10
  const lines: string[] = []

  // ssh hosts
  try {
    const text = await readSshConfig()
    const { hosts, wildcardBlocks } = literalHosts(text)
    lines.push(`ssh hosts (~/.ssh/config): ${hosts.length > 0 ? hosts.join(', ') : '(none)'}${wildcardBlocks > 0 ? ` (+${wildcardBlocks} wildcard default blocks, not listed)` : ''}`)
  } catch (error) {
    lines.push(`ssh hosts: no readable ~/.ssh/config (${error instanceof Error ? error.message : String(error)})`)
  }

  // docker containers
  const docker = await runner(['docker', 'ps', '-a', '--format', '{{.Names}}\t{{.State}}'], { timeoutSec: hard })
  if (docker.exit === 0) {
    const rows = docker.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => {
      const [name, state] = l.split('\t')
      return `${name}${state !== undefined && state !== '' ? ` (${state})` : ''}`
    })
    lines.push(`docker containers: ${rows.length > 0 ? rows.join(', ') : '(none)'}`)
  } else {
    lines.push(`docker containers: unavailable — ${docker.timedOut ? `scan timed out after ${hard}s` : oneLine(docker.stderr) || `docker exited ${docker.exit}`}`)
  }

  // incus containers
  const incus = await runner(['incus', 'list', '--format', 'csv', '--columns', 'ns'], { timeoutSec: hard })
  if (incus.exit === 0) {
    const rows = incus.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => {
      const [name, state] = l.split(',')
      return `${name}${state !== undefined && state !== '' ? ` (${state.trim()})` : ''}`
    })
    lines.push(`incus containers: ${rows.length > 0 ? rows.join(', ') : '(none)'}`)
  } else {
    lines.push(`incus containers: unavailable — ${incus.timedOut ? `scan timed out after ${hard}s` : oneLine(incus.stderr) || `incus exited ${incus.exit}`}`)
  }

  // live pty sessions (daemon-side pool — invisible to the model's own tools)
  lines.push(sessions.length > 0
    ? `live pty sessions: ${sessions.map((s) => `${s.target} [${s.state}${s.idleSec !== null ? `, idle ${s.idleSec}s` : ''}]`).join(', ')}`
    : 'live pty sessions: none')

  return lines.join('\n')
}
