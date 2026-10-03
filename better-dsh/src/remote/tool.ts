import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { RECONNECT_NOTICE } from './pty-session.ts'
import type { RemoteCallResult, RemoteDriver } from './driver.ts'

interface RemoteToolValue {
  kind: 'exec' | 'status' | 'roster'
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
  /** `byop:<label>` 调用面的 label（模型自选、即复用入口）。 */
  session?: string
  /** 引导/教学行（同 label 重复 spawn 的「可省略」提示等）；无则省略。 */
  notice?: string
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
      'Remote execution over three transports (ssh / docker / incus) plus named persistent BYO shells. Pick the call shape first:\n' +
      '  {}                                 → roster: known target names from a local scan (no dialing)\n' +
      '  {target}                           → on-demand status probe of that one target (for "byop:<label>": its session state)\n' +
      '  {target, cmd}                      → run cmd — oneshot by default; mode "pty" for a persistent shell\n' +
      '  {target:"byop:<label>", spawn, cmd} → BYO-PTY: create the persistent shell you named <label>\n' +
      '  {target:"byop:<label>", cmd}        → reuse that shell (spawn is only needed to create)\n' +
      'BYO-PTY labels are yours to choose, and the label alone is the whole reuse mechanism: "byop:dev3" is created once ' +
      'with `spawn` (the command that starts an interactive shell, e.g. "docker exec -it img bash"), and from then on you ' +
      'address it as {target:"byop:dev3", cmd} with no spawn. Repeating the same spawn for a live label is reused and the ' +
      'result tells you to drop it; repeating a *different* spawn is refused with [E_LABEL_CONFLICT] and nothing runs — ' +
      'reuse the label, or pick a new one. A label that was never created, or was reaped after the idle TTL, answers ' +
      '[E_NO_SESSION]: spawn is not retained, so pass it again to re-create. A spawn that fails to come up (e.g. a ' +
      'bad host) leaves nothing behind either — the label stays free, so just retry with a corrected spawn. ' +
      'Bare names match in order — ssh config, then docker, then incus, then a live pty label (on a collision the earlier ' +
      'source wins; a name matching none of them goes to ssh and its native error surfaces). "byop:<label>" / ' +
      '"docker:<name>" / "incus:<name>" / "ssh:<name>" force a channel when you must be explicit. oneshot: stateless ' +
      '`bash -lc`, stdout/stderr separate, the exit code is the remote process\'s own. pty: one persistent shell per ' +
      '(agent, target) — cwd/env survive across calls, streams merge, Ctrl-C interrupts without killing the session, ' +
      'idle sessions are reaped after 600s (a reconnect notice precedes the fresh shell). Output is tail-truncated at ' +
      '~30k chars with a "[truncated: …]" header — redirect bulk output to a file yourself. `stdin` feeds the command; ' +
      '`timeout` (seconds) interrupts then kills. Native transport errors pass through verbatim — self-correct from them. ' +
      'Background processes must redirect their own output (`cmd > log 2>&1 &`). Status probes report ' +
      '"reachable"/"unreachable — <native error>" or the factual container state plus the session layer ' +
      '("idle Ns" / "busy" / "none — dials on first exec"), always probed at call time.',
    parameters: {
      target: { type: 'string', description: 'Single entry point. Bare name / IP / domain matches in order: ssh config, then docker, then incus, then a live pty label (a collision goes to the earlier source). "byop:<label>" / "docker:<name>" / "incus:<name>" / "ssh:<name>" force a channel. For "byop:<label>", pass spawn the first time to create it and omit spawn afterwards to reuse it. Omit cmd → status probe.' },
      spawn: { type: 'string', description: 'Only valid together with a "byop:<label>" target, and required the first time that label is created: the full command that starts an interactive shell (e.g. "docker exec -it img bash"). It is not retained — pass it again if the label answers [E_NO_SESSION]. Requires cmd; mode is locked to pty; nested hops are dumb pipes (only the innermost bash frames).' },
      cmd: { type: 'string', description: "One raw shell string parsed by the remote bash (multi-line = one compound; exit = last command's). Omit with target → status probe; omit everything → roster." },
      mode: { type: 'string', enum: ['oneshot', 'pty'], description: "'oneshot' (default): stateless `bash -lc`, stdout/stderr separate, exit code is the process's own. 'pty': one persistent shell per (agent, target), cwd/env survive, streams merge, idle TTL 600s. A \"byop:<label>\" target locks mode to 'pty'." },
      stdin: { type: 'string', description: 'Input fed to the command. oneshot: piped to stdin. pty: written right after the command line (REPL-style) — only helps commands that read stdin there. Requires cmd.' },
      timeout: { type: 'number', description: 'Per-command timeout in seconds (default 120, row-configurable). pty: Ctrl-C first, then kill; an interrupt does not kill the session.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['exec', 'status', 'roster'] },
          text: { type: 'string', required: true },
          exit: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          durationMs: { type: 'integer' },
          cwd: { type: 'string' },
          stderr: { type: 'string' },
          timedOut: { type: 'boolean' },
          reconnected: { type: 'boolean' },
          truncated: { type: 'integer' },
          session: { type: 'string' },
          notice: { type: 'string' },
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
      // （守卫上方已排除 undefined/空串；类型面不收窄，照 RM0 样板以 as string 落地。）
      if (!hasCmd) {
        if (args.stdin !== undefined)
          throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd — status probes take no input')
        if (hasSpawn)
          throw new Error('[E_PARAMS] remote: spawn is an exec channel — pass cmd (there is nothing to probe for BYO-PTY)')
        // Ruling P19：空调用 = roster（注意力入口——本地扫描列名字，零拨号）；
        // 有 target = 单点 on-demand probe（第二现场）。
        if (!hasTarget)
          return { kind: 'roster', text: await driver.roster({ sessionKey: getSessionKey(exec) }), exit: null, durationMs: 0 }
        const text = await driver.status(args.target as string, { sessionKey: getSessionKey(exec) })
        return { kind: 'status', text, exit: null, durationMs: 0 }
      }
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
      if (r.session !== undefined) v.session = r.session
      if (r.notice !== undefined) v.notice = r.notice
      return v
    },
  })
}

function renderValue(v: RemoteToolValue): string {
  if (v.kind === 'status' || v.kind === 'roster') return v.text
  const parts: string[] = []
  if (v.reconnected === true) parts.push(RECONNECT_NOTICE)
  if (typeof v.notice === 'string' && v.notice.length > 0) parts.push(v.notice)
  parts.push(v.text)
  const secs = ((v.durationMs ?? 0) / 1_000).toFixed(1)
  const markers: string[] = []
  if (v.timedOut === true) markers.push('interrupted')
  if (v.truncated !== undefined) markers.push(`truncated, original ${v.truncated} chars`)
  const suffix = markers.length > 0 ? ` · ${markers.join(' · ')}` : ''
  const cwdTag = typeof v.cwd === 'string' && v.cwd.length > 0 ? ` · cwd ${v.cwd}` : ''
  const sessionTag = typeof v.session === 'string' && v.session.length > 0 ? ` · ${v.session}` : ''
  parts.push(`[exit ${v.exit} · ${secs}s${suffix}${cwdTag}${sessionTag}]`)
  if (v.stderr !== undefined && v.stderr.length > 0) parts.push('[stderr]', v.stderr)
  return parts.join('\n')
}
