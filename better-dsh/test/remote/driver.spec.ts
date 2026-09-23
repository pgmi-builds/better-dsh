import { describe, expect, it } from 'vitest'
import { RemoteDriver, type RemoteAuditRecord } from '../../src/remote/driver.ts'

const driverWith = (over: Partial<ConstructorParameters<typeof RemoteDriver>[0]> = {}): RemoteDriver =>
  new RemoteDriver({
    oneshotArgvFor: () => ['bash', '-lc', 'echo fixed'],
    ptyArgvFor: () => ['bash'],
    spawnArgvFor: () => ['bash'],
    idleTtlSec: 600,
    ...over,
  })

describe('RemoteDriver validation', () => {
  it('rejects target+spawn and neither (E_PARAMS), and bad timeout (E_BAD_TIMEOUT)', async () => {
    const d = driverWith()
    await expect(d.call({ target: 'dev4', spawn: 'bash', cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    await expect(d.call({ cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    await expect(d.call({ target: 'dev4', cmd: 'x', timeout: 0 })).rejects.toThrow(/E_BAD_TIMEOUT/)
    await expect(d.call({ target: 'dev4', cmd: 'x', timeout: Number.POSITIVE_INFINITY })).rejects.toThrow(/E_BAD_TIMEOUT/)
  })
  it('spawn locks mode to pty even if oneshot was asked', async () => {
    const d = driverWith()
    const r = await d.call({ spawn: 'docker exec -it x bash', cmd: 'echo hi', mode: 'oneshot' })
    expect(r.mode).toBe('pty')
    await d.dispose()
  })
})

describe('RemoteDriver routing', () => {
  it('oneshot default: runs the transport argv, returns binary exit + split stderr', async () => {
    const seen: string[][] = []
    const d = new RemoteDriver({
      oneshotArgvFor: (_plan, cmd) => { seen.push(['oneshot', cmd]); return ['bash', '-c', 'echo out; echo err >&2; exit 3'] },
    })
    const r = await d.call({ target: 'dev4', cmd: 'git status' })
    expect(r.mode).toBe('oneshot')
    expect(r.exit).toBe(3)
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
    expect(seen).toEqual([['oneshot', 'git status']])
    await d.dispose()
  })
  it('pty mode: session key isolates agents, state persists per key', async () => {
    const d = driverWith()
    await d.call({ target: 'dev4', mode: 'pty', cmd: 'cd /tmp' }, { sessionKey: 'a1' })
    const r = await d.call({ target: 'dev4', mode: 'pty', cmd: 'pwd' }, { sessionKey: 'a1' })
    expect(r.cwd).toBe('/tmp')
    const r2 = await d.call({ target: 'dev4', mode: 'pty', cmd: 'pwd' }, { sessionKey: 'a2' })
    expect(r2.cwd).not.toBe('/tmp') // different agent, fresh session
    await d.dispose()
  })
  it('truncates oversized output to the tail window with disclosure', async () => {
    const d = new RemoteDriver({
      maxOutputChars: 10,
      oneshotArgvFor: () => ['bash', '-c', 'printf "x%.0s" $(seq 1 100)'],
    })
    const r = await d.call({ target: 'dev4', cmd: 'x' })
    expect(r.truncated).toBe(100)
    expect(r.stdout).toContain('[truncated: showing last 10 of 100 chars]')
    await d.dispose()
  })
  it('emits one audit record per attempt (success, nonzero exit, and error paths)', async () => {
    const audit: RemoteAuditRecord[] = []
    const d = driverWith({ onAudit: (r) => audit.push(r) })
    await d.call({ target: 'dev4', cmd: 'echo ok' })
    const d255 = new RemoteDriver({
      onAudit: (r) => audit.push(r),
      oneshotArgvFor: () => ['bash', '-c', 'exit 255'],
    })
    await d255.call({ target: 'no-such-host-xyz', cmd: 'echo no' }).catch(() => {})
    await expect(d.call({ target: 'a', spawn: 'b', cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    expect(audit[0]).toMatchObject({ target: 'dev4', cmd: 'echo ok', exit: 0 })
    expect(audit[1]).toMatchObject({ target: 'no-such-host-xyz', exit: 255 })
    expect(audit[2]).toMatchObject({ target: 'a', cmd: 'x', error: expect.stringContaining('E_PARAMS') })
    await d.dispose(); await d255.dispose()
  })
})
