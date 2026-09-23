import { describe, expect, it } from 'vitest'
import { buildOneShotArgv, buildPtyArgv, buildSpawnArgv, shQuote } from '../../src/remote/transports.ts'

describe('shQuote', () => {
  it('wraps in single quotes and escapes embedded quotes POSIX-style', () => {
    expect(shQuote('ls -la')).toBe(`'ls -la'`)
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
    expect(shQuote('a\nb')).toBe(`'a\nb'`)
  })
})

describe('buildOneShotArgv (spec §五.1 verbatim shapes)', () => {
  it('ssh: BatchMode, no tty, one mechanically-quoted argv after the host', () => {
    expect(buildOneShotArgv({ kind: 'ssh', host: 'dev4' }, "git status | head -1"))
      .toEqual(['ssh', '-o', 'BatchMode=yes', '-T', '--', 'dev4', `bash -lc 'git status | head -1'`])
  })
  it('ssh survives a cmd containing single quotes (one mechanical layer)', () => {
    const argv = buildOneShotArgv({ kind: 'ssh', host: 'dev4' }, "echo 'hi'")
    expect(argv.at(-1)).toBe(`bash -lc 'echo '\\''hi'\\'''`)
  })
  it('docker: exec -i, argv-direct (no -t, no re-parse)', () => {
    expect(buildOneShotArgv({ kind: 'docker', container: 'c1' }, 'echo x'))
      .toEqual(['docker', 'exec', '-i', '--', 'c1', 'bash', '-lc', 'echo x'])
  })
  it('incus: exec without -t semantics (--force-noninteractive)', () => {
    expect(buildOneShotArgv({ kind: 'incus', container: 'ctr-1' }, 'echo x'))
      .toEqual(['incus', 'exec', '--force-noninteractive', 'ctr-1', '--', 'bash', '-lc', 'echo x'])
  })
})

describe('buildPtyArgv', () => {
  it('ssh: force-tty over host pipes, BatchMode', () => {
    expect(buildPtyArgv({ kind: 'ssh', host: 'dev4' }))
      .toEqual(['ssh', '-tt', '-o', 'BatchMode=yes', '--', 'dev4', 'bash'])
  })
  it('docker: script(1) hosts the PTY, local echo pre-silenced, exec replaces the shell', () => {
    expect(buildPtyArgv({ kind: 'docker', container: 'my c' }))
      .toEqual(['script', '-qfec', `stty -echo 2>/dev/null ; exec docker exec -it -- 'my c' bash`, '/dev/null'])
  })
  it('incus: force-interactive over host pipes', () => {
    expect(buildPtyArgv({ kind: 'incus', container: 'ctr-1' }))
      .toEqual(['incus', 'exec', '--force-interactive', 'ctr-1', '--', 'bash'])
  })
})

describe('buildSpawnArgv (BYO-PTY)', () => {
  it('hosts any spawn command under script with echo pre-silenced', () => {
    expect(buildSpawnArgv('docker exec -it temp-worker bash'))
      .toEqual(['script', '-qfec', 'stty -echo 2>/dev/null ; exec docker exec -it temp-worker bash', '/dev/null'])
  })
})
