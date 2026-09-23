import { describe, expect, it, vi } from 'vitest'
import { createRemoteTool } from '../../src/remote/tool.ts'
import { RemoteDriver } from '../../src/remote/driver.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

const fakeDriver = (): RemoteDriver =>
  new RemoteDriver({
    oneshotArgvFor: () => ['bash', '-c', 'echo out'],
    ptyArgvFor: () => ['bash'],
    spawnArgvFor: () => ['bash'],
  })

const fakeExec = (): ToolRunContext => ({ agent: { id: 'agent-1' } }) as unknown as ToolRunContext

describe('createRemoteTool', () => {
  it('registers under the name "remote"', () => {
    expect(createRemoteTool(fakeDriver()).name).toBe('remote')
  })
  it('executes through the driver and returns the value envelope', async () => {
    const tool = createRemoteTool(fakeDriver())
    const exec = fakeExec()
    const v = await tool.execute!({ target: 'dev4', cmd: 'echo out' } as never, exec) as { text: string; exit: number | null }
    expect(v.text).toBe('out\n')
    expect(v.exit).toBe(0)
  })
  it('renders output + footer (+cwd), stderr block, and the reconnect notice line', async () => {
    const tool = createRemoteTool(fakeDriver())
    const blocks = tool.output!.render!({} as never, {
      kind: 'exec', text: 'hello', exit: 0, durationMs: 1500, cwd: '/data', reconnected: true,
    } as never)
    const text = (blocks[0] as { type: string; text: string }).text
    expect(text).toContain('[remote: session reconnected to fresh shell; cwd reset to default]')
    expect(text).toContain('hello')
    expect(text).toContain('[exit 0 · 1.5s · cwd /data]')
    const blocks2 = tool.output!.render!({} as never, {
      kind: 'exec', text: 'x', exit: 1, durationMs: 100, stderr: 'boom', timedOut: true, truncated: 999,
    } as never)
    const text2 = (blocks2[0] as { type: string; text: string }).text
    expect(text2).toContain('interrupted')
    expect(text2).toContain('truncated, original 999 chars')
    expect(text2).toContain('[stderr]\nboom')
  })
  it('parameter violations fail before any execution', async () => {
    const tool = createRemoteTool(fakeDriver())
    const exec = fakeExec()
    await expect(tool.execute!({ target: 'a', spawn: 'b', cmd: 'x' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({ cmd: 'x' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({ spawn: 'docker exec -it x bash' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({} as never, exec)).rejects.toThrow(/discovery is yours/)
  })
  it('cmd-less target call = on-demand status, honest vocabulary, never "offline"', async () => {
    const d = new RemoteDriver({
      probeRunner: async () => ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 240 }),
    })
    const tool = createRemoteTool(d)
    const exec = fakeExec()
    const v = await tool.execute!({ target: 'dev4' } as never, exec) as { kind: string; text: string }
    expect(v.kind).toBe('status')
    expect(v.text).toContain('dev4 — ssh host')
    expect(v.text).toContain('reachable')
    expect(v.text).toContain('session: none — dials on first exec')
    expect(v.text).not.toContain('offline')
  })
  it('garbage mode and stdin-without-cmd fail loud before any execution', async () => {
    const tool = createRemoteTool(fakeDriver())
    const exec = fakeExec()
    await expect(tool.execute!({ target: 'dev4', cmd: 'x', mode: 'pty ' } as never, exec)).rejects.toThrow(/E_BAD_MODE/)
    await expect(tool.execute!({ target: 'dev4', stdin: 's' } as never, exec)).rejects.toThrow(/E_STDIN_WITHOUT_CMD/)
  })
})
