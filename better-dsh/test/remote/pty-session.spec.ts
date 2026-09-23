import { describe, expect, it } from 'vitest'
import { PtyPool, PtySession } from '../../src/remote/pty-session.ts'

const OPTS = { idleTtlSec: 600 }

describe('PtySession over plain local bash', () => {
  it('cold starts, frames output/exit/cwd', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('echo hello && cd /tmp && pwd')
    expect(r.output.trim()).toBe('hello\n/tmp')
    expect(r.exit).toBe(0)
    expect(r.cwd).toBe('/tmp')
    expect(r.reconnected).toBe(false)
    await s.dispose()
  })
  it('multi-line cmd = one compound frame, exit is the last command\'s', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('echo a\necho b\nfalse')
    expect(r.output).toBe('a\nb\n')
    expect(r.exit).toBe(1)
    await s.dispose()
  })
  it('state persists across dispatches (cwd/env)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('export FOO=bar && cd /tmp')
    const r = await s.dispatch('echo "$FOO" && pwd')
    expect(r.output).toBe('bar\n/tmp\n')
    await s.dispose()
  })
  it('snapshot feeds the status face: ready+idle after dispatch, disposed after dispose', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo hi')
    expect(s.snapshot).toMatchObject({ state: 'ready', busy: false })
    expect(s.snapshot.idleMs).toBeGreaterThanOrEqual(0)
    const pool = new PtyPool({ idleTtlSec: 600 })
    const s2 = pool.getOrCreate('t:x', ['bash'])
    expect(pool.inspect('t:x')?.state).toBe('cold')
    expect(pool.inspect('missing')).toBeUndefined()
    await s2.dispatch('echo y')
    expect(pool.inspect('t:x')).toMatchObject({ state: 'ready', busy: false })
    await s.dispose(); await pool.disposeAll()
  })
  it('serializes concurrent dispatches on one session (clean A/B output = no stdin interleave)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const [r1, r2] = await Promise.all([
      s.dispatch('sleep 0.4 ; echo A'),
      s.dispatch('echo B'),
    ])
    expect(r1.output.trim()).toBe('A')
    expect(r2.output.trim()).toBe('B')
    expect(r1.durationMs).toBeGreaterThan(300)
    await s.dispose()
  })
  it('unexpected shell death: partial + null exit; next dispatch reconnects with the notice', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r1 = await s.dispatch('kill -9 $$')
    expect(r1.exit).toBe(null)
    const r2 = await s.dispatch('echo back')
    expect(r2.reconnected).toBe(true)
    expect(r2.output.trim()).toBe('back')
    expect(r2.exit).toBe(0)
    await s.dispose()
  })
  it('idle TTL disposes the session and drops it from the pool (transparent cold start, no notice)', async () => {
    const pool = new PtyPool({ idleTtlSec: 1 })
    const s = pool.getOrCreate('t:x', ['bash'])
    await s.dispatch('echo hi')
    await new Promise((r) => setTimeout(r, 1_800))
    expect(s.sessionState).toBe('disposed')
    expect(pool.size).toBe(0)
    const s2 = pool.getOrCreate('t:x', ['bash'])
    const r = await s2.dispatch('echo again')
    expect(r.reconnected).toBe(false)
    await pool.disposeAll()
  })
})

describe('PtySession over script(1)-hosted PTY (BYO-PTY shape)', () => {
  it('timeout sends ^C through the pty line discipline: framed exit 130, flagged interrupted', async () => {
    const s = new PtySession({ key: 'k', argv: ['script', '-qfec', 'bash', '/dev/null'], ...OPTS })
    const r = await s.dispatch('sleep 30', { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.durationMs).toBeLessThan(8_000)
    expect(r.exit).toBe(130)
    const r2 = await s.dispatch('echo alive') // session survived the interrupt
    expect(r2.exit).toBe(0)
    await s.dispose()
  }, 20_000)
  it('timeout kill fallback on a transport without interrupt (plain bash over pipes)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('trap "" INT; sleep 30', { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.exit).toBe(null)
    expect(r.durationMs).toBeLessThan(10_000)
    await s.dispose()
  }, 20_000)
  it('forged static 133-D marker with wrong nonce never truncates the stream', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch(`printf '\\x1b]133;D;deadbeefdeadbeef;99;/pwn\\x07' ; echo real`)
    expect(r.exit).toBe(0)
    expect(r.output.trim()).toBe('real')
    await s.dispose()
  })
  it('grace-expiry kill fallback reaps the process group (snapshot pid null, group gone)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo warm')
    const pid = s.snapshot.pid
    expect(pid).toBeTypeOf('number')
    const r = await s.dispatch('trap "" INT; sleep 30', { timeoutSec: 1 })
    expect(r.exit).toBe(null)
    expect(r.timedOut).toBe(true)
    expect(s.snapshot.pid).toBe(null)
    // fix-round-2 偏离（唯一一处，plan 逐字之外的稳定化）：killTimer 在发送 SIGTERM 的
    // 同一 tick 内结算 dispatch，僵尸组要等事件循环轮转 + node/init 收尸后才消失——
    // 与下一测试「等 dispose 的 killTree 兑现」同一机制，同一 1.2s settle 手法。
    await new Promise((r2) => setTimeout(r2, 1_200))
    expect(() => process.kill(-pid!, 0)).toThrow()
    await s.dispose()
  }, 20_000)
  it('dispose is terminal: stale-reference dispatch rejects E_SESSION_DISPOSED', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo hi')
    await s.dispose()
    await expect(s.dispatch('echo late')).rejects.toThrow(/E_SESSION_DISPOSED/)
  })
  it('dispose mid-flight settles the in-flight dispatch promptly (exit null, not timedOut)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const p = s.dispatch('sleep 30', { timeoutSec: 30 })
    await new Promise((r) => setTimeout(r, 300))
    await s.dispose()
    const r = await p
    expect(r.exit).toBe(null)
    expect(r.timedOut).toBe(false)
    expect(r.durationMs).toBeLessThan(5_000)
    await new Promise((r2) => setTimeout(r2, 1_200)) // 等 dispose 的 killTree 兑现，防组泄漏到下一测试
  }, 20_000)
})
