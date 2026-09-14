/**
 * `dsh-url-schemes`: DASHR's URL-aware I/O backend.
 *
 * Owns the URL resolver + URL-aware read/write/grep/glob tools + the scheme
 * handlers (`skill://`, `agent://`, `dsh://`, `ctx://`, `dvc://`,
 * `http(s)://`). This module is also the COMPOSITION ROOT that wires the
 * independent `src/hashline` module (read chain + edit family) into one
 * plugin mount. Orthogonality (2026-09-13): `src/hashline` imports nothing
 * from here; nothing in this module outside `index.ts` imports hashline —
 * remove this composition and hashline still stands alone (and vice versa).
 * Mounted by `dashr-repl` (`src/index.ts`) via
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
 * and is itself captured (`NATIVE_TOOL_NAMES` includes it) — the captured native
 * serves as the terminal delegate when a gate disables the owning branch. Host-plane services (`fs`, `skills`, `sessions`,
 * `settings`, `subagents`, `agents`) are read from the plugin's own context,
 */

import { registerAstDevices } from '../devices/ast/ast-device.ts'
import { registerBrowserDevice } from '../devices/browser/browser-device.ts'
import { installLspDevices } from '../devices/lsp/lsp-device.ts'
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
import { disposeLspGate, lspGateNotice, lspGateSyncOnLand } from '../devices/lsp/lsp-gate.ts'
import { wrapFsWithSchemes } from '../fs-aware/wrap.ts'
import { createAgentHandler } from './handlers/agent.ts'
import { createCtxHandler } from './handlers/ctx.ts'
import { generalSection } from './general-section.ts'
import { createDshHandler } from './handlers/dsh.ts'
import { createDvcHandler } from './handlers/dvc.ts'
import { createHttpHandler, HTTP_SCHEMES } from './handlers/http.ts'
import { createSkillHandler } from './handlers/skill.ts'
import { captureNativeTools } from './native-capture.ts'
import { UrlResolver } from './resolver.ts'
import { createGlobTool } from './tools/glob.ts'
import { createGrepTool } from './tools/grep.ts'
import { createSchemeReadTool } from './tools/read.ts'
import { createWriteTool } from './tools/write.ts'
import { initHashlineRuntime, installHashline } from '../hashline/install.js'
import { FsSandboxController } from '../hashline/sandbox.js'
import { resolveGates, type ReadGates, type UrlSchemesConfig } from './gates.ts'
import { listDvcDevices } from './handlers/dvc.ts'

/** Cordis plugin name. */
export const name = 'dsh-url-schemes'

/**
 * Required host-plane services — including the live agent registry
 * (`ctx.agents`, mounted by the `dsh-agent` row of `dsh-base`), which powers
 * the `agent://` roster's live `status` column. `replRuntime` is deliberately
 * NOT listed: nothing in this plugin reads it anymore (the `ctx://` handler
 * reads the calling agent out of the resolver env instead).
 */
export const inject = ['tools', 'fs', 'skills', 'subagents', 'sessions', 'settings', 'agents', 'sessionPersistence']

/** Feature gates (patch-line `config:` block) — see `./gates.ts`. */
export type { ReadGates as UrlSchemesGates, UrlSchemesConfig as Config } from './gates.ts'
export { resolveGates } from './gates.ts'

/** Register the four URL-aware tools on one agent's own scope layer. */
/**
 * The lsp feedback loop (native-tools Wave3): both hooks route through the
 * mounted `lsp` device with the EXACT content the write lands, so
 * diagnostics describe what was just written (not a stale didOpen) and
 * formatting sees the pre-write text. Every failure — no device, no server
 * for this language, cold-start noise — reads as "no feedback"; a
 * serverless write is byte-identical to the pre-change behavior.
 */
export function buildLspWriteFeedback(): { preWriteFormat: import('./tools/write.ts').PreWriteFormat, postWrite: import('./tools/write.ts').PostWriteFeedback } {
  const lspFeedback = async (action: 'diagnostics' | 'format', filePath: string, content: string): Promise<string | undefined> => {
    try {
      const device = listDvcDevices().get('lsp')
      if (device === undefined) return undefined
      const result = await device.execute({ action, file: filePath, content, ...(action === 'diagnostics' ? { saved: true } : {}) }) as {
        ok?: boolean
        summary?: string
        diagnostics?: Array<{ severityName: string, message: string, line?: number }>
        formatted?: string
        changed?: boolean
        check?: string
      }
      if (result?.ok !== true) return undefined
      if (action === 'format') {
        return result.changed === true && typeof result.formatted === 'string' ? result.formatted : undefined
      }
      // F2-d (v0.2.0-a): a diagnostic whose line lies beyond the just-written
      // content's line count cannot refer to what was written — drop it and
      // recompute the counts so the summary reflects only the retained set.
      const lineCount = content.split('\n').length
      const retained = (result.diagnostics ?? []).filter(record => record.line === undefined || record.line <= lineCount)
      if (retained.length === 0) return undefined
      const severityOrder = ['error', 'warning', 'info', 'hint'] as const
      const counts = new Map<string, number>()
      for (const record of retained) counts.set(record.severityName, (counts.get(record.severityName) ?? 0) + 1)
      const parts: string[] = []
      for (const name of severityOrder) {
        const count = counts.get(name)
        if (count !== undefined) parts.push(`${count} ${name}(s)`)
      }
      const summary = parts.length > 0 ? parts.join(', ') : 'no diagnostics'
      if (summary === 'no diagnostics') return undefined
      const first = retained.find(record => record.severityName === 'error' || record.severityName === 'warning')
      const suffix = result.check === 'timeout-dropped-rustc' ? ' (slow check: compiler diagnostics pending)' : ''
      return first === undefined
        ? `${summary}${suffix}`
        : `${summary}${suffix} — first: ${first.message.slice(0, 200)}`
    } catch {
      return undefined
    }
  }
  return {
    preWriteFormat: (filePath, content) => lspFeedback('format', filePath, content),
    postWrite: (filePath, content) => lspFeedback('diagnostics', filePath, content),
  }
}

async function installAgentTools(rootCtx: Context, agent: Agent, resolver: UrlResolver, gates: ReadGates): Promise<void> {
  // Gate granularity (reshape 后，2026-09-12; 正交化改排，2026-09-13):
  // - `urlSchemes: false` → write/grep/glob/scheme-read 不安装，FS 后端不拦截
  //   scheme（挂载行 gate），一切路径走原生语义。
  // - `hashline: false` → hashline install（edit/undo 家族 + 锚点 read）不挂，
  //   captured 原生 read 独立站立。
  // - 两者皆开 → read 单注册链：scheme wrapper（外）→ hashline 锚点 read
  //   （内）→ captured 原生 read（终端）。两模块互不 import：hashline 零
  //   出向引用；scheme wrapper 不识 hashline——组装只发生在这里。
  agent.ctx.effect(async () => {
    // Capture the agent's FULL inherited surface BEFORE any wrapper
    // registers on the agent's own scope layer — after registration the
    // scoped lookup would resolve each name back to the wrapper itself
    // (infinite recursion), and after the wire-mask restrict (installed by
    // dashr-repl's later session-start listener) the masked names would
    // read as absent. `captureNativeTools` seeds the one full snapshot
    // ({@link captureAllTools}) — read/write/grep/glob all delegate to it:
    // the capture anchors on the SEMANTIC NAME, so whatever registered under
    // `read` before us (native tool or another feature's wrapper) becomes the
    // chassis terminal delegate.
    const native = captureNativeTools(rootCtx, agent)
    const disposers: Array<() => void> = []

    // v0.2.2-c: the sandbox controller is created HERE (composition root) and
    // injected into both the hashline install and the write wrapper, so the
    // edit family and the write escalation advertisement share one instance.
    const hashlineSandbox = new FsSandboxController(rootCtx)

    // Read chain (single `read` registration): hashline's anchored read sits
    // INSIDE the scheme wrapper as the terminal delegate. Each module stands
    // alone: hashline alone → its read registers directly; url-schemes alone
    // → the wrapper delegates files to the captured native read.
    let readDelegate = native.read
    if (gates.hashline) {
      const hashline = await installHashline(rootCtx, agent, {
        sandbox: hashlineSandbox,
        editFeedback: buildLspWriteFeedback().postWrite,
      })
      disposers.push(...hashline.disposers)
      readDelegate = hashline.readTool
    }
    if (gates.urlSchemes || gates.hashline) {
      const readTool = gates.urlSchemes && readDelegate !== undefined
        ? createSchemeReadTool({ resolver, capturedRead: readDelegate })
        : readDelegate
      if (readTool !== undefined) disposers.push(agent.ctx.tools.register(readTool))
    }
    if (gates.urlSchemes) {
      disposers.push(agent.ctx.tools.register(createWriteTool({
        nativeWrite: native.write,
        sandbox: hashlineSandbox,
        ...buildLspWriteFeedback(),
      })))
    }
    try {
      // L1 existence disclosure (gated): general URL grammar + bare-enumeration
      // pointer. Rendered only while the URL capability is on. (Hashline's tool
      // guidance sections ride its own install above.)
      if (gates.urlSchemes) {
        const general = generalSection(gates)
        if (general !== undefined) disposers.push(agent.ctx.systemPrompt.section(general))
      }
    } catch { /* guidance is best-effort; the tools stand alone */ }
    if (gates.urlSchemes) {
      disposers.push(agent.ctx.tools.register(createGrepTool({ resolver, nativeGrep: native.grep })))
      disposers.push(agent.ctx.tools.register(createGlobTool({ resolver, nativeGlob: native.glob })))
    }

    // lsp gate (spec docs/specs/lsp/spec.md): post-hoc sync + availability
    // notice. Attached unconditionally — the gate module is inert until the
    // agent decides per session. Reads pre-warm (didOpen); edit/write sync
    // landed content; nag rides edit/write results with the 10-cap enforced
    // inside the gate module. Pure post-execute observation — nothing here
    // intercepts or delays the mutation path.
    const sessionId = agent.id
    disposers.push(agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      const name = exec.name
      if (name !== 'read' && name !== 'edit' && name !== 'write') return decision
      const args = exec.arguments as { path?: string, file_path?: string } | undefined
      const filePath = args?.path ?? args?.file_path
      if (typeof filePath !== 'string' || filePath === '') return decision
      if (name === 'read') {
        lspGateSyncOnLand(sessionId, 'read', filePath)
        return decision
      }
      lspGateSyncOnLand(sessionId, name as 'edit' | 'write', filePath)
      if (result.isError) return decision
      const notice = lspGateNotice(sessionId, filePath)
      if (notice === undefined) return decision
      const record = decision as { kind?: string, content?: Array<{ type: string, text?: string }> }
      if (record.kind !== 'accept') return decision
      const base = record.content ?? (result.content as Array<{ type: string, text?: string }> | undefined) ?? []
      record.content = [...base, { type: 'text', text: `\n${notice}` }]
      return decision
    }))
    disposers.push(() => disposeLspGate(sessionId))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Mount the resolver + scheme handlers, then install the tools per agent. */
export function apply(ctx: Context, config: UrlSchemesConfig | undefined): void {
  // Hashline one-time init: warm the hasher and materialize the editable
  // per-preset guidance overrides (idempotent; failures are noise, never a
  // failed boot).
  initHashlineRuntime()
  const resolver = new UrlResolver()

  // FS-gate scheme resolution (change 2026-09-12-fs-scheme-resolution): wrap
  // the live ctx.fs instance so EVERY ctx.fs consumer — the platform's native
  // read/write/edit tools included — resolves file-type scheme URLs without
  // any tool-layer participation. Session-layer schemes (ctx://, agent://,
  // skill:// — the latter because the host skill registry's layered catalog
  // resolves only against a calling agent) answer the structured boundary
  // error here; the read tool's scheme branch
  // keeps serving them with the calling agent's context WHEN the hashline
  // gate enables the read wrapper; with `hashline: false` session-layer
  // schemes have no read channel (the tool-layer grep/glob wrappers still
  // reach them). Idempotent; every
  // added behavior sits behind the `urlSchemes` gate.
  // FS-gate scheme resolution must never take the plugin down: a wrap failure
  // degrades to the stock fs service (log warn), never a failed boot.
  if (resolveGates(config).urlSchemes && ctx.fs) {
    try {
      wrapFsWithSchemes(ctx.fs as never, { settings: ctx.settings })
    } catch (error) {
      ctx.logger('dsh-url-schemes').warn(
        `fs scheme wrap failed; running on the stock filesystem service: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

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
  // write = device dispatch (see src/devices/).
  resolver.register('dvc', createDvcHandler())
  // `ctx://` reads the calling agent out of the resolver env (supplied by the
  // tool layer per call), so it needs no service and registers directly.
  resolver.register('ctx', createCtxHandler({ sessionPersistence: ctx.sessionPersistence }))
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
    installAgentTools(ctx, agent, resolver, resolveGates(config)).catch((error) => {
      ctx.logger('dsh-url-schemes').warn(
        `failed to install URL-aware tools for agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  })
}

export default { name, inject, apply }
