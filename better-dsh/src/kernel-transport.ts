/**
 * stdio transport to the Python kernel bridge (`kernel-bridge.py`).
 *
 * The host never links a native ZMQ binding: `zeromq` was a hard npm
 * dependency whose install script compiled C++ inside the consumer's install
 * transaction, and whose top-level import took the whole plugin down with it
 * whenever the binding was absent. The bridge owns pyzmq/jupyter_client —
 * transitive dependencies of the `ipykernel` this plugin already provisions —
 * and speaks JSON lines on stdio to this process.
 *
 * Message ids stay host-generated: the header built here is passed through to
 * `jupyter_client.Session.msg` verbatim, so parent-matching is unchanged from
 * the raw-socket era.
 * @module dashr/kernel-transport
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

/** Channels the bridge relays; `stdin` is unused (cells run with allow_stdin=false). */
export type TransportChannel = 'shell' | 'iopub' | 'control' | 'stdin'

/** One Jupyter message as relayed by the bridge. */
export interface TransportMessage {
  header: { msg_id: string, msg_type: string, [key: string]: unknown }
  parent_header: Record<string, unknown>
  content: Record<string, unknown>
}

/** Message handler; returning nothing, it must never throw into the reader. */
export type TransportHandler = (channel: TransportChannel, message: TransportMessage) => void

/** A one-shot wait for a specific channel message. */
interface Waiter {
  channel: TransportChannel
  match: (message: TransportMessage) => boolean
  settle: (message: TransportMessage | null) => void
  timer: ReturnType<typeof setTimeout>
}

/** The bridge script shipped beside the built entry (`lib/kernel-bridge.py`). */
const BRIDGE_SCRIPT = fileURLToPath(new URL('./kernel-bridge.py', import.meta.url))

/** Options for one bridge process. */
export interface KernelTransportOptions {
  /** Absolute interpreter path; must be the kernel environment (jupyter_client + pyzmq). */
  python: string
  /** Connection file written by the kernel and already resolved to real ports. */
  connectionFile: string
  /** Working directory for the bridge process. */
  cwd?: string
  /** Budget for the bridge to report readiness, in milliseconds. */
  readyTimeoutMs: number
}

/**
 * One bridge subprocess speaking JSON lines. Lifecycle is owned by the caller
 * (the kernel bridge registers it as an `ctx.effect`); this type installs no
 * process-level signal handlers.
 */
export class KernelTransport {
  private child?: ChildProcess
  private reader?: Interface
  private startup = false
  private closed = false
  private readySettled = false
  private readyResolve?: () => void
  private readyReject?: (error: Error) => void
  private bridgeStderr = ''
  private readonly handlers = new Set<TransportHandler>()
  private readonly waiters = new Set<Waiter>()

  constructor(private readonly options: KernelTransportOptions) { }

  /** Spawn the bridge and resolve once it reports the channels are up. */
  async start(): Promise<void> {
    if (this.reader !== undefined) return
    if (this.closed) throw new Error('kernel transport is closed')
    const child = spawn(this.options.python, [BRIDGE_SCRIPT, this.options.connectionFile], {
      ...this.options.cwd === undefined ? {} : { cwd: this.options.cwd },
      // The same scrubbed environment as the kernel spawn: an absolute
      // interpreter, no ambient credentials, HOME for interpreter caches.
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        HOME: process.env.HOME ?? tmpdir(),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.startup = true
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    const timer = setTimeout(() => {
      this.failReady(new Error(`kernel bridge did not report ready within ${this.options.readyTimeoutMs}ms; stderr tail:\n${this.stderrTail()}`))
    }, this.options.readyTimeoutMs)
    timer.unref?.()

    child.stderr?.on('data', (buffer: Buffer) => { this.bridgeStderr += buffer.toString() })
    // A bridge that died between the liveness check and a write surfaces EPIPE
    // asynchronously; without a listener Node escalates it to an uncaught
    // exception and takes the daemon down during teardown. Absorb it: the
    // transport is already dead, and every waiter is settled below.
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      this.bridgeStderr += `stdin error: ${error.code ?? error.message}\n`
      this.closed = true
      this.failWaiters()
    })
    child.stdout?.on('error', (error: NodeJS.ErrnoException) => {
      this.bridgeStderr += `stdout error: ${error.code ?? error.message}\n`
    })
    child.on('error', (error: Error) => {
      this.bridgeStderr += `spawn error: ${error.message}\n`
      this.failReady(new Error(`kernel bridge failed to spawn: ${error.message}`))
      this.failWaiters()
      this.failExit()
    })
    child.on('exit', (code, signal) => {
      const detail = `kernel bridge exited (code=${String(code)} signal=${String(signal)})`
      this.bridgeStderr += `${detail}\n`
      this.closed = true
      this.failReady(new Error(`${detail}; stderr tail:\n${this.stderrTail()}`))
      this.failWaiters()
      this.failExit()
    })
    if (child.stdout) {
      this.reader = createInterface({ input: child.stdout })
      this.reader.on('line', (line: string) => { this.accept(line) })
    }

    try {
      await ready
    } finally {
      clearTimeout(timer)
      this.startup = false
    }
  }

  /** Whether the bridge process is still live. */
  get alive(): boolean {
    return this.child !== undefined && this.child.exitCode === null && !this.closed
  }

  /** The bridge's stderr tail, for startup and crash diagnostics. */
  stderrTail(): string {
    return this.bridgeStderr.slice(-1024) || '(empty)'
  }

  /** Register a message handler; the returned function removes it. */
  onMessage(handler: TransportHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  /**
   * Register a bridge-exit handler; the returned function removes it. A bridge
   * that dies mid-cell must settle the active execution at once rather than at
   * the cell budget.
   */
  onExit(handler: () => void): () => void {
    this.exitHandlers.add(handler)
    return () => { this.exitHandlers.delete(handler) }
  }

  private readonly exitHandlers = new Set<() => void>()

  /** Notify exit handlers once per bridge process end. */
  private failExit(): void {
    const handlers = [...this.exitHandlers]
    this.exitHandlers.clear()
    for (const handler of handlers) handler()
  }

  /** Send one message on the shell or control channel. */
  send(channel: 'shell' | 'control', message: { header: TransportMessage['header'], content: Record<string, unknown> }): void {
    this.writeLine({ op: 'send', channel, header: message.header, content: message.content })
  }

  /** Ask the kernel to interrupt the running cell (control channel). */
  interrupt(): void {
    this.writeLine({ op: 'interrupt' })
  }

  /** Write one protocol line, refusing instead of throwing when the pipe is gone. */
  private writeLine(payload: Record<string, unknown>): void {
    const stdin = this.child?.stdin
    if (stdin === null || stdin === undefined || this.closed || !stdin.writable) {
      throw new Error('kernel bridge is not connected')
    }
    stdin.write(`${JSON.stringify(payload)}\n`)
  }

  /**
   * Wait for the next message on `channel` matching `match`.
   * @returns The message, or null when the budget expires or the bridge dies.
   */
  waitFor(channel: TransportChannel, match: (message: TransportMessage) => boolean, timeoutMs: number): Promise<TransportMessage | null> {
    if (this.closed) return Promise.resolve(null)
    return new Promise<TransportMessage | null>(resolve => {
      const waiter: Waiter = {
        channel,
        match,
        settle: (message) => {
          clearTimeout(waiter.timer)
          this.waiters.delete(waiter)
          resolve(message)
        },
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          resolve(null)
        }, timeoutMs),
      }
      waiter.timer.unref?.()
      this.waiters.add(waiter)
    })
  }

  /** Stop the bridge (graceful shutdown note, then kill). */
  async dispose(): Promise<void> {
    const child = this.child
    this.closed = true
    this.failWaiters()
    this.reader?.close()
    this.reader = undefined
    if (child === undefined) return
    try { if (child.stdin?.writable === true) child.stdin.write(`${JSON.stringify({ op: 'shutdown' })}\n`) } catch { /* already gone */ }
    try { child.stdin?.end() } catch { /* already gone */ }
    if (child.exitCode !== null) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        resolve()
      }, 500)
      timer.unref?.()
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  private failReady(error: Error): void {
    if (this.readySettled) return
    this.readySettled = true
    this.readyReject?.(error)
  }

  private failWaiters(): void {
    for (const waiter of [...this.waiters]) waiter.settle(null)
  }

  /** Route one decoded line; unknown events are ignored. */
  private accept(line: string): void {
    let event: { ev?: unknown, channel?: unknown, msg?: unknown, message?: unknown }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      return
    }
    if (event.ev === 'ready') {
      if (!this.readySettled) {
        this.readySettled = true
        this.readyResolve?.()
      }
      return
    }
    if (event.ev === 'msg') {
      const channel = event.channel
      const raw = event.msg as { header?: unknown, parent_header?: unknown, content?: unknown } | undefined
      if (typeof channel !== 'string' || raw === undefined || typeof raw.header !== 'object' || raw.header === null) return
      const message: TransportMessage = {
        header: raw.header as TransportMessage['header'],
        parent_header: (raw.parent_header ?? {}) as Record<string, unknown>,
        content: (raw.content ?? {}) as Record<string, unknown>,
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.channel === channel && waiter.match(message)) waiter.settle(message)
      }
      for (const handler of this.handlers) handler(channel as TransportChannel, message)
      return
    }
    if (event.ev === 'fatal') {
      this.bridgeStderr += `fatal: ${String(event.message ?? 'unknown')}\n`
    }
  }
}

