import { spawn } from 'node:child_process'

export interface OneShotOptions { stdin?: string; timeoutSec?: number }
export interface OneShotResult { exit: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }

/** 单流硬收集帽（4MB）：防失控输出吃内存；模型面截断由上层 tailWindow 负责。 */
const HARD_CAP = 4_000_000

/** One-shot：子进程退出码即收尾（spec §五.1），stdout/stderr 分离保留。 */
export async function runOneShot(argv: string[], opts: OneShotOptions = {}): Promise<OneShotResult> {
  const started = Date.now()
  const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    if (stdout.length < HARD_CAP) stdout = (stdout + d).slice(0, HARD_CAP)
  })
  child.stderr.setEncoding('utf8').on('data', (d: string) => {
    if (stderr.length < HARD_CAP) stderr = (stderr + d).slice(0, HARD_CAP)
  })
  child.stdin.on('error', () => {}) // EPIPE on early exit is not ours to raise
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
  child.stdin.end()

  let termTimer: NodeJS.Timeout | undefined
  let killTimer: NodeJS.Timeout | undefined
  const clearTimers = (): void => {
    if (termTimer !== undefined) clearTimeout(termTimer)
    if (killTimer !== undefined) clearTimeout(killTimer)
  }
  if (opts.timeoutSec !== undefined) {
    termTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2_000)
    }, opts.timeoutSec * 1_000)
  }

  const exit = await new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', (err) => {
      stderr += `\n[remote: spawn failed: ${err.message}]`
      resolve(null)
    })
  })
  clearTimers()
  return { exit, timedOut, stdout, stderr, durationMs: Date.now() - started }
}
