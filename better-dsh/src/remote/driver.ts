import { runOneShot } from './oneshot.ts'
import { PtyPool } from './pty-session.ts'
import { tailWindow } from './nonce-framing.ts'
import { resolveTarget, type TargetPlan } from './target.ts'
import { buildOneShotArgv, buildPtyArgv, buildSpawnArgv } from './transports.ts'

export interface RemoteCallParams {
  target?: string
  spawn?: string
  cmd: string
  mode?: 'oneshot' | 'pty'
  stdin?: string
  timeout?: number
}

export interface RemoteCallResult {
  mode: 'oneshot' | 'pty'
  target: string
  exit: number | null
  cwd: string | null
  timedOut: boolean
  reconnected: boolean
  stdout: string
  stderr?: string
  durationMs: number
  truncated?: number
}

export interface RemoteAuditRecord {
  target: string
  cmd: string
  cwd?: string
  exit?: number | null
  durationMs?: number
  error?: string
}

export interface RemoteDriverOptions {
  containers?: Record<string, string>
  execTimeoutSec?: number
  idleTtlSec?: number
  maxOutputChars?: number
  onAudit?: (r: RemoteAuditRecord) => void
  oneshotArgvFor?: (plan: TargetPlan, cmd: string) => string[]
  ptyArgvFor?: (plan: TargetPlan) => string[]
  spawnArgvFor?: (spawnCommand: string) => string[]
}

/** 双轨调度器（spec §七 Phase 2）：参数校验 → 路由 → oneshot 子进程 / pty 会话池。 */
export class RemoteDriver {
  private readonly pool: PtyPool
  constructor(private readonly opts: RemoteDriverOptions = {}) {
    this.pool = new PtyPool({ idleTtlSec: opts.idleTtlSec ?? 600 })
  }

  async call(params: RemoteCallParams, callCtx: { sessionKey?: string } = {}): Promise<RemoteCallResult> {
    const started = Date.now()
    try {
      const routing = this.route(params)
      const result = await this.execute(params, routing, callCtx)
      this.opts.onAudit?.({
        target: routing.display, cmd: params.cmd, cwd: result.cwd ?? undefined,
        exit: result.exit, durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      this.opts.onAudit?.({
        target: params.target ?? params.spawn ?? '?', cmd: params.cmd,
        error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started,
      })
      throw error
    }
  }

  private route(params: RemoteCallParams): { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; spawn?: string } {
    const hasTarget = params.target !== undefined && params.target.length > 0
    const hasSpawn = params.spawn !== undefined && params.spawn.length > 0
    if (hasTarget && hasSpawn)
      throw new Error('[E_PARAMS] remote: pass exactly one of target or spawn, not both')
    if (!hasTarget && !hasSpawn)
      throw new Error('[E_PARAMS] remote: target or spawn is required (e.g. { target: "dev4", cmd: "git status" })')
    if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout <= 0))
      throw new Error(`[E_BAD_TIMEOUT] remote: timeout must be a positive number of seconds (got ${JSON.stringify(params.timeout)})`)
    if (params.stdin !== undefined && (params.cmd === undefined || params.cmd.length === 0))
      throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd')
    const mode: 'oneshot' | 'pty' = hasSpawn ? 'pty' : params.mode ?? 'oneshot'
    if (hasSpawn) return { mode, display: params.spawn!, spawn: params.spawn }
    return { mode, display: params.target!, plan: resolveTarget(params.target!, this.opts.containers ?? {}) }
  }

  private async execute(params: RemoteCallParams, routing: { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; spawn?: string }, callCtx: { sessionKey?: string }): Promise<RemoteCallResult> {
    const timeoutSec = params.timeout ?? this.opts.execTimeoutSec ?? 120
    const cap = this.opts.maxOutputChars ?? 30_000
    if (routing.mode === 'oneshot') {
      const argv = (this.opts.oneshotArgvFor ?? buildOneShotArgv)(routing.plan!, params.cmd)
      const r = await runOneShot(argv, { stdin: params.stdin, timeoutSec })
      const out = tailWindow(r.stdout, cap)
      const err = r.stderr.length > 0 ? tailWindow(r.stderr, cap) : undefined
      return {
        mode: 'oneshot', target: routing.display, exit: r.exit, cwd: null,
        timedOut: r.timedOut, reconnected: false, stdout: out.text,
        ...(err !== undefined ? { stderr: err.text } : {}), durationMs: r.durationMs,
        ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
      }
    }
    const argv = routing.spawn !== undefined
      ? (this.opts.spawnArgvFor ?? buildSpawnArgv)(routing.spawn)
      : (this.opts.ptyArgvFor ?? buildPtyArgv)(routing.plan!)
    const key = `${callCtx.sessionKey ?? 'no-session'}|${routing.spawn !== undefined ? `s:${routing.spawn}` : `t:${routing.display}`}`
    const session = this.pool.getOrCreate(key, argv)
    const r = await session.dispatch(params.cmd, { stdin: params.stdin, timeoutSec })
    const out = tailWindow(r.output, cap)
    return {
      mode: 'pty', target: routing.display, exit: r.exit, cwd: r.cwd,
      timedOut: r.timedOut, reconnected: r.reconnected, stdout: out.text,
      durationMs: r.durationMs, ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
    }
  }

  async dispose(): Promise<void> { await this.pool.disposeAll() }
}
