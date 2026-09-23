/**
 * `dashr-remote` — the remote-execution-framework row (plan
 * docs/10_plans/2026-09-23-remote-framework-impl.md Task 9; spec
 * docs/10_plans/2026-09-23-remote-execution-framework.md). Same row shape as
 * `src/mobile/plugin.ts` / the archived RM0 row: one bundle-patch row that,
 * when a `tools` service is composed, boots one RemoteDriver and registers
 * the model-facing `remote` tool. The driver (pty session pool + idle timers)
 * is disposed with the row's fiber. Zero static injects: loads dormant in
 * compositions without tools.
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RemoteDriver } from './driver.ts'
import { createRemoteTool } from './tool.ts'

export const name = 'dashr-remote'
export const inject: string[] = []

/** 运行参数旋钮（Ruling P18）：无别名表面——容器一律显式 'docker:' / 'incus:' 前缀。 */
export interface RemoteRowConfig {
  execTimeoutSec: number
  idleTtlSec: number
  maxOutputChars: number
}

export const Config: z<RemoteRowConfig> = z
  .object({
    execTimeoutSec: z.natural().min(1).default(120),
    idleTtlSec: z.natural().min(1).default(600),
    maxOutputChars: z.natural().min(1).default(30_000),
  })
  .default({ execTimeoutSec: 120, idleTtlSec: 600, maxOutputChars: 30_000 }) as unknown as z<RemoteRowConfig>

/** MUST stay an arrow（RM0 plugin.ts 同注：function 声明会被 cordis 当构造器 new 掉，返回的 disposer 丢失）。 */
export const apply = (ctx: Context, config: RemoteRowConfig): (() => void) => {
  const driver = new RemoteDriver({
    execTimeoutSec: config.execTimeoutSec,
    idleTtlSec: config.idleTtlSec,
    maxOutputChars: config.maxOutputChars,
  })
  ctx.inject(['tools'], (toolsCtx: Context) => {
    toolsCtx.tools.register(
      createRemoteTool(driver, { getSessionKey: (exec) => exec.agent?.id ?? 'remote:no-session' }),
    )
  })
  return () => void driver.dispose()
}

export default { name, inject, Config, apply }
