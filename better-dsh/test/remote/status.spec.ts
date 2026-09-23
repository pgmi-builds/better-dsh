import { describe, expect, it } from 'vitest'
import { probeTarget, renderProbe, renderSession } from '../../src/remote/status.ts'
import type { OneShotResult } from '../../src/remote/oneshot.ts'

const R = (over: Partial<OneShotResult>): OneShotResult =>
  ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 10, ...over })

describe('probeTarget vocabulary (Ruling 16 — offline is banned)', () => {
  it('ssh exit 0 -> reachable with rtt', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'dev4' }, { runner: async () => R({}) })
    expect(p).toMatchObject({ state: 'reachable' })
    expect(p.state === 'reachable' && p.rttMs).toBeGreaterThanOrEqual(0)
    expect(renderProbe(p)).toContain('reachable')
  })
  it('ssh failure -> unreachable + native stderr verbatim, never "offline"', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'x' }, {
      runner: async () => R({ exit: 255, stderr: 'ssh: connect to host x port 22: Connection timed out\r\n' }),
    })
    expect(p.state).toBe('unreachable')
    expect(p.state === 'unreachable' && p.detail).toContain('Connection timed out')
    const text = renderProbe(p)
    expect(text).toContain('unreachable')
    expect(text).not.toContain('offline')
  })
  it('ssh hang -> hard timeout labeled', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'x' }, {
      runner: async () => R({ exit: null, timedOut: true }),
    })
    expect(p).toMatchObject({ state: 'unreachable', detail: expect.stringContaining('probe timed out after 10s') })
  })
  it('docker inspect -> factual container state; native error passes through', async () => {
    const p1 = await probeTarget({ kind: 'docker', container: 'c1' }, { runner: async () => R({ stdout: 'running\n' }) })
    expect(p1).toEqual({ state: 'container', status: 'running' })
    const p2 = await probeTarget({ kind: 'docker', container: 'nope' }, {
      runner: async () => R({ exit: 1, stderr: 'Error: No such object: nope\n' }),
    })
    expect(p2).toMatchObject({ state: 'error', detail: expect.stringContaining('No such object') })
  })
  it('incus csv -> exact-name row status; missing name -> explicit error', async () => {
    const out = 'ctr-1,RUNNING\nctr-11,STOPPED\n'
    const p1 = await probeTarget({ kind: 'incus', container: 'ctr-1' }, { runner: async () => R({ stdout: out }) })
    expect(p1).toEqual({ state: 'container', status: 'RUNNING' })
    const p2 = await probeTarget({ kind: 'incus', container: 'zz' }, { runner: async () => R({ stdout: out }) })
    expect(p2).toMatchObject({ state: 'error', detail: expect.stringContaining("no container named 'zz'") })
  })
})

describe('renderSession (session layer, Ruling 16)', () => {
  it('undefined -> none, says dial-on-first-exec, no reachability claim', () => {
    expect(renderSession(undefined)).toBe('session: none — dials on first exec')
  })
  it('ready+quiet -> idle with age; busy -> busy; dead -> died notice', () => {
    expect(renderSession({ state: 'ready', busy: false, idleMs: 45_000 })).toBe('session: idle 45s (connected)')
    expect(renderSession({ state: 'ready', busy: true, idleMs: 0 })).toBe('session: busy (a command is running)')
    expect(renderSession({ state: 'dead', busy: false, idleMs: null })).toBe('session: died — next exec cold-starts a fresh shell')
  })
})
