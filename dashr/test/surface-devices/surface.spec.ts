/**
 * `surface-and-devices` wave 1 — the wire-mask surface (design D1–D5):
 * session-start full capture → own-layer wrapper registration → registry
 * `restrict({deny})` → single-state REPL binding auto-map → the
 * captured-definition `send_message` downlink → the repositioned
 * bridge-instructions catalog section.
 *
 * The registry here is the REAL `ToolRuntime` over a hand-built layer chain
 * (global registrations + one agent's own layer + the session-start
 * restriction), so every assertion exercises the registry's actual
 * visibility semantics — the same chain production composes.
 */

import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { toolCallId } from '../../src/tool-call-id.ts'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import { FakeCellRuntime, fakeRuntime, runCell } from '../helpers.ts'
import Presentation, { MASKED_TOOL_NAMES } from '../../src/index.ts'
import { getCapturedTools } from '../../src/url-schema/native-capture.ts'
import { inject as urlSchemaInject } from '../../src/url-schema/index.ts'
import { renderReplBridgeInstructions, REPL_BRIDGE_CATALOG_MODE } from '../../src/py-sdk.ts'
import type { DASHRSdkSchema } from '../../src/py-sdk.ts'

/** Everything the surface tests need: the composition harness plus the started agent's live scoped context. */
interface Surface {
  ctx: Context
  agent: Agent
  events: { type: string, data: unknown }[]
  /** The agent's live scoped context (own-layer registrations land here). */
  agentCtx: Context
  /** An unrelated agent with NO presentation row (the neighbor scope). */
  neighbor: Agent
  /** Fire the production-shaped session-start dispatch for the agent. */
  startSession: () => void
}

/**
 * Boot the full composition with REAL layer semantics: systemPrompt + the
 * real ToolRuntime (global layer), a fake cell runtime, the six host-plane
 * services the url-schema row injects (mount-time closures only here — no
 * scheme handler is exercised), then the presentation row mounted into a
 * preset standing scope with one agent joined under it. The agent is the
 * structural capture-session fake from the presentation harness, wired to
 * its live scoped context so own-layer registrations are real.
 */
async function setupSurface(): Promise<Surface> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  const runtimeFiber = await fakeRuntime(ctx)
  onTestFinished(async () => { await (runtimeFiber as { dispose(): Promise<void> }).dispose() })
  const servicesFiber = await ctx.plugin({
    name: 'fake-host-services',
    apply(c) {
      // Whatever the url-schema row injects (minus `tools`, mounted above):
      // this spec never exercises a scheme handler, so opaque stubs satisfy
      // the inject wait — and tracking the live list keeps the harness
      // honest when sibling waves extend it.
      for (const service of urlSchemaInject) {
        if (service === 'tools') continue
        c.provide(service, {})
      }
    },
  })
  onTestFinished(async () => { await servicesFiber.dispose() })

  let host!: Context
  await ctx.plugin(Object.assign((inner: Context) => { host = inner }, { inject: ['tools', 'systemPrompt'] }))

  const presetKey = { preset: 'dashr' }
  const preset = createScope(host, presetKey)
  onTestFinished(() => preset.dispose())
  const presentationFiber = await preset.ctx.plugin(Presentation, {})
  onTestFinished(async () => { await presentationFiber.dispose() })

  const events: { type: string, data: unknown }[] = []
  const agent = {
    id: SessionId('dashr-agent'),
    session: {
      header: { cwd: process.cwd() },
      append: (type: string, data: unknown) => { events.push({ type, data }) },
    },
  } as unknown as Agent
  const agentScope = createScope(preset.ctx, agent, { parent: presetKey })
  onTestFinished(() => agentScope.dispose())
  ;(agent as unknown as { ctx: Context }).ctx = agentScope.ctx

  const neighbor = { id: SessionId('ptc-agent') } as Agent
  const neighborScope = createScope(host, neighbor)
  onTestFinished(() => neighborScope.dispose())

  return {
    ctx,
    agent,
    events,
    agentCtx: agentScope.ctx,
    neighbor,
    startSession: () => {
      agentEvents(ctx, agent).emit('agent/session-start', { source: 'startup' })
    },
  }
}

/** Register one recording fake tool on the GLOBAL layer, the way host rows ship theirs. */
function registerGlobalFake(ctx: Context, name: string, execute?: (args: unknown, exec: unknown) => unknown): void {
  ctx.tools.register(defineTool({
    name,
    description: `Fake ${name} (surface spec).`,
    parameters: { placeholder: { type: 'string', description: 'Ignored placeholder.' } },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, exec) => Promise.resolve(execute ? execute(args, exec) : { ok: name }) as Promise<never>,
  }))
}

/** Dispatch one model-direct tool call through the registry pipeline. */
async function modelDirect(surface: Surface, name: string, args: unknown): Promise<ToolExecutionResult> {
  return await surface.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: toolCallId('call-direct'),
    name,
    arguments: args,
    agent: surface.agent,
  })
}

/** Run one cell through the FakeCellRuntime and capture the binding functions the bridge installed. */
async function captureBindings(surface: Surface): Promise<Record<string, (args: unknown) => Promise<unknown>>> {
  const runtime = surface.ctx.get('replRuntime') as FakeCellRuntime
  let functions: Record<string, (args: unknown) => Promise<unknown>> | undefined
  runtime.behavior = async (request) => {
    functions = { ...request.bindings[0]?.functions }
    return { logs: [] }
  }
  const result = await runCell(surface.ctx, 'program', { agent: surface.agent })
  expect(result.isError, `cell failed: ${JSON.stringify(result.content)}`).toBe(false)
  if (functions === undefined) throw new Error('bindings were not captured')
  return functions
}

describe('wire mask — session-start restrict over the real layer chain', () => {
  it('removes every registered masked name from schemas, lookup, by-name dispatch, and the catalog — and nothing else', async () => {
    const surface = await setupSurface()
    const masked = [...MASKED_TOOL_NAMES]
    for (const name of masked) registerGlobalFake(surface.ctx, name)
    registerGlobalFake(surface.ctx, 'keep_me')
    surface.startSession()

    const visible = surface.ctx.tools.schemas(surface.agent).map(schema => schema.name)
    for (const name of masked) expect(visible, `${name} should be masked`).not.toContain(name)
    expect(visible).toContain('keep_me')
    // The URL wrappers registered on the agent's own layer join the surface.
    expect(visible).toContain('read')

    // Lookup and by-name dispatch agree (five-sided disappearance).
    expect(surface.ctx.tools.get('skill', surface.agent)).toBeUndefined()
    const dispatched = await modelDirect(surface, 'skill', { placeholder: 'x' })
    expect(dispatched.isError).toBe(true)
    expect(dispatched.error?.info?.code).toBe('UNKNOWN_TOOL')

    // The catalog section regenerates from the post-mask projection: the
    // visible tool renders, the masked names do not.
    const assembly = await surface.ctx.systemPrompt.assemble({ scope: surface.agent })
    const catalog = String(assembly.sections.find(section => section.name === 'dashr:tool-catalog')?.text)
    expect(catalog).toContain('tool.keep_me(')
    expect(catalog).not.toContain('tool.skill(')
    expect(catalog).not.toContain('tool.subagent(')
  })

  it('skips masked names the host never registered (restrict may only name inherited tools)', async () => {
    const surface = await setupSurface()
    registerGlobalFake(surface.ctx, 'skill')
    registerGlobalFake(surface.ctx, 'keep_me')
    // send_message & co. stay unregistered: the wiring must filter them out
    // rather than let the batch restrict throw and drop the whole mask.
    surface.startSession()
    const visible = surface.ctx.tools.schemas(surface.agent).map(schema => schema.name)
    expect(visible).not.toContain('skill')
    expect(visible).toContain('keep_me')
  })

  it('leaves own-layer registrations exempt (the child-scoped native report shape) and still masks the inherited names', async () => {
    const surface = await setupSurface()
    registerGlobalFake(surface.ctx, 'skill')
    registerGlobalFake(surface.ctx, 'subagent')
    // The production continuable-child shape: `report` is registered on the
    // child's OWN layer before session-start — restriction-exempt by
    // construction, so the mask must skip it, not throw.
    surface.agentCtx.tools.register(defineTool({
      name: 'report',
      description: 'Fake own-layer report (surface spec).',
      parameters: { output: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: args => Promise.resolve(`reported:${String((args as { output: string }).output)}`),
    }))
    surface.startSession()
    const visible = surface.ctx.tools.schemas(surface.agent).map(schema => schema.name)
    expect(visible).not.toContain('skill')
    // v0.2.1b: `subagent` is deliberately NOT in the mask list (annotated as
    // an alias of `agent` in the control prompt), so a global subagent stays
    // visible; only the eight masked names are restricted.
    expect(visible).toContain('subagent')
    expect(visible).toContain('report')
    // The own-layer exemption held through capture too: the definition is in
    // the pre-mask snapshot for the bridge to use.
    expect(getCapturedTools(surface.agent)?.get('report')).toBeDefined()
  })

  it('masks only the started agent — a neighbor scope keeps the inherited names', async () => {
    const surface = await setupSurface()
    registerGlobalFake(surface.ctx, 'skill')
    surface.startSession()
    // The neighbor agent (no presentation row, never started) still sees
    // the global tool: the restriction lives on the started agent's own
    // layer, never on the registry or the global layer.
    expect(surface.ctx.tools.schemas(surface.neighbor).map(schema => schema.name)).toContain('skill')
    expect(surface.ctx.tools.schemas(surface.agent).map(schema => schema.name)).not.toContain('skill')
  })
})

describe('session-start capture — before wrappers, before the mask', () => {
  it('holds the masked definitions while the registry hides them', async () => {
    const surface = await setupSurface()
    registerGlobalFake(surface.ctx, 'skill')
    registerGlobalFake(surface.ctx, 'send_message')
    surface.startSession()
    expect(surface.ctx.tools.get('skill', surface.agent)).toBeUndefined()
    expect(getCapturedTools(surface.agent)?.get('skill')).toBeDefined()
    expect(getCapturedTools(surface.agent)?.get('send_message')).toBeDefined()
  })

  it('captures the native write before the wrapper shadows it (capture-before-register held)', async () => {
    const surface = await setupSurface()
    const nativeWrite = defineTool({
      name: 'write',
      description: 'Native write (surface spec).',
      parameters: { path: { type: 'string', required: true } },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      execute: () => Promise.resolve('native-write'),
    })
    surface.ctx.tools.register(nativeWrite)
    surface.startSession()
    // The registry resolves the agent's own-layer wrapper (shadowing)…
    const resolved = surface.ctx.tools.get('write', surface.agent)
    expect(resolved).toBeDefined()
    expect(resolved).not.toBe(nativeWrite)
    // …while the snapshot holds the native definition the wrapper delegates to.
    expect(getCapturedTools(surface.agent)?.get('write')).toBe(nativeWrite)
  })
})

describe('REPL bindings — single-state auto-map over the post-mask projection', () => {
  it('binds every flat visible tool, no masked name, and skips non-flat names', async () => {
    const surface = await setupSurface()
    registerGlobalFake(surface.ctx, 'skill')
    registerGlobalFake(surface.ctx, 'subagent')
    registerGlobalFake(surface.ctx, 'plain_tool')
    registerGlobalFake(surface.ctx, 'hyphen-tool')
    surface.startSession()
    const functions = await captureBindings(surface)
    const names = Object.keys(functions)
    expect(names).toContain('plain_tool')
    // The own-layer URL wrappers are bound like any visible tool.
    expect(names).toContain('read')
    // The three delegation bridges survive masking as flat visible tools.
    expect(names).toContain('agent')
    expect(names).toContain('agent_message')
    expect(names).toContain('agent_workflow')
    for (const masked of MASKED_TOOL_NAMES) {
      expect(names, `${masked} must not be bound`).not.toContain(masked)
    }
    // Non-flat names (the MCP hyphen shape) cannot be members.
    expect(names).not.toContain('hyphen-tool')
  })

  it('a host tool registered after session-start joins the next cell with zero wiring', async () => {
    const surface = await setupSurface()
    surface.startSession()
    registerGlobalFake(surface.ctx, 'late_tool')
    const functions = await captureBindings(surface)
    expect(Object.keys(functions)).toContain('late_tool')
  })
})


describe('bridge instructions — the repositioned catalog render (design D4/D5)', () => {
  /** A visible-tool fixture set: nested args, string enums, optional keys, a non-flat name. */
  const schemas: DASHRSdkSchema[] = [
    {
      name: 'echo',
      description: 'Echo a value.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' }, tag: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      output: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
    },
    {
      name: 'agent_message',
      description: 'The A2A bridge.',
      parameters: {
        type: 'object',
        properties: {
          receiver: { type: 'string', enum: ['child', 'parent', 'interrupt'] },
          message: { type: 'string' },
          subagent_id: { type: 'string' },
          target_session_id: { type: 'string' },
        },
        required: ['receiver', 'message'],
        additionalProperties: false,
      },
      output: { type: 'object', properties: {}, additionalProperties: true },
    },
    {
      name: 'hyphen-tool',
      description: 'A non-flat MCP name.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: {}, additionalProperties: false },
    },
  ]

  it('defaults to the compact-signatures mode and renders deterministically', () => {
    expect(REPL_BRIDGE_CATALOG_MODE).toBe('signatures')
    const text = renderReplBridgeInstructions(schemas)
    expect(renderReplBridgeInstructions([...schemas].reverse())).toBe(text)
  })

  it("mode 'signatures': one compact line per flat tool with the output contract kept", () => {
    const text = renderReplBridgeInstructions(schemas)
    expect(text).toContain('## Calling tools from the scripting pad')
    // Required vs optional keys, string enums, and the output shape inline.
    expect(text).toContain("tool.agent_message(args: {'receiver': 'child' | 'parent' | 'interrupt', 'message': str, 'subagent_id'?: str, 'target_session_id'?: str}) -> dict")
    // Lexicographic emission; the non-flat name gets NO declaration line
    // (the exception sentence covers it), and no TypedDict classes remain.
    expect(text.indexOf('tool.agent_message(')).toBeLessThan(text.indexOf('tool.echo('))
    expect(text).not.toContain('tool.hyphen-tool(')
    expect(text).not.toContain('class ')
    expect(text).not.toContain('TypedDict')
  })

  it('abbreviates structure deeper than two levels', () => {
    const text = renderReplBridgeInstructions([{
      name: 'deep',
      description: 'Deep nesting.',
      parameters: {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                properties: { leaf: { type: 'string' } },
                required: ['leaf'],
                additionalProperties: false,
              },
            },
            required: ['inner'],
            additionalProperties: false,
          },
        },
        required: ['outer'],
        additionalProperties: false,
      },
      output: { type: 'object', properties: {}, additionalProperties: false },
    }])
    // Depth semantics mirror omp's tsType cap: root, child, and grandchild
    // render (depth 0–2); a value three levels deep degrades to `Any` —
    // here `leaf`, the great-grandchild.
    expect(text).toContain("tool.deep(args: {'outer': {'inner': {'leaf': Any}}}) -> dict")
  })

  it("mode 'convention': the one-sentence convention alone, no declaration block", () => {
    const text = renderReplBridgeInstructions(schemas, 'convention')
    expect(text).toContain('## Calling tools from the scripting pad')
    expect(text).toContain('await tool.<name>(args)')
    expect(text).toContain('ToolCallError')
    expect(text).toContain('not plain identifiers')
    expect(text).toContain('live callable surface')
    expect(text).not.toContain('```python')
    expect(text).not.toContain('tool.echo(')
  })

  it('never uses the word "kernel" in either mode (design D5 wording)', () => {
    for (const mode of ['signatures', 'convention'] as const) {
      expect(renderReplBridgeInstructions(schemas, mode).toLowerCase()).not.toContain('kernel')
    }
  })
})
