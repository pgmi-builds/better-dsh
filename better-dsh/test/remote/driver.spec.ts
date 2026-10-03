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
  it('a byop: selector locks mode to pty; spawn alone is not an entry point', async () => {
    const d = driverWith()
    const r = await d.call({ target: 'byop:x', spawn: 'docker exec -it x bash', cmd: 'echo hi' })
    expect(r.mode).toBe('pty')
    expect(r.session).toBe('byop:x')
    await expect(d.call({ target: 'byop:x', cmd: 'echo hi', mode: 'oneshot' })).rejects.toThrow(/E_BAD_MODE.*locked to 'pty'/)
    await expect(d.call({ spawn: 'docker exec -it x bash', cmd: 'echo hi' })).rejects.toThrow(/E_PARAMS/)
    await d.dispose()
  })
  it('rejects malformed PTY labels before touching the pool', async () => {
    const d = driverWith()
    for (const bad of ['byop:', 'byop:has space', 'byop:a:b', 'byop:-lead'])
      await expect(d.call({ target: bad, spawn: 'bash', cmd: 'echo hi' })).rejects.toThrow(/E_BAD_LABEL/)
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

describe('RemoteDriver BYO-PTY labels (target:"byop:<label>")', () => {
  const scanStub = {
    rosterRunner: async () => ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 1 }),
  }

  it('creates on the first spawn, then reuses by label alone (cwd/env survive)', async () => {
    const d = driverWith()
    const created = await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'cd /tmp && export MARK=live' })
    expect(created.session).toBe('byop:dev3')
    expect(created.notice).toBeUndefined()
    const reused = await d.call({ target: 'byop:dev3', cmd: 'echo "$MARK" && pwd' })
    expect(reused.session).toBe('byop:dev3')
    expect(reused.stdout).toContain('live')
    expect(reused.cwd).toBe('/tmp')
    await d.dispose()
  })

  it('label namespace is per agent: the same label is a fresh (absent) session for another agent', async () => {
    const d = driverWith()
    await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'export MARK=mine' }, { sessionKey: 'a1' })
    await expect(d.call({ target: 'byop:dev3', cmd: 'echo "$MARK"' }, { sessionKey: 'a2' })).rejects.toThrow(/E_NO_SESSION/)
    const fresh = await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'echo "$MARK"done' }, { sessionKey: 'a2' })
    expect(fresh.stdout.trim()).toBe('done')
    await d.dispose()
  })

  it('repeating the same spawn on a live label reuses it and teaches the shorter form', async () => {
    const d = driverWith()
    await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'export MARK=kept' })
    const r = await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'echo "$MARK"' })
    expect(r.stdout).toContain('kept')
    expect(r.notice).toMatch(/already runs that exact command/)
    expect(r.notice).toContain('{ target: "byop:dev3", cmd:')
    await d.dispose()
  })

  it('a different spawn on a live label refuses with E_LABEL_CONFLICT and runs nothing', async () => {
    const d = driverWith()
    await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'export MARK=one' })
    await expect(d.call({ target: 'byop:dev3', spawn: 'bash -l', cmd: 'export MARK=clobbered' }))
      .rejects.toThrow(/E_LABEL_CONFLICT/)
    const after = await d.call({ target: 'byop:dev3', cmd: 'echo "$MARK"' })
    expect(after.stdout).toContain('one')
    await d.dispose()
  })

  it('an unknown label answers E_NO_SESSION with the create shape (spawn is never retained)', async () => {
    const d = driverWith()
    await expect(d.call({ target: 'byop:never', cmd: 'echo hi' })).rejects.toThrow(/E_NO_SESSION/)
    await expect(d.call({ target: 'byop:never', cmd: 'echo hi' })).rejects.toThrow(/Create it:.*target: "byop:never", spawn/)
    await d.dispose()
  })

  it('label with no cmd = that session status; unknown label says so without dialing', async () => {
    const d = driverWith()
    await d.call({ target: 'byop:dev3', spawn: 'bash', cmd: 'echo warm' })
    const live = await d.status('byop:dev3')
    expect(live).toContain('byop:dev3 — BYO pty session')
    expect(live).toContain('session: idle')
    expect(await d.status('byop:never')).toContain('session: none — no live PTY under this label')
    await d.dispose()
  })

  it('roster names sessions by label, never by the spawn command', async () => {
    const d = driverWith(scanStub)
    await d.call({ target: 'byop:dev3', spawn: 'UNIQUESPAWNMARKER bash', cmd: 'echo hi' })
    const text = await d.roster()
    expect(text).toContain('live pty sessions: byop:dev3')
    expect(text).not.toContain('UNIQUESPAWNMARKER')
    await d.dispose()
  })

  it('a bare name falls through ssh/docker/incus and reaches a live pty label last', async () => {
    const d = driverWith({ ...scanStub, sshConfigReader: async () => 'Host dev3\n' })
    await d.call({ target: 'byop:lab', spawn: 'bash', cmd: 'export MARK=bare' })
    // 未指定 mode 的裸名同样命中 PTY 末位候选（懒复用：只写 label，不写 PTY 选择器）
    const viaBare = await d.call({ target: 'lab', cmd: 'echo "$MARK"' })
    expect(viaBare.mode).toBe('pty')
    expect(viaBare.session).toBe('byop:lab')
    expect(viaBare.stdout).toContain('bare')
    // 显式 oneshot 不吃末位候选 —— 裸名在 mode:'oneshot' 下的旧行为逐位保留。
    const oneShot = await d.call({ target: 'lab', mode: 'oneshot', cmd: 'echo hi' })
    expect(oneShot.mode).toBe('oneshot')
    expect(oneShot.session).toBeUndefined()
    await d.dispose()
  })

  it('on a name collision the ssh host wins; only the explicit selector reaches the PTY', async () => {
    const d = driverWith({ ...scanStub, sshConfigReader: async () => 'Host lab\n' })
    await d.call({ target: 'byop:lab', spawn: 'bash', cmd: 'export MARK=pty' })
    const collision = await d.call({ target: 'lab', mode: 'pty', cmd: 'echo hi' })
    expect(collision.session).toBeUndefined()
    expect(collision.target).toBe('lab')
    const explicit = await d.call({ target: 'byop:lab', cmd: 'echo "$MARK"' })
    expect(explicit.session).toBe('byop:lab')
    expect(explicit.stdout).toContain('pty')
    await d.dispose()
  })

  it('a spawn that never initializes leaves no session behind — the label is immediately reusable', async () => {
    let argv = ['bash', '-c', 'exit 3']
    const d = driverWith({ spawnArgvFor: () => argv })
    await expect(d.call({ target: 'byop:x', spawn: 'broken', cmd: 'echo hi' })).rejects.toThrow(/E_SESSION_DIED/)
    // 池内无残留：不带 spawn 复用得到 E_NO_SESSION，而不是重跑冻结 argv 再死一次
    await expect(d.call({ target: 'byop:x', cmd: 'echo hi' })).rejects.toThrow(/E_NO_SESSION/)
    // 换一个能起来的 spawn 直接建成，不再被 origin 比对拦成 E_LABEL_CONFLICT
    argv = ['bash']
    const ok = await d.call({ target: 'byop:x', spawn: 'good', cmd: 'echo alive' })
    expect(ok.session).toBe('byop:x')
    expect(ok.stdout).toContain('alive')
    await d.dispose()
  })

  it('a ready-then-killed session stays in the pool and still reconnects (unchanged)', async () => {
    const d = driverWith()
    await d.call({ target: 'byop:r', spawn: 'bash', cmd: 'echo warm' })
    await d.call({ target: 'byop:r', cmd: 'kill -9 $$' })
    const back = await d.call({ target: 'byop:r', cmd: 'echo back' })
    expect(back.reconnected).toBe(true)
    expect(back.stdout).toContain('back')
    await d.dispose()
  })

  it('the init-failure message names the model-facing label, never the internal pool key', async () => {
    const d = driverWith({ spawnArgvFor: () => ['bash', '-c', 'exit 3'] })
    const msg = await d
      .call({ target: 'byop:x', spawn: 'broken', cmd: 'echo hi' }, { sessionKey: 'sess-abc' })
      .then(() => '', (e: Error) => e.message)
    expect(msg).toMatch(/E_SESSION_DIED/)
    expect(msg).toContain("'byop:x'")
    expect(msg).not.toContain('sess-abc')
    expect(msg).not.toContain('|p:')
    await d.dispose()
  })

  it('roster is caller-scoped: each agent sees only its own live sessions', async () => {
    const d = driverWith(scanStub)
    await d.call({ target: 'byop:mine', spawn: 'bash', cmd: 'export M=mine' }, { sessionKey: 'a1' })
    await d.call({ target: 'byop:theirs', spawn: 'bash', cmd: 'export M=theirs' }, { sessionKey: 'a2' })
    const a1 = await d.roster({ sessionKey: 'a1' })
    expect(a1).toContain('byop:mine')
    expect(a1).not.toContain('byop:theirs')
    const a2 = await d.roster({ sessionKey: 'a2' })
    expect(a2).toContain('byop:theirs')
    expect(a2).not.toContain('byop:mine')
    // 名字候选（ssh/docker/incus）是公共静态配置，仍对所有人可见
    expect(a1).toContain('incus containers')
    expect(a2).toContain('incus containers')
    await d.dispose()
  })
})
