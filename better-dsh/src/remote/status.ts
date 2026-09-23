import { runOneShot, type OneShotOptions, type OneShotResult } from './oneshot.ts'
import type { SessionSnapshot } from './pty-session.ts'
import type { TargetPlan } from './target.ts'

/** Ruling 16 词汇表的机器面。 */
export type ProbeOutcome =
  | { state: 'reachable'; rttMs: number }
  | { state: 'unreachable'; detail: string }
  | { state: 'container'; status: string }
  | { state: 'error'; detail: string }

export interface ProbeOptions {
  connectTimeoutSec?: number
  hardTimeoutSec?: number
  runner?: (argv: string[], opts?: OneShotOptions) => Promise<OneShotResult>
}

function oneLine(s: string): string {
  return s.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
}

/**
 * On-demand 探测（Ruling 17）：调用瞬间拨一次，双重超时（ssh ConnectTimeout
 * 5s + 外层 hard 10s），结果即当时事实。绝不缓存、绝不在 boot 时扫。
 */
export async function probeTarget(plan: TargetPlan, opts: ProbeOptions = {}): Promise<ProbeOutcome> {
  const ct = opts.connectTimeoutSec ?? 5
  const hard = opts.hardTimeoutSec ?? 10
  const runner = opts.runner ?? runOneShot
  const started = Date.now()
  const argv =
    plan.kind === 'ssh'
      ? ['ssh', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${ct}`, '-T', '--', plan.host, 'true']
      : plan.kind === 'docker'
        ? ['docker', 'inspect', '--format', '{{.State.Status}}', plan.container]
        : ['incus', 'list', plan.container, '--format', 'csv', '--columns', 'ns']
  const r = await runner(argv, { timeoutSec: hard })
  if (plan.kind === 'ssh') {
    if (r.exit === 0 && !r.timedOut) return { state: 'reachable', rttMs: Date.now() - started }
    const detail = r.timedOut
      ? `probe timed out after ${hard}s`
      : oneLine(r.stderr) || `ssh exited ${r.exit}`
    return { state: 'unreachable', detail }
  }
  if (plan.kind === 'docker') {
    if (r.exit === 0 && !r.timedOut) return { state: 'container', status: r.stdout.trim() }
    return { state: 'error', detail: oneLine(r.stderr) || `docker inspect exited ${r.exit}` }
  }
  const row = r.stdout.trim().split(/\r?\n/).find((l) => l.split(',')[0] === plan.container)
  if (r.exit === 0 && !r.timedOut && row !== undefined) return { state: 'container', status: row.split(',')[1]?.trim() ?? 'unknown' }
  if (r.exit === 0 && !r.timedOut) return { state: 'error', detail: `incus list has no container named '${plan.container}'` }
  return { state: 'error', detail: oneLine(r.stderr) || `incus exited ${r.exit}` }
}

export function renderProbe(p: ProbeOutcome): string {
  switch (p.state) {
    case 'reachable': return `probe: reachable in ${p.rttMs}ms (just now, on demand)`
    case 'unreachable': return `probe: unreachable — ${p.detail}`
    case 'error': return `probe: error — ${p.detail}`
    case 'container': return `probe: container ${p.status} (just now, on demand)`
  }
}

/**
 * 唯一偏离 brief 处：brief 的 renderSession 测试以不含 `pid` 的三字段字面量直呼本函数，而
 * SessionSnapshot.pid 为必填 → 按测试意图（会话层词汇只由 state/busy/idleMs 决定）收窄为
 * 结构子集；传完整 SessionSnapshot 仍然成立，运行时语义零变化。
 */
export function renderSession(s: Pick<SessionSnapshot, 'state' | 'busy' | 'idleMs'> | undefined): string {
  if (s === undefined || s.state === 'cold' || s.state === 'starting' || s.state === 'disposed')
    return 'session: none — dials on first exec'
  if (s.state === 'dead') return 'session: died — next exec cold-starts a fresh shell'
  if (s.busy) return 'session: busy (a command is running)'
  return `session: idle ${Math.round((s.idleMs ?? 0) / 1000)}s (connected)`
}
