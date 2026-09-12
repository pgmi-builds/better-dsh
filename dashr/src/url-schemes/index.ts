/**
 * `dsh-url-schemes`: DASHR's URL-aware I/O backend.
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
 * and is itself captured (`NATIVE_TOOL_NAMES` includes it) — the captured native
 * serves as the terminal delegate when a gate disables the owning branch. Host-plane services (`fs`, `skills`, `sessions`,
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
import { createReadTool } from './tools/read.ts'
import { createWriteTool } from './tools/write.ts'
import { ctxFsIO } from './vendored/hashline/fs-bridge.js'
import { FsSandboxController } from './vendored/hashline/sandbox.js'
import { registerEditTool } from './vendored/hashline/tool-edit.js'
import { registerUndoTool } from './vendored/hashline/tool-undo.js'
import { composeSections, ensurePresetGuidance, GUIDANCE_SECTIONS } from './vendored/hashline/guidance.js'
import { configDir } from './vendored/hashline/paths.js'
import { initHasher } from './vendored/hashline/hashline/hash-assign.js'
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

/** Feature gates (patch-line `config:` block). Every key defaults on — opt-out, not opt-in. */
export interface Config {
  /** URL scheme resolution: scheme branches of read/write/grep/glob + `ctx://`. */
  urlSchemes?: boolean
  /** Hashline feature: read anchors + the `edit`/`undo` tool family. */
  hashline?: boolean
}

/** Plugin config: gates plus the FS-wrap session workspace hint. */
export interface Config {
  urlSchemes?: boolean
  hashline?: boolean
  /** Session workspace passed to the FS-layer skill resolution (deployment-declared). */
  sessionCwd?: string
}

/** Resolved gate pair. */
export interface UrlSchemesGates {
  readonly urlSchemes: boolean
  readonly hashline: boolean
}

/** Every key defaults on — the service is opt-out, not opt-in. */
export function resolveGates(config: Config | undefined): UrlSchemesGates {
  return {
    urlSchemes: config?.urlSchemes !== false,
    hashline: config?.hashline !== false,
  }
}

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

function installAgentTools(rootCtx: Context, agent: Agent, resolver: UrlResolver, gates: UrlSchemesGates): void {
  // Gate granularity (reshape 后，2026-09-12):
  // - `urlSchemes: false` → write/grep/glob wrappers 不安装，FS 后端不拦截
  //   scheme（挂载行 gate），一切路径走原生语义。
  // - `hashline: false` → read wrapper 不安装（captured 原生 read 独立站立，
  //   scheme 解析由挂载的 FS 后端承担），edit/undo 家族亦不安装。
  // - `urlSchemes: true && hashline: true` → read wrapper 双分支：scheme 走
  //   URL 呈现分支（无锚点），真实文件走 hashline 锚点管线。
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

    // v0.2.2-c: instantiated BEFORE the write registration so the URL-aware
    // wrapper can re-advertise the escalation fields (see WriteToolDeps.sandbox);
    // the hashline edit family below shares the same controller instance.
    const hashlineSandbox = new FsSandboxController(rootCtx)
    // The fs bridge the hashline anchor transform serves through — one bridge
    // for the agent's lifetime (read anchors + edit family share it).
    const hashlineIo = ctxFsIO(rootCtx.fs, rootCtx)

    // The read wrapper exists FOR the hashline anchor pipeline — register it
    // only when `hashline` is on. With `hashline: false` the captured native
    // read stands alone and scheme resolution belongs to the mounted FS
    // backend (`urlSchemes` gate), not to any tool-layer code.
    if (gates.hashline) {
      disposers.push(agent.ctx.tools.register(createReadTool({
        resolver,
        fs: rootCtx.fs,
        ctx: rootCtx,
        gates,
        capturedRead: native.read,
      })))
    }
    if (gates.urlSchemes) {
      disposers.push(agent.ctx.tools.register(createWriteTool({
        nativeWrite: native.write,
        sandbox: hashlineSandbox,
        ...buildLspWriteFeedback(),
      })))
    }

    // The hashline EDIT family (v0.2.0-b): vendored since v0.1.8c, wired here
    // for the first time — same own-layer pattern as the wrappers above, so
    // `edit` shadows the preset's built-in and unwinds with the agent.
    // `read` needs no registration: the DASHR read wrapper already runs the
    // vendored hashline read pipeline.
    if (gates.hashline) {
      disposers.push(registerEditTool(rootCtx, agent.ctx, hashlineIo, hashlineSandbox))
      disposers.push(registerUndoTool(rootCtx, agent.ctx, hashlineIo, hashlineSandbox))
    }
    // The lsp feedback loop rides edit too — but NOT through the write
    // wrapper (edit lands through hashline's own fs-write). A post-execute
    // listener covers every successful edit with an explicit path; `write`
    // is skipped here because the wrapper already owns its feedback pair.
    if (gates.hashline) {
      // The lsp feedback loop rides edit (hashline's own fs-write bypasses
      // the write wrapper): after a successful edit with an explicit path,
      // read the landed content back and attach the diagnostics summary —
      // same contract as the write wrapper's post-write hook (EXACT content,
      // didSave freshness, span guard). `write` is skipped: the wrapper
      // already owns its feedback pair. Anchor-only edits (path: null) skip
      // silently — the resolved path lives inside hashline's own logic.
      const diagnosticsHook = buildLspWriteFeedback().postWrite
      disposers.push(agent.ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next()
        if (exec.name !== 'edit' || result.isError) return decision
        const args = exec.arguments as { path?: string | null } | undefined
        const rawPath = args?.path
        if (typeof rawPath !== 'string' || rawPath === '') return decision
        try {
          const content = await hashlineIo.readText(rawPath, exec.signal)
          if (typeof content !== 'string') return decision
          const summary = await diagnosticsHook(rawPath, content)
          if (summary === undefined) return decision
          const decisionRecord = decision as { kind?: string, content?: Array<{ type: string, text?: string }> }
          if (decisionRecord.kind !== 'accept') return decision
          const base = decisionRecord.content ?? (result.content as Array<{ type: string, text?: string }> | undefined) ?? []
          decisionRecord.content = [...base, { type: 'text', text: `\n${summary}` }]
          return decision
        } catch {
          return decision
        }
      }))
    }
    // Guidance sections shadow the preset's built-in tool guidance on the
    // agent's own layer (same names win). agentPresets present → per-preset
    // overrides; absent or failing → compiled defaults, never a failed boot.
    try {
      const agentPresets = rootCtx.get('agentPresets') as { composedPreset: (ctx: unknown) => string } | undefined
      let sections = GUIDANCE_SECTIONS.map(section => ({ name: section.name, order: section.defaultOrder, text: section.renderDefault() }))
      if (agentPresets !== undefined) {
        try {
          const resolved = await composeSections(agentPresets.composedPreset(agent.ctx), configDir())
          sections = resolved.map(section => ({ name: section.name, order: section.order, text: section.text }))
        } catch { /* compiled defaults already in place */ }
      }
      for (const section of sections) disposers.push(agent.ctx.systemPrompt.section(section))
      // L1 existence disclosure (gated): general URL grammar + bare-enumeration
      // pointer. Rendered only while the URL capability is on.
      const general = generalSection(gates)
      if (general !== undefined) disposers.push(agent.ctx.systemPrompt.section(general))
    } catch { /* guidance is best-effort; the tools stand alone */ }
    if (gates.urlSchemes) {
      disposers.push(agent.ctx.tools.register(createGrepTool({ resolver, nativeGrep: native.grep })))
      disposers.push(agent.ctx.tools.register(createGlobTool({ resolver, nativeGlob: native.glob })))
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Mount the resolver + scheme handlers, then install the tools per agent. */
export function apply(ctx: Context, config: Config | undefined): void {
  // Hashline one-time init (v0.2.0-b): warm the hasher and materialize the
  // editable per-preset guidance overrides (idempotent; failures are noise,
  // never a failed boot).
  void initHasher().catch(() => {})
  void ensurePresetGuidance(configDir()).catch(() => {})
  const resolver = new UrlResolver()

  // FS-gate scheme resolution (change 2026-09-12-fs-scheme-resolution): wrap
  // the live ctx.fs instance so EVERY ctx.fs consumer — the platform's native
  // read/write/edit tools included — resolves file-type scheme URLs without
  // any tool-layer participation. Session-layer schemes (ctx://, agent://)
  // answer the structured boundary error here; the read tool's scheme branch
  // keeps serving them with the calling agent's context WHEN the hashline
  // gate enables the read wrapper; with `hashline: false` session-layer
  // schemes have no read channel (the tool-layer grep/glob wrappers still
  // reach them). Idempotent; every
  // added behavior sits behind the `urlSchemes` gate.
  // FS-gate scheme resolution must never take the plugin down: a wrap failure
  // degrades to the stock fs service (log warn), never a failed boot.
  if (resolveGates(config).urlSchemes && ctx.fs) {
    try {
      wrapFsWithSchemes(ctx.fs as never, { skills: ctx.skills, settings: ctx.settings, sessionCwd: config?.sessionCwd || undefined })
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
  // write = device dispatch (see vendored/devices/).
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
    try {
      installAgentTools(ctx, agent, resolver, resolveGates(config))
    } catch (error) {
      ctx.logger('dsh-url-schemes').warn(
        `failed to install URL-aware tools for agent ${agent.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}

export default { name, inject, apply }
