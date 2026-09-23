import { spawn, type ChildProcess } from 'node:child_process'
import { buildInitCommand, createNonceFrameParser, genNonce, wrapPtyCommand } from './nonce-framing.ts'

/** spec §五.2 逐字。 */
export const RECONNECT_NOTICE = '[remote: session reconnected to fresh shell; cwd reset to default]'

export interface PtySessionOptions {
  key: string
  argv: string[]
  idleTtlSec: number
  initTimeoutSec?: number
  /** 池回调：会话彻底出池（dispose）时触发；进程意外死亡不出池（Ruling 7）。 */
  onDead?: () => void
}

export interface PtyDispatchOptions { stdin?: string; timeoutSec?: number }
export interface PtyDispatchResult {
  output: string
  exit: number | null
  cwd: string | null
  timedOut: boolean
  reconnected: boolean
  durationMs: number
}

export type PtyState = 'cold' | 'starting' | 'ready' | 'dead' | 'disposed'

/** 会话运行时快照（status 面消费，Ruling 16 词汇源）。 */
export interface SessionSnapshot { state: PtyState; busy: boolean; idleMs: number | null; pid: number | null }

const DEFAULT_INIT_TIMEOUT_SEC = 30
const INTERRUPT_GRACE_MS = 3_000

export class PtySession {
  private proc: ChildProcess | null = null
  private state: PtyState = 'cold'
  private startPromise: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null
  private onChunk: ((c: string) => void) | null = null
  private deathWaiters: Array<() => void> = []
  private diag = ''
  private inFlight = 0
  private lastSettleAt = 0

  constructor(private readonly opts: PtySessionOptions) {}

  get sessionState(): PtyState { return this.state }

  /** status 面快照：state + busy（有命令在跑）+ idleMs（上次 settle 至今）+ pid（进程组头，kill 兜底可观测）。 */
  get snapshot(): SessionSnapshot {
    return { state: this.state, busy: this.inFlight > 0, idleMs: this.lastSettleAt > 0 ? Date.now() - this.lastSettleAt : null, pid: this.proc?.pid ?? null }
  }

  /** 同一会话命令严格串行（FIFO）；死亡/冷态先重启。 */
  dispatch(cmd: string, dOpts: PtyDispatchOptions = {}): Promise<PtyDispatchResult> {
    const attempt = async (): Promise<PtyDispatchResult> => {
      const started = Date.now()
      const reconnected = this.state === 'dead'
      if (this.state !== 'ready') await this.start()
      this.inFlight++
      return await new Promise<PtyDispatchResult>((resolve) => {
        const nonce = genNonce()
        let output = ''
        let interrupted = false
        let settled = false
        let interruptTimer: NodeJS.Timeout | undefined
        let killTimer: NodeJS.Timeout | undefined
        const cleanup = (): void => {
          this.onChunk = null
          if (interruptTimer !== undefined) clearTimeout(interruptTimer)
          if (killTimer !== undefined) clearTimeout(killTimer)
        }
        const finish = (r: Omit<PtyDispatchResult, 'durationMs' | 'reconnected'>): void => {
          if (settled) return
          settled = true
          cleanup()
          this.inFlight--
          this.lastSettleAt = Date.now()
          this.resetIdleTimer()
          resolve({ ...r, reconnected, durationMs: Date.now() - started })
        }
        const parser = createNonceFrameParser(nonce, {
          onOutput: (t) => { output += t },
          onFrame: ({ exit, cwd }) => finish({ output, exit, cwd, timedOut: interrupted }),
        })
        this.onChunk = (c) => parser.feed(c)
        this.write(wrapPtyCommand(cmd, nonce))
        if (dOpts.stdin !== undefined) this.write(dOpts.stdin) // Ruling 11: REPL 式紧随
        interruptTimer = setTimeout(() => {
          interrupted = true
          // P8 两段打断：\x03 中断前台作业后，交互 bash 会放弃当前命令行的剩余部分
          // （尾部 marker 不再执行）；紧随注入的同 nonce 130-marker 行在 bash 回到
          // 读取态后被执行。无论 bash 弃行还是续行，帧都在宽限内到达且 exit=130，
          // 会话存活；若命令 trap 掉 SIGINT，原 marker 先帧、注入行帧后字节被丢弃。
          this.write('\x03')
          this.write(`printf '\\033]133;D;${nonce};130;%s\\007' "$PWD"\n`)
          killTimer = setTimeout(() => {
            // Ruling 8 的 kill 兜底：宽限无帧 = 会话不可恢复，杀整组后收尸
            // （否则 trap-INT 的卡死进程永生，重连后旧组再不可达）
            this.killTree()
            this.markDead()
            finish({ output, exit: null, cwd: null, timedOut: true })
          }, INTERRUPT_GRACE_MS)
        }, dOpts.timeoutSec === undefined ? 120_000 : dOpts.timeoutSec * 1_000)
        this.deathWaiters.push(() => finish({ output, exit: null, cwd: null, timedOut: interrupted }))
      })
    }
    const run = this.queue.then(attempt, attempt)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** TTL / row teardown：尽力 exit，1s 后杀组，出池。 */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') return
    this.clearIdleTimer()
    this.state = 'disposed'
    this.startPromise = null
    this.write('exit\n')
    setTimeout(() => this.killTree(), 1_000).unref()
    this.opts.onDead?.()
  }

  private write(s: string): void {
    if (this.proc?.stdin?.writable !== true) return
    try { this.proc.stdin.write(s) } catch { /* dead: death waiter settles the dispatch */ }
  }

  private async start(): Promise<void> {
    if (this.state === 'disposed')
      throw new Error(`[E_SESSION_DISPOSED] remote pty session '${this.opts.key}' was disposed — the pool replaces disposed sessions; this reference is stale`)
    if (this.startPromise === null) {
      this.state = 'starting'
      this.startPromise = this.doStart().catch((err: unknown) => {
        this.startPromise = null
        this.markDead()
        throw err
      })
    }
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    const proc = spawn(this.opts.argv[0]!, this.opts.argv.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Ruling 9: 进程组杀法
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => { this.onChunk?.(d) })
    proc.stderr.setEncoding('utf8').on('data', (d: string) => { this.diag = (this.diag + d).slice(-2_000) })
    proc.once('close', () => this.markDead())
    proc.once('error', (err) => { this.diag = (this.diag + `\n[remote: spawn failed: ${err.message}]`).slice(-2_000) })

    const initTimeoutSec = this.opts.initTimeoutSec ?? DEFAULT_INIT_TIMEOUT_SEC
    const initNonce = genNonce()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.killTree()
        reject(new Error(
          `[E_SESSION_START] remote pty session '${this.opts.key}' did not initialize in ${initTimeoutSec}s` +
          (this.diag.length > 0 ? `; transport stderr tail: ${this.diag}` : '')))
      }, initTimeoutSec * 1_000)
      const waiter = (): void => {
        clearTimeout(timer)
        reject(new Error(
          `[E_SESSION_DIED] remote pty session '${this.opts.key}' died before initializing` +
          (this.diag.length > 0 ? `; transport stderr tail: ${this.diag}` : '')))
      }
      this.deathWaiters.push(waiter)
      const parser = createNonceFrameParser(initNonce, {
        onFrame: () => {
          clearTimeout(timer)
          this.deathWaiters = this.deathWaiters.filter((w) => w !== waiter)
          if (this.state === 'disposed') {
            // dispose 竞态 init：不得复活已终态会话（否则重挂 idle timer + 幽灵 ready）
            reject(new Error(`[E_SESSION_DISPOSED] remote pty session '${this.opts.key}' disposed during init`))
            return
          }
          this.state = 'ready'
          this.resetIdleTimer()
          resolve()
        },
      })
      this.onChunk = (c) => parser.feed(c)
      this.write(buildInitCommand(initNonce))
    })
  }

  private markDead(): void {
    if (this.state === 'disposed') {
      // dispose 是终态：不再翻转 state，但在飞 dispatch 的死亡等待仍需立即结算
      // （row teardown 不是超时——不得等 123s 看门狗，也不得错标 timedOut）
      const waiters = this.deathWaiters
      this.deathWaiters = []
      for (const w of waiters) w()
      return
    }
    this.state = 'dead'
    this.startPromise = null
    this.clearIdleTimer()
    const waiters = this.deathWaiters
    this.deathWaiters = []
    for (const w of waiters) w()
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => void this.dispose(), this.opts.idleTtlSec * 1_000)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  private killTree(): void {
    const pid = this.proc?.pid
    this.proc = null
    if (pid === undefined) return
    try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }, 2_000).unref()
  }
}

export interface PtyPoolDefaults { idleTtlSec: number; initTimeoutSec?: number }

/** 会话池：键 → 会话。意外死亡的会话留在池内（下次 dispatch 带 reconnect 提示）。 */
export class PtyPool {
  private readonly sessions = new Map<string, PtySession>()

  constructor(private readonly defaults: PtyPoolDefaults) {}

  get size(): number { return this.sessions.size }

  /** status 面：键上的会话快照（无会话 = undefined → "none — dials on first exec"）。 */
  inspect(key: string): SessionSnapshot | undefined {
    return this.sessions.get(key)?.snapshot
  }

  getOrCreate(key: string, argv: string[]): PtySession {
    let s = this.sessions.get(key)
    if (s === undefined || s.sessionState === 'disposed') {
      s = new PtySession({ key, argv, ...this.defaults, onDead: () => this.sessions.delete(key) })
      this.sessions.set(key, s)
    }
    return s
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()))
    this.sessions.clear()
  }
}
