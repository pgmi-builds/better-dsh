/**
 * `hashline` standalone install surface (orthogonality, 2026-09-13).
 *
 * The hashline feature — anchored reads + the `edit`/`undo` family + tool
 * guidance — is a SELF-CONTAINED module: it references nothing from
 * `url-schemes` (verified: zero outbound imports), and this module gives it a
 * first-class entry so it works with `url-schemes` absent. The plugin
 * composition root (`url-schemes/index.ts`) calls these functions; a future
 * standalone hashline plugin row would call exactly the same ones.
 *
 * Exports:
 * - {@link initHashlineRuntime} — one-time process init (hasher warm-up +
 *   per-preset guidance materialization).
 * - {@link createHashlineReadTool} — the anchored `read` doer (file branch
 *   only: no scheme knowledge). The composition root chains it under any
 *   scheme-aware wrapper; standalone, it registers as `read` directly.
 * - {@link installHashline} — per-agent registration of the `edit`/`undo`
 * family and an INJECTED edit-feedback hook. Does NOT register
 * `read` (the composition owns the single `read` registration; see the
 * same-layer same-name note in the read tool docs).
 *   same-layer same-name note in the read tool docs).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { normalizeRequest as normReq, assertReadRequest } from './contract.js'
import { ctxFsIO, type FileIO } from './fs-bridge.js'
import { readAndServe } from './read-and-serve.js'
import { execCwd, withWorkspace } from './session-view.js'
import { FsSandboxController } from './sandbox.js'
import { registerEditTool } from './tool-edit.js'
import { registerUndoTool } from './tool-undo.js'
import { composeSections, ensurePresetGuidance, GUIDANCE_SECTIONS } from './guidance.js'
import { configDir } from './paths.js'
import { initHasher } from './hashline/hash-assign.js'

/**
 * One-time process init: warm the hasher and materialize the editable
 * per-preset guidance overrides (idempotent; failures are noise, never a
 * failed boot).
 */
export function initHashlineRuntime(): void {
  void initHasher().catch(() => { })
  void ensurePresetGuidance(configDir()).catch(() => { })
}

/** Dependencies for the anchored read doer. */
export interface HashlineReadDeps {
  /** The fs bridge the anchor pipeline serves through (`ctxFsIO(fs, ctx)`). */
  io: FileIO
}

/**
 * The hashline `read` doer: every path is a filesystem path run through the
 * anchored read-and-serve pipeline (`HASH│content` anchors + served-row store
 * that the `edit` tool consumes). No scheme knowledge — scheme-aware wrapping
 * is the caller's business (composition root chains this under its wrapper;
 * standalone callers register it as `read` directly).
 */
export function createHashlineReadTool(deps: HashlineReadDeps): ToolDefinition {
  const { io } = deps
  return defineTool({
    name: 'read',
    description:
      'Read a text file (each line returned as `HASH│content` with a 3-char hash anchor for later edit calls). File reads page with offset/limit.',
    parameters: {
      path: {
        type: 'string',
        description: 'File path (hashline-anchored read).',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-indexed, file reads only)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (file reads only)',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const canonical = normReq(args)
      assertReadRequest(canonical)
      const rawPath = canonical.path
      return withWorkspace(execCwd(exec), async () => {
        const cwd = execCwd(exec)
        const signal = exec.signal
        const { text, absolutePath } = await readAndServe(io, rawPath, cwd, {
          signal,
          offset: canonical.offset,
          limit: canonical.limit,
        })
        // Record the observation with the fs policy gate so later built-in
        // write/edit calls see this file at the version the model just read.
        await io.emitObserved(absolutePath, exec, signal)
        return text
      })
    },
  })
}

/** Per-agent installation result. */
export interface HashlineInstall {
  /** Disposers for everything registered on the agent's layer. */
  disposers: Array<() => void>
  /** The fs bridge (shared with the read doer and the write wrapper). */
  io: FileIO
  /** The sandbox controller shared with the edit family and the write wrapper. */
  sandbox: FsSandboxController
  /** The anchored read doer — the caller registers it (alone or chained). */
  readTool: ToolDefinition
}

/** Options for {@link installHashline}. */
export interface HashlineInstallOpts {
  /** Inject a sandbox controller to share with a co-mounted write wrapper. */
  sandbox?: FsSandboxController
  /**
   * Post-edit feedback source (e.g. the lsp diagnostics hook), injected by
   * the composition root. Hashline knows nothing about lsp or url-schemes;
   * absent → no post-edit hook is attached.
   */
  editFeedback?: (filePath: string, content: string) => Promise<string | undefined>
}

/**
 * Register the hashline feature on one agent's own scope layer (async: the
 * `edit`/`undo` tools, the tool guidance sections (preset-aware, compiled
 * defaults on failure), and the lsp post-edit diagnostics hook. `read` is NOT
 * registered here — the caller owns the single `read` registration and should
 * register {@link createHashlineReadTool}'s output (directly or chained).
 */
export async function installHashline(rootCtx: Context, agent: Agent, opts: HashlineInstallOpts = {}): Promise<HashlineInstall> {
  const disposers: Array<() => void> = []
  const sandbox = opts.sandbox ?? new FsSandboxController(rootCtx)
  // One bridge for the agent's lifetime (read anchors + edit family share it).
  const io = ctxFsIO(rootCtx.fs, rootCtx)
  const readTool = createHashlineReadTool({ io })

  disposers.push(registerEditTool(rootCtx, agent.ctx, io, sandbox))
  disposers.push(registerUndoTool(rootCtx, agent.ctx, io, sandbox))

  // The optional post-edit feedback hook (injected — see opts.editFeedback):
  // after a successful edit with an explicit path, read the landed content
  // back and attach the feedback summary — same contract as the write
  // wrapper's post-write hook (EXACT content, didSave freshness, span
  // guard). Anchor-only edits (path: null) skip silently — the resolved
  // path lives inside hashline's own logic.
  const diagnosticsHook = opts.editFeedback
  if (diagnosticsHook !== undefined) {
  disposers.push(agent.ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (exec.name !== 'edit' || result.isError) return decision
    const args = exec.arguments as { path?: string | null } | undefined
    const rawPath = args?.path
    if (typeof rawPath !== 'string' || rawPath === '') return decision
    try {
      const content = await io.readText(rawPath, exec.signal)
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

  return { disposers, io, sandbox, readTool }
}

