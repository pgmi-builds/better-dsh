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
import { ctxFsIO } from './vendored/hashline/fs-bridge.js'
import { FsSandboxController } from './vendored/hashline/sandbox.js'
import { registerEditTool } from './vendored/hashline/tool-edit.js'
import { registerUndoTool } from './vendored/hashline/tool-undo.js'
import { registerWriteHook } from './vendored/hashline/write-hook.js'
import { composeSections, ensurePresetGuidance, GUIDANCE_SECTIONS } from './vendored/hashline/guidance.js'
import { configDir } from './vendored/hashline/paths.js'
import { initHasher } from './vendored/hashline/hashline/hash-assign.js'
import { listDvcDevices } from './handlers/dvc.ts'

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
    disposers.push(agent.ctx.tools.register(createWriteTool({
      nativeWrite: native.write,
      ...buildLspWriteFeedback(),
    })))

    // The hashline EDIT family (v0.2.0-b): vendored since v0.1.8c, wired here
    // for the first time — same own-layer pattern as the wrappers above, so
    // `edit` shadows the preset's built-in and unwinds with the agent.
    // `read` needs no registration: the DASHR read wrapper already runs the
    // vendored hashline read pipeline.
    const hashlineIo = ctxFsIO(rootCtx.fs, rootCtx)
    const hashlineSandbox = new FsSandboxController(rootCtx)
    disposers.push(registerEditTool(rootCtx, agent.ctx, hashlineIo, hashlineSandbox))
    disposers.push(registerUndoTool(rootCtx, agent.ctx, hashlineIo, hashlineSandbox))
    disposers.push(registerWriteHook(rootCtx, agent.ctx, hashlineIo))
    // The lsp feedback loop rides edit too — but NOT through the write
    // wrapper (edit lands through hashline's own fs-write). A post-execute
    // listener covers every successful edit with an explicit path; `write`
    // is skipped here because the wrapper already owns its feedback pair.
    {
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
    } catch { /* guidance is best-effort; the tools stand alone */ }
    disposers.push(agent.ctx.tools.register(createGrepTool({ resolver, nativeGrep: native.grep })))
    disposers.push(agent.ctx.tools.register(createGlobTool({ resolver, nativeGlob: native.glob })))
    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/** Mount the resolver + scheme handlers, then install the tools per agent. */
export function apply(ctx: Context, config: Config): void {
  // Hashline one-time init (v0.2.0-b): warm the hasher and materialize the
  // editable per-preset guidance overrides (idempotent; failures are noise,
  // never a failed boot).
  void initHasher().catch(() => {})
  void ensurePresetGuidance(configDir()).catch(() => {})
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
