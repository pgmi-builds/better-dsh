import { describe, expect, it } from 'vitest'
import { runOneShot } from '../../src/remote/oneshot.ts'

const BASH = (cmd: string): string[] => ['bash', '-c', cmd]

describe('runOneShot', () => {
  it('captures stdout, stderr and the binary exit code', async () => {
    const r = await runOneShot(BASH('echo out; echo err >&2; exit 42'))
    expect(r.exit).toBe(42)
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
    expect(r.timedOut).toBe(false)
  })
  it('pipes stdin and closes it', async () => {
    const r = await runOneShot(BASH('cat'), { stdin: 'line1\nline2\n' })
    expect(r.exit).toBe(0)
    expect(r.stdout).toBe('line1\nline2\n')
  })
  it('preserves utf8 across chunk boundaries', async () => {
    const r = await runOneShot(BASH("printf '中%.0s' $(seq 1 20000); echo"))
    expect(r.stdout).toBe('中'.repeat(20_000) + '\n')
    expect(r.exit).toBe(0)
  })
  it('timeout: SIGTERM then SIGKILL, flagged, bounded duration', async () => {
    const r = await runOneShot(BASH('trap "" TERM; sleep 30'), { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.exit).not.toBe(0)
    expect(r.durationMs).toBeLessThan(8_000)
  })
  it('spawn failure surfaces the OS error verbatim (error transparency)', async () => {
    const r = await runOneShot(['definitely-not-a-real-cli-xyz', '--version'])
    expect(r.exit).toBe(null)
    expect(r.stderr).toContain('spawn failed')
    expect(r.stderr).toContain('ENOENT')
  })
})
