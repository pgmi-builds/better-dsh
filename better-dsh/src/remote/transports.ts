import type { TargetPlan } from './target.ts'

/** POSIX 单引号机械转义（唯一一层转义，spec §三"一层机械转义"）。 */
export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** One-shot（§五.1）：不分配 tty，收尾 = 子进程退出码，零字符串扫描。 */
export function buildOneShotArgv(plan: TargetPlan, cmd: string): string[] {
  switch (plan.kind) {
    case 'ssh':
      // ssh 把 host 后的 argv 用空格拼接交远端 shell 解析——预先整体 shQuote，
      // 远端只做这一层解析，bash -lc 拿到原样 cmd。
      return ['ssh', '-o', 'BatchMode=yes', '-T', '--', plan.host, `bash -lc ${shQuote(cmd)}`]
    case 'docker':
      return ['docker', 'exec', '-i', '--', plan.container, 'bash', '-lc', cmd]
    case 'incus':
      return ['incus', 'exec', '--force-noninteractive', plan.container, '--', 'bash', '-lc', cmd]
  }
}

/** Persistent pty（Ruling 2）：ssh/incus 走宿主管道，docker 经 script(1) 托管宿主 PTY。 */
export function buildPtyArgv(plan: TargetPlan): string[] {
  switch (plan.kind) {
    case 'ssh':
      return ['ssh', '-tt', '-o', 'BatchMode=yes', '--', plan.host, 'bash']
    case 'docker':
      return ['script', '-qfec', `stty -echo 2>/dev/null ; exec docker exec -it -- ${shQuote(plan.container)} bash`, '/dev/null']
    case 'incus':
      return ['incus', 'exec', '--force-interactive', plan.container, '--', 'bash']
  }
}

/** BYO-PTY（§三 spawn）：工具只提供 PTY 托管 + Nonce 注入 + 收帧。 */
export function buildSpawnArgv(spawnCommand: string): string[] {
  return ['script', '-qfec', `stty -echo 2>/dev/null ; exec ${spawnCommand}`, '/dev/null']
}
