/**
 * `dsh-url-schema`: DASHR's URL-aware I/O backend.
 *
 * Owns the URL resolver + URL-aware read/write/grep/glob tools + the vendored
 * hashline + the scheme handlers (`skill://`, `agent://`, `dsh://`, `ctx://`,
 * `dvc://`, `http(s)://`). Mounted by `dashr-repl` (`src/index.ts`) via
 * `ctx.plugin()` — one plugin, one row, following the same mount pattern as
 * `DashrRuntime`.
 *
 * The four tools are registered on the AGENT's own scope layer (via
 * `agent/session-start` + `agent.ctx.effect`), so they shadow the preset's
 * built-in `read`/`write`/`grep`/`glob` for that agent (nearest layer wins in
 * dsh's tool registry) and unwind automatically when the agent is disposed —
 * the same pattern as `dsh-better-edit`. `write`/`grep`/`glob` are delegation
 * shells over the NATIVE definitions, captured before the wrappers register
 * ({@link captureNativeTools}); `read` keeps its vendored hashline file branch
 * and captures nothing. Host-plane services (`fs`, `skills`, `sessions`,
 * `settings`, `subagents`, `agents`) are read from the plugin's own context,
 */

import { registerAstDevices } from './vendored/devices/ast/ast-device.ts'
import { registerBrowserDevice } from './vendored/devices/browser/browser-device.ts'
import { installLspDevices } from './vendored/devices/lsp/lsp-device.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: each empty import brings the service's `ctx.<name>` Context merge
// (and event typing) into this program — the same idiom as `dashr-repl`.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'

import { resolveDocsDir } from './docs-dir.ts'
import { createAgentHandler } from './handlers/agent.ts'
import { createCtxHandler } from './handlers/ctx.ts'
import { createDshHandler } from './handlers/dsh.ts'
import { createDvcHandler } from './handlers/dvc.ts'
import { createHttpHandler, HTTP_SCHEMES } from './handlers/http.ts'
import { createSkillHandler } from './handlers/skill.ts'
import { captureNativeTools } from './native-capture.ts'
import { UrlResolver } from './resolver.ts'
import { createGlobTool } from './tools/glob.ts'
import { createGrepTool } from './tools/grep.ts'
import { createReadTool } from './tools/read.ts'
import { createWriteTool } from './tools/write.ts'

/** Cordis plugin name. */
export const name = 'dsh-url-schema'

/**
 * Required host-plane services — including the live agent registry
 * (`ctx.agents`, mounted by the `dsh-agent` row of `dsh-base`), which powers
 * the `agent://` roster's live `status` column. `replRuntime` is deliberately
 * NOT listed: nothing in this plugin reads it anymore (the `ctx://` handler
 * reads the calling agent out of the resolver env instead).
 */
export const inject = ['tools', 'fs', 'skills', 'subagents', 'sessions', 'settings', 'agents', 'sessionPersistence']

/** Plugin config — no options yet. */
export type Config = unknown

/** Register the four URL-aware tools on one agent's own scope layer. */
function installAgentTools(rootCtx: Context, agent: Agent, resolver: UrlResolver): void {
  agent.ctx.effect(async () => {
    // Capture the agent's FULL inherited surface BEFORE any wrapper
    // registers on the agent's own scope layer — after registration the
    // scoped lookup would resolve each name back to the wrapper itself
    // (infinite recursion), and after the wire-mask restrict (installed by
    // dashr-repl's later session-start listener) the masked names would
    // read as absent. `captureNativeTools` seeds the one full snapshot
    // ({@link captureAllTools}) and projects the write/grep/glob triple the
    // delegation wrappers need; `read` needs no capture: its file branch is
    // the vendored hashline pipeline, not a native delegate.
    const native = captureNativeTools(rootCtx, agent)
    const disposers: Array<() => void> = []
    disposers.push(agent.ctx.tools.register(createReadTool({ resolver, fs: rootCtx.fs, ctx: rootCtx })))
    disposers.push(agent.ctx.tools.register(createWriteTool({ nativeWrite: native.write })))
    disposers.push(agent.ctx.tools.register(createGrepTool({ resolver, nativeGrep: native.grep })))
    disposers.push(agent.ctx.tools.register(createGlobTool({ resolver, nativeGlob: native.glob })))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Mount the resolver + scheme handlers, then install the tools per agent. */
export function apply(ctx: Context, config: Config): void {
  const resolver = new UrlResolver()

  resolver.register('skill', createSkillHandler({ skills: ctx.skills, fs: ctx.fs }))
  resolver.register('agent', createAgentHandler({
    sessions: ctx.sessions,
    subagents: ctx.subagents,
    sessionPersistence: ctx.sessionPersistence,
    agents: ctx.agents,
  }))
  // Pass `docsDir` explicitly so the handler's fixed-depth `dirname×N` fallback
  // (broken under tsdown bundling) is never reached.
  resolver.register('dsh', createDshHandler({ settings: ctx.settings, docsDir: resolveDocsDir() }))
  // `dvc://` device registry: bare read = roster, <device> read = doc,
  // write = device dispatch (see vendored/devices/).
  resolver.register('dvc', createDvcHandler())
  // `ctx://` reads the calling agent out of the resolver env (supplied by the
  // tool layer per call), so it needs no service and registers directly.
  resolver.register('ctx', createCtxHandler())
  // Devices (design D8): light registration — no dlopen, no Chrome launch,
  // no LSP spawn until the first `write dvc://<device>` executes.
  registerAstDevices()
  registerBrowserDevice()
  installLspDevices()

  // One stateless handler instance serves both web schemes.
  const httpHandler = createHttpHandler()
  for (const scheme of HTTP_SCHEMES) resolver.register(scheme, httpHandler)

  const registered = new WeakSet<Agent>()
  ctx.on('agent/session-start', ({ agent }) => {
    if (registered.has(agent)) return
    registered.add(agent)
    try {
      installAgentTools(ctx, agent, resolver)
    } catch (error) {
      ctx.logger('dsh-url-schema').warn(
        `failed to install URL-aware tools for agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}

export default { name, inject, apply }
