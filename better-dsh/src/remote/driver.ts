import { runOneShot } from './oneshot.ts'
import { PtyPool, displayKey } from './pty-session.ts'
import { tailWindow } from './nonce-framing.ts'
import { resolveTarget, type TargetPlan } from './target.ts'
import { probeTarget, renderProbe, renderSession, renderPtySession, type ProbeOptions } from './status.ts'
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
  /** `byop:<label>` 调用面：本会话的 label（模型自选、即复用入口）。transport target 会话不带。 */
  session?: string
  /** 引导/教学行（同 label 重复给 spawn 时的「可省略 spawn」提示等）；无则省略。 */
  notice?: string
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

/** PTY 选择器路由面：label 必有；spawn 只在「首次创建该 label」的那一次调用里出现。 */
interface PtyRouting { label: string; spawn?: string }

/** 裸名候选表解析结果：命中三段之一 = transport plan；末位命中池内活 PTY = pty label；全不中 = ssh 兜底。 */
type BareResolution = TargetPlan | { kind: 'pty'; label: string }

/** PTY label 字符集：只禁空白 / `:` / 控制字符（roster 一行一 label，带换行的 label 渲染即烂）。 */
const PTY_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

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
   * Ruling P20 + PTY 候选表末位：裸名按名匹配——ssh config 字面 host → docker → incus（本地廉价扫描，
   * 撞名 ssh 优先），三段全不中再看池内活 PTY label，最后才是默认 ssh（交原生错误）。
   * 位置即优先级：现有三段一位不挪。选择器前缀的 target 不经此路径。
   */
  private async resolveBareName(name: string, sessionKey: string, usePtyLabels = true): Promise<BareResolution> {
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
    // 候选表末位 = 池内活 PTY label（三段之后、ssh 兜底之前）。usePtyLabels=false：调用面显式要
    // oneshot 时不吃这个候选，裸名在 mode:'oneshot' 下的旧行为逐位保留。
    if (usePtyLabels && this.pool.get(`${sessionKey}|p:${name}`) !== undefined) return { kind: 'pty', label: name }
    return { kind: 'ssh', host: name }
  }

  /** Ruling P19：roster = 注意力入口——本地廉价扫描（ssh config/docker ps/incus list + 池内活会话），零拨号。
   *  活的 pty 会话按调用方 agent session 过滤（2026-10-03 裁决）：ssh/docker/incus 是**公共静态配置**，
   *  而活会话是**操作环境**——复用别的 agent 留下的 shell 等于继承未知状态，且两个 agent 各开一条线
   *  的代价可忽略。BYO-PTY 天然是活的，于是自然落进这个 scope，无需另立规则。 */
  async roster(callCtx: { sessionKey?: string } = {}): Promise<string> {
    const prefix = `${callCtx.sessionKey ?? 'no-session'}|`
    const sessions = this.pool.list()
      .filter(({ key }) => key.startsWith(prefix))
      .map(({ key, snapshot }) => ({
        target: displayKey(key),
        state: snapshot.state,
        idleSec: snapshot.idleMs !== null ? Math.round(snapshot.idleMs / 1000) : null,
      }))
    return await renderRoster(sessions, this.opts.rosterRunner !== undefined ? { runner: this.opts.rosterRunner } : {})
  }

  async status(target: string, callCtx: { sessionKey?: string } = {}): Promise<string> {
    const sessionKey = callCtx.sessionKey ?? 'no-session'
    const label = target.startsWith('byop:') ? target.slice(5) : undefined
    if (label !== undefined) return this.ptyStatus(target, label, sessionKey)
    const direct = /^(docker|incus|ssh):/.test(target)
    const resolved: BareResolution = direct ? resolveTarget(target) : await this.resolveBareName(target, sessionKey)
    if (resolved.kind === 'pty') return this.ptyStatus(`byop:${resolved.label}`, resolved.label, sessionKey)
    const head = `${target} — ${resolved.kind === 'ssh' ? 'ssh host' : `${resolved.kind} container`}`
    const probe = await probeTarget(resolved, { runner: this.opts.probeRunner })
    return [head, renderProbe(probe), renderSession(this.pool.inspect(`${sessionKey}|t:${target}`))].join('\n')
  }

  /** PTY 状态行：纯池内读取，零拨号（label 从来不是可拨目标）。 */
  private ptyStatus(display: string, label: string, sessionKey: string): string {
    return [`${display} — BYO pty session`, renderPtySession(this.pool.inspect(`${sessionKey}|p:${label}`))].join('\n')
  }

  /** Ruling 13：审计 best-effort——钩子抛错不得影响命令路径（成功被毒化成失败+双重审计）。 */
  private audit(r: RemoteAuditRecord): void {
    try { this.opts.onAudit?.(r) } catch { /* audit hook failure is never the command's failure */ }
  }

  private route(params: RemoteCallParams): { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; bare?: string; pty?: PtyRouting } {
    const hasTarget = params.target !== undefined && params.target.length > 0
    const hasSpawn = params.spawn !== undefined && params.spawn.length > 0
    if (!hasTarget && !hasSpawn)
      throw new Error('[E_PARAMS] remote: target is required (e.g. { target: "dev4", cmd: "git status" }); spawn is a modifier of a "byop:<label>" target and cannot stand alone')
    if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout <= 0))
      throw new Error(`[E_BAD_TIMEOUT] remote: timeout must be a positive number of seconds (got ${JSON.stringify(params.timeout)})`)
    if (params.stdin !== undefined && (params.cmd === undefined || params.cmd.length === 0))
      throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd')
    // PTY 选择器 = BYO-PTY 的唯一入口：label 由模型自选（可读 → 可复用），spawn 只是它的伴生创建参数。
    if (hasTarget && params.target!.startsWith('byop:')) {
      const label = params.target!.slice(5)
      if (!PTY_LABEL_RE.test(label))
        throw new Error(`[E_BAD_LABEL] remote: PTY label must match ${PTY_LABEL_RE.source} (got ${JSON.stringify(label)}) — e.g. target: "byop:dev3"`)
      if (params.mode !== undefined && params.mode !== 'pty')
        throw new Error(`[E_BAD_MODE] remote: "${params.target}" is a PTY selector — mode is locked to 'pty'`)
      return { mode: 'pty', display: params.target!, pty: { label, ...(hasSpawn ? { spawn: params.spawn! } : {}) } }
    }
    if (hasSpawn)
      throw new Error('[E_PARAMS] remote: spawn requires a "byop:<label>" target — e.g. { target: "byop:dev3", spawn: "ssh dev3", cmd: "…" }; it is not a standalone entry point')
    const mode: 'oneshot' | 'pty' = params.mode ?? 'oneshot'
    // P20：带选择器前缀的 target 走同步解析；裸名延迟到 execute 的按名匹配（异步本地扫描）。
    const direct = /^(docker|incus|ssh):/.test(params.target!)
    return { mode, display: params.target!, ...(direct ? { plan: resolveTarget(params.target!) } : { bare: params.target! }) }
  }

  private async execute(
    params: RemoteCallParams,
    routing: { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; bare?: string; pty?: PtyRouting },
    callCtx: { sessionKey?: string },
  ): Promise<RemoteCallResult> {
    const sessionKey = callCtx.sessionKey ?? 'no-session'
    if (routing.bare !== undefined) {
      // 裸名候选表（含末位 PTY 候选）解析；命中 PTY 则就地切通道 + 切 mode。
      // usePtyLabels：仅「显式 mode:'oneshot'」不吃末位候选——未指定 mode 的裸名照样命中，
      // 否则懒复用（只写 label 不写 PTY 选择器）不可能成立。
      const resolved = await this.resolveBareName(routing.bare, sessionKey, params.mode !== 'oneshot')
      if (resolved.kind === 'pty') {
        routing.pty = { label: resolved.label }
        routing.mode = 'pty'
        routing.display = `byop:${resolved.label}`
      } else routing.plan = resolved
    }
    const timeoutSec = params.timeout ?? this.opts.execTimeoutSec ?? 120
    const cap = this.opts.maxOutputChars ?? 30_000
    if (routing.pty !== undefined) return await this.ptyCall(routing.pty, params, sessionKey, timeoutSec, cap)
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
    const argv = (this.opts.ptyArgvFor ?? buildPtyArgv)(routing.plan!)
    const key = `${sessionKey}|t:${routing.display}`
    const session = this.pool.getOrCreate(key, argv)
    const r = await session.dispatch(params.cmd, { stdin: params.stdin, timeoutSec })
    const out = tailWindow(r.output, cap)
    return {
      mode: 'pty', target: routing.display, exit: r.exit, cwd: r.cwd,
      timedOut: r.timedOut, reconnected: r.reconnected, stdout: out.text,
      durationMs: r.durationMs, ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
    }
  }

  /** BYO-PTY 通道：label 即池键（agent 前缀之外），spawn 只在 label 尚不存在时被接受。
   * 三分支 —— 建（无会话）/ 复用（无 spawn，或有 spawn 且与创建来源相同）/ **冲突（有 spawn 且来源不同：不执行任何命令）**。 */
  private async ptyCall(
    pty: PtyRouting,
    params: RemoteCallParams,
    sessionKey: string,
    timeoutSec: number,
    cap: number,
  ): Promise<RemoteCallResult> {
    const display = `byop:${pty.label}`
    const key = `${sessionKey}|p:${pty.label}`
    const existing = this.pool.get(key)
    let session = existing
    let notice: string | undefined
    if (existing !== undefined && pty.spawn !== undefined && existing.origin !== pty.spawn)
      throw new Error(
        `[E_LABEL_CONFLICT] remote: ${display} already exists and was created by a different command — nothing was run.\n` +
          `  existing spawn: ${JSON.stringify(existing.origin)}\n` +
          `  given spawn:    ${JSON.stringify(pty.spawn)}\n` +
          `  To reuse it:    { target: "${display}", cmd: "…" }   (drop spawn — spawn only ever creates)\n` +
          `  To start new:   pick another label, e.g. { target: "byop:${pty.label}2", spawn: ${JSON.stringify(pty.spawn)}, cmd: "…" }`,
      )
    if (session === undefined) {
      if (pty.spawn === undefined)
        throw new Error(
          `[E_NO_SESSION] remote: no live PTY under ${display} — one exists only after a call that supplies spawn, and it is reaped after the idle TTL (600s).\n` +
            `  Create it:      { target: "${display}", spawn: "…", cmd: "…" }   (the spawn command is not retained; the label is yours to choose)`,
        )
      session = this.pool.getOrCreate(key, (this.opts.spawnArgvFor ?? buildSpawnArgv)(pty.spawn), pty.spawn)
    } else if (pty.spawn !== undefined) {
      notice = `[remote: ${display} already runs that exact command and is persistent — reuse it with { target: "${display}", cmd: "…" }; spawn is only needed to create.]`
    }
    const r = await session.dispatch(params.cmd, { stdin: params.stdin, timeoutSec })
    const out = tailWindow(r.output, cap)
    return {
      mode: 'pty', target: display, session: display, exit: r.exit, cwd: r.cwd,
      timedOut: r.timedOut, reconnected: r.reconnected, stdout: out.text,
      ...(notice !== undefined ? { notice } : {}),
      durationMs: r.durationMs, ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
    }
  }

  async dispose(): Promise<void> { await this.pool.disposeAll() }
}
