import { describe, expect, it } from 'vitest'
import { renderRoster } from '../../src/remote/roster.ts'
import type { OneShotResult } from '../../src/remote/oneshot.ts'

const R = (over: Partial<OneShotResult>): OneShotResult =>
  ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 5, ...over })

const SSH_CFG = [
  'Host dev3',
  '  HostName dev3.example.com',
  'Host * !dev3',
  '  User fallback',
  'Host mac',
  '  HostName 192.168.31.7',
].join('\n')

const runnerFor = (docker: OneShotResult, incus: OneShotResult) =>
  async (argv: string[]): Promise<OneShotResult> => {
    if (argv[0] === 'docker') return docker
    return incus
  }

describe('renderRoster (Ruling P19 — attention entry, local-only, zero dialing)', () => {
  it('lists literal ssh hosts, containers with state, and live sessions', async () => {
    const text = await renderRoster(
      [{ target: 't:dev4', state: 'ready', idleSec: 12 }],
      {
        readSshConfig: async () => SSH_CFG,
        runner: runnerFor(
          R({ stdout: 'corti\trunning\njellyfin\texited\n' }),
          R({ stdout: 'ctr-1,RUNNING\n' }),
        ),
      },
    )
    expect(text).toContain('ssh hosts (~/.ssh/config): dev3, mac (+1 wildcard default blocks, not listed)')
    expect(text).toContain('docker containers: corti (running), jellyfin (exited)')
    expect(text).toContain('incus containers: ctr-1 (RUNNING)')
    expect(text).toContain('live pty sessions: t:dev4 [ready, idle 12s]')
  })

  it('degrades each section honestly — missing config, failed scans, timeout, empty pool', async () => {
    const text = await renderRoster([], {
      readSshConfig: async () => { throw new Error('ENOENT: no such file') },
      runner: runnerFor(
        R({ exit: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock\n' }),
        R({ exit: null, timedOut: true }),
      ),
    })
    expect(text).toContain('ssh hosts: no readable ~/.ssh/config (ENOENT: no such file)')
    expect(text).toContain('docker containers: unavailable — Cannot connect to the Docker daemon')
    expect(text).toContain('incus containers: unavailable — scan timed out after 10s')
    expect(text).toContain('live pty sessions: none')
  })

  it('renders empty rosters as (none) without fabricating', async () => {
    const text = await renderRoster([], {
      readSshConfig: async () => 'Host dev3\n',
      runner: runnerFor(R({ stdout: '' }), R({ stdout: '' })),
    })
    expect(text).toContain('ssh hosts (~/.ssh/config): dev3')
    expect(text).toContain('docker containers: (none)')
    expect(text).toContain('incus containers: (none)')
  })
})
