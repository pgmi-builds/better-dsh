import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { RECONNECT_NOTICE } from './pty-session.ts'
import type { RemoteCallResult, RemoteDriver } from './driver.ts'

interface RemoteToolValue {
  kind: 'exec' | 'status'
  text: string
  exit: number | null
  durationMs: number
  /** 唯一偏离 brief 处（类型面）：brief 写 `cwd?: string | null`，但 output.schema 的 `cwd: { type: 'string' }`
   * 经 defineTool 推断为 `cwd?: string`——null 连运行期 schema 校验一起违反；照 RM0 样板收窄为 `string`，
   * 驱动侧的 null 在赋值处过滤。运行时语义不变（render 本就只认 string）。 */
  cwd?: string
  stderr?: string
  timedOut?: boolean
  reconnected?: boolean
  truncated?: number
}

const NO_SESSION_KEY = 'remote:no-session'

export function createRemoteTool(
  driver: RemoteDriver,
  opts: { getSessionKey?: (exec: ToolRunContext) => string } = {},
): ToolDefinition {
  const getSessionKey = opts.getSessionKey ?? ((exec: ToolRunContext) => exec.agent?.id ?? NO_SESSION_KEY)
  return defineTool({
    name: 'remote',
    description:
      'Run a command on a remote host or container. Two tracks: oneshot (default) runs `bash -lc` statelessly — fast, ' +
      'parallel, zero residue, the exit code is the process\'s own; mode "pty" keeps one persistent terminal session ' +
      'per (agent, target): cwd/env survive across calls, Ctrl-C interrupts work, sudo password prompts are possible. ' +
      '`target` routes smartly: an ssh host name/IP/domain goes over ssh; "docker:<name>" / "incus:<name>" go to that ' +
      'container; an explicit "ssh:<name>" selector always forces ssh. ' +
      '`spawn` is the BYO-PTY escape hatch: give the full command that ' +
      'starts an interactive shell (e.g. "docker exec -it img bash" or "ssh -t jump \'docker exec -it runner bash\'") ' +
      'and the tool hosts its PTY with nonce framing (mode locks to pty). Nested hops are dumb pipes — only the ' +
      'innermost bash frames. `stdin` feeds the command\'s input; `timeout` (seconds) interrupts then kills. Native ' +
      'transport errors pass through verbatim — self-correct from them. Background processes must redirect their own ' +
      'output (`cmd > log 2>&1 &`): the shared terminal is POSIX behavior, not a tool defect. ' +
      'Omit `cmd` (with `target`) for an on-demand status probe: the tool dials once right then, bounded (5s connect / ' +
      '10s hard), and reports honestly — "reachable"/"unreachable — <native error>" for ssh, the factual container ' +
      'state for docker/incus, plus the session layer ("idle Ns", "busy", or "none — dials on first exec"). It never ' +
      'reports "offline": a connection not existing says nothing about the target. Probes run at call time, never ' +
      'cached from boot. Discovery of valid names is yours: read ~/.ssh/config, `docker ps`, `incus list` with your ' +
      'local tools.',
    parameters: {
      target: { type: 'string', description: 'SSH host / IP / domain, or docker:<name> / incus:<name> container. Omit when using spawn.' },
      spawn: { type: 'string', description: 'BYO-PTY: full command starting an interactive shell; the tool hosts the PTY + framing. Mode locks to pty.' },
      cmd: { type: 'string', description: 'One raw shell string parsed by the remote bash (multi-line = one compound; exit = last command\'s). Omit (with target) for an on-demand status probe.' },
      mode: { type: 'string', description: "'oneshot' (default) or 'pty' (persistent session)." },
      stdin: { type: 'string', description: 'Optional input fed to the command (oneshot pipe, or written right after it on the pty).' },
      timeout: { type: 'number', description: 'Per-command timeout in seconds (default 120). pty: Ctrl-C then kill.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['exec', 'status'] },
          text: { type: 'string', required: true },
          exit: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          durationMs: { type: 'integer' },
          cwd: { type: 'string' },
          stderr: { type: 'string' },
          timedOut: { type: 'boolean' },
          reconnected: { type: 'boolean' },
          truncated: { type: 'integer' },
        },
      },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: renderValue(value as RemoteToolValue) }],
    },
    async execute(args, exec): Promise<RemoteToolValue> {
      const hasCmd = typeof args.cmd === 'string' && args.cmd.length > 0
      const hasTarget = typeof args.target === 'string' && args.target.length > 0
      const hasSpawn = typeof args.spawn === 'string' && args.spawn.length > 0
      // fail-loud 三闸：垃圾 mode 不静默降级；status 面不吃 stdin。
      if (args.mode !== undefined && args.mode !== 'oneshot' && args.mode !== 'pty')
        throw new Error(`[E_BAD_MODE] remote: mode must be 'oneshot' or 'pty' (got ${JSON.stringify(args.mode)})`)
      // cmd 缺省 + target 在场 = on-demand status（Ruling 16/17）；spawn 无可探测物。
      // （守卫上方已排除 undefined/空串；别名条件在此推断面下不收窄，照 RM0 样板以 as string 落地。）
      if (!hasCmd) {
        if (args.stdin !== undefined)
          throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd — status probes take no input')
        if (hasSpawn)
          throw new Error('[E_PARAMS] remote: spawn is an exec channel — pass cmd (there is nothing to probe for BYO-PTY)')
        if (!hasTarget)
          throw new Error(
            '[E_PARAMS] remote: target or spawn is required; discovery is yours — read ~/.ssh/config, ' +
            '`docker ps`, `incus list` with your local tools')
        const text = await driver.status(args.target as string, { sessionKey: getSessionKey(exec) })
        return { kind: 'status', text, exit: null, durationMs: 0 }
      }
      try {
        const r: RemoteCallResult = await driver.call(
          {
            target: args.target, spawn: args.spawn, cmd: args.cmd as string,
            mode: args.mode === 'oneshot' || args.mode === 'pty' ? args.mode : undefined,
            stdin: args.stdin, timeout: args.timeout,
          },
          { sessionKey: getSessionKey(exec) },
        )
        const v: RemoteToolValue = { kind: 'exec', text: r.stdout, exit: r.exit, durationMs: r.durationMs }
        if (r.cwd !== null) v.cwd = r.cwd
        if (r.stderr !== undefined) v.stderr = r.stderr
        if (r.timedOut) v.timedOut = true
        if (r.reconnected) v.reconnected = true
        if (r.truncated !== undefined) v.truncated = r.truncated
        return v
      } catch (error) {
        throw error
      }
    },
  })
}

function renderValue(v: RemoteToolValue): string {
  if (v.kind === 'status') return v.text
  const parts: string[] = []
  if (v.reconnected === true) parts.push(RECONNECT_NOTICE)
  parts.push(v.text)
  const secs = ((v.durationMs ?? 0) / 1_000).toFixed(1)
  const markers: string[] = []
  if (v.timedOut === true) markers.push('interrupted')
  if (v.truncated !== undefined) markers.push(`truncated, original ${v.truncated} chars`)
  const suffix = markers.length > 0 ? ` · ${markers.join(' · ')}` : ''
  const cwdTag = typeof v.cwd === 'string' && v.cwd.length > 0 ? ` · cwd ${v.cwd}` : ''
  parts.push(`[exit ${v.exit} · ${secs}s${suffix}${cwdTag}]`)
  if (v.stderr !== undefined && v.stderr.length > 0) parts.push('[stderr]', v.stderr)
  return parts.join('\n')
}
