import { runOneShot } from './oneshot.ts'
import { PtyPool } from './pty-session.ts'
import { tailWindow } from './nonce-framing.ts'
import { resolveTarget, type TargetPlan } from './target.ts'
import { probeTarget, renderProbe, renderSession, type ProbeOptions } from './status.ts'
import { renderRoster, type RosterOptions } from './roster.ts'
import { literalHosts } from './roster.ts'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
  execTimeoutSec?: number
  idleTtlSec?: number
  maxOutputChars?: number
  onAudit?: (r: RemoteAuditRecord) => void
  oneshotArgvFor?: (plan: TargetPlan, cmd: string) => string[]
  ptyArgvFor?: (plan: TargetPlan) => string[]
  spawnArgvFor?: (spawnCommand: string) => string[]
  probeRunner?: ProbeOptions['runner']
  /** 测试缝：roster 扫描执行器（bare-name 解析复用）。 */
  rosterRunner?: RosterOptions['runner']
  /** 测试缝：ssh config 读取（bare-name 解析复用）。 */
  sshConfigReader?: () => Promise<string>
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
      this.audit({
        target: routing.display, cmd: params.cmd, cwd: result.cwd ?? undefined,
        exit: result.exit, durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      this.audit({
        target: params.target ?? params.spawn ?? '?', cmd: params.cmd,
        error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started,
      })
      throw error
    }
  }

  /** Ruling 16/17：on-demand 探测 + 会话层，两行如实陈述。 */
  /**
   * Ruling P20：裸名先按名匹配——ssh config 字面 host → docker → incus（本地廉价扫描，
   * 撞名 ssh 优先，查无 → 默认 ssh 交原生错误）。选择器前缀的 target 不经此路径。
   */
  private async resolveBareName(name: string): Promise<TargetPlan> {
    const runner = this.opts.rosterRunner ?? runOneShot
    const readCfg = this.opts.sshConfigReader ?? (async () => await readFile(join(homedir(), '.ssh', 'config'), 'utf8'))
    try {
      const { hosts } = literalHosts(await readCfg())
      if (hosts.some((h) => h.toLowerCase() === name.toLowerCase())) return { kind: 'ssh', host: name }
    } catch { /* 无可读 config：跳过该源 */ }
    const docker = await runner(['docker', 'ps', '-a', '--format', '{{.Names}}'], { timeoutSec: 10 })
    if (docker.exit === 0 && docker.stdout.trim().split(/\r?\n/).some((n) => n.trim().toLowerCase() === name.toLowerCase()))
      return { kind: 'docker', container: name }
    const incus = await runner(['incus', 'list', '--format', 'csv', '--columns', 'n'], { timeoutSec: 10 })
    if (incus.exit === 0 && incus.stdout.trim().split(/\r?\n/).some((n) => n.split(',')[0]?.trim().toLowerCase() === name.toLowerCase()))
      return { kind: 'incus', container: name }
    return { kind: 'ssh', host: name }
  }

  /** Ruling P19：roster = 注意力入口——本地廉价扫描（ssh config/docker ps/incus list + 池内活会话），零拨号。 */
  async roster(): Promise<string> {
    const sessions = this.pool.list().map(({ key, snapshot }) => {
      const raw = key.includes('|') ? key.slice(key.indexOf('|') + 1) : key
      // 模型面不暴露池 key 内部标记：t: 前缀剥掉，s: 渲染为 spawn:
      const target = raw.startsWith('t:') ? raw.slice(2) : raw.startsWith('s:') ? `spawn:${raw.slice(2)}` : raw
      return { target, state: snapshot.state, idleSec: snapshot.idleMs !== null ? Math.round(snapshot.idleMs / 1000) : null }
    })
    return await renderRoster(sessions, this.opts.rosterRunner !== undefined ? { runner: this.opts.rosterRunner } : {})
  }

  async status(target: string, callCtx: { sessionKey?: string } = {}): Promise<string> {
    const plan = /^(docker|incus|ssh):/.test(target) ? resolveTarget(target) : await this.resolveBareName(target)
    const head = `${target} — ${plan.kind === 'ssh' ? 'ssh host' : `${plan.kind} container`}`
    const probe = await probeTarget(plan, { runner: this.opts.probeRunner })
    const key = `${callCtx.sessionKey ?? 'no-session'}|t:${target}`
    return [head, renderProbe(probe), renderSession(this.pool.inspect(key))].join('\n')
  }

  /** Ruling 13：审计 best-effort——钩子抛错不得影响命令路径（成功被毒化成失败+双重审计）。 */
  private audit(r: RemoteAuditRecord): void {
    try { this.opts.onAudit?.(r) } catch { /* audit hook failure is never the command's failure */ }
  }

  private route(params: RemoteCallParams): { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; bare?: string; spawn?: string } {
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
    // P20：带选择器前缀的 target 走同步解析；裸名延迟到 execute 的按名匹配（异步本地扫描）。
    const direct = /^(docker|incus|ssh):/.test(params.target!)
    return { mode, display: params.target!, ...(direct ? { plan: resolveTarget(params.target!) } : { bare: params.target! }) }
  }

  private async execute(params: RemoteCallParams, routing: { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; bare?: string; spawn?: string }, callCtx: { sessionKey?: string }): Promise<RemoteCallResult> {
    if (routing.bare !== undefined) routing.plan = await this.resolveBareName(routing.bare)
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
