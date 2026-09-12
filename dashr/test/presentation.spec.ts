import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toolCallId } from '../src/tool-call-id.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readFileSync } from 'node:fs'
import { FakeCellRuntime, fakeRuntime, registerFakeDelegationTools, runCell, setupPresentation } from './helpers.ts'
import { ESCALATION_GUIDANCE_ORDER, MASKED_TOOL_NAMES, resolveMaxParallelSubCalls } from '../src/index.ts'

/** Register a trivial echo tool; returns the calls it received. */
function registerEcho(ctx: Context, name = 'echo'): unknown[] {
  const calls: unknown[] = []
  ctx.tools.register(defineTool({
    name,
    description: `Echo tool ${name}.`,
    parameters: { value: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args) {
      calls.push(args)
      return Promise.resolve(`${name}:${String((args as { value: string }).value)}`)
    },
  }))
  return calls
}

/** Dispatch one model-direct tool call (no parent token) through the registry. */
async function modelDirect(ctx: Context, name: string, agent: Agent, arguments_: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: toolCallId('call-direct'),
    name,
    arguments: arguments_,
    agent,
  })
}

describe('assembly — the DASHR row collapses its scope, and only its scope', () => {
  it('a preset-scope mount leaves eval the only contributed tool and ships NO DASHR prompt sections', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['agent', 'agent_message', 'agent_workflow', 'echo', 'eval', 'llm_completion'])
    // The wire tools array is the only tool catalog; the eval description is
    // the only REPL guidance. No DASHR-rendered prompt section exists at all.
    expect(assembly.sections.some(section => section.name.startsWith('dashr:'))).toBe(false)
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    expect(String(evalTool?.description)).toContain('## Calling tools from a cell')
  })

  it('carries ALL REPL guidance in the eval description (cell paradigm, decision rule, alias note)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    const text = String(evalTool?.description)
    // The decision rule and the flat-binding paradigm, taught once.
    expect(text).toContain('Payload-shaped work')
    expect(text).toContain('Logic-shaped work')
    expect(text).toContain('## Calling tools from a cell')
    // Flat everywhere: no namespaced promise survives into the prose.
    expect(text).not.toContain('await tools.')
    // The renamed-file glob and the bridge tools get flat guidance.
    expect(text).toContain('tool.glob')
    // The masked report uplink is never taught: agent_message('parent', ...)
    // is the single child->parent channel, and a root has no parent.
    expect(text).not.toContain('await report(')
    expect(text).not.toContain('report tool')
    // No prompt section re-teaches any of it (single source).
    for (const section of assembly.sections) {
      expect(String(section.text)).not.toContain('TWO ways to act')
      expect(String(section.text)).not.toContain('## Calling tools from a cell')
    }
  })
  it('a neighbor scope WITHOUT the row keeps its full native schema set (PTC coexistence, part one)', async () => {
    const { ctx, agent, other } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const neighbor = await ctx.systemPrompt.assemble({ scope: other.agent })
    expect(neighbor.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(neighbor.sections.some(section => section.name === 'dashr:tool-catalog')).toBe(false)
    // And the joining agent's own view of the registry still names every
    // tool — the collapse lives in the assembly, not in dispatch visibility.
    expect(ctx.tools.schemas(other.agent).map(tool => tool.name)).toEqual(['echo'])
    expect(ctx.tools.schemas(agent.agent).map(tool => tool.name).sort()).toEqual(['agent', 'agent_message', 'agent_workflow', 'echo', 'eval', 'llm_completion'])
  })

  it('a global assembly (no scope) is untouched by the preset-scope row', async () => {
    const { ctx } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(assembly.sections.some(section => section.name === 'dashr:tool-catalog')).toBe(false)
  })

  it('the eval description is scope-independent: restricting a tool never changes it', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    ctx.tools.register(defineTool({
      name: 'secret',
      description: 'Scoped-only tool.',
      parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: args => Promise.resolve(`secret:${String((args as { value: string }).value)}`),
    }))
    const before = String((await ctx.systemPrompt.assemble({ scope: agent.agent })).tools.find(tool => tool.name === 'eval')?.description)
    // The joined agent restricts the GLOBAL `secret` tool away for itself.
    agent.scope.ctx.tools.restrict({ deny: ['secret'] })
    const after = String((await ctx.systemPrompt.assemble({ scope: agent.agent })).tools.find(tool => tool.name === 'eval')?.description)
    // The description is a constant Markdown load — no per-tool enumeration,
    // so the calling scope's visible tool set cannot leak into it.
    expect(after).toBe(before)
    expect(after).not.toContain('secret')
  })

  it('the eval description enumerates no per-tool signatures — no double filter (masking is session-start restrict, covered by surface.spec)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    registerFakeDelegationTools(ctx)
    ctx.tools.register(defineTool({
      name: 'report',
      description: 'Fake child-scoped report tool (test registry).',
      parameters: { output: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: args => Promise.resolve(`reported:${String((args as { output: string }).output)}`),
    }))
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const description = String(assembly.tools.find(tool => tool.name === 'eval')?.description)
    // No per-tool signature lines at all — registered, masked, or bridged.
    for (const name of ['send_message', 'report', 'subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'workflow', 'ralph', 'echo']) {
      expect(description).not.toContain(`tool.${name}(`)
    }
    // The registry itself is untouched: every registered name is still there.
    const registered = ctx.tools.schemas(agent.agent).map(schema => schema.name)
    expect(registered.filter(name => ['subagent', 'subagent_fork', 'send_message', 'list_agents', 'interrupt_agent', 'workflow', 'ralph', 'report'].includes(name)).sort())
      .toEqual(['interrupt_agent', 'list_agents', 'ralph', 'report', 'send_message', 'subagent', 'subagent_fork', 'workflow'])
  })
})

describe('no model-direct collapse guard', () => {
  it('lets any tool be called model-direct (no collapse guard)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = registerEcho(ctx)
    const result = await modelDirect(ctx, 'echo', agent.agent, { value: 'x' })
    expect(result.isError).toBe(false)
    expect(calls).toEqual([{ value: 'x' }])
  })

  it('lets the neighbor agent call the same tool model-direct (the guard is scoped)', async () => {
    const { ctx, other } = await setupPresentation(fakeRuntime)
    const calls = registerEcho(ctx)
    const result = await modelDirect(ctx, 'echo', other.agent, { value: 'ptc' })
    expect(result.isError).toBe(false)
    expect(calls).toEqual([{ value: 'ptc' }])
  })

  it('passes eval itself model-direct, and nested sub-dispatches (parent token) through the bridge', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = registerEcho(ctx)
    const runtime = ctx.replRuntime as FakeCellRuntime
    runtime.behavior = async request => {
      const tool = request.bindings.find(binding => binding.global === 'tool')!
      const value = await tool.functions['echo']!({ value: 'nested' })
      return { logs: [], value: String(value) }
    }
    const result = await runCell(ctx, 'await tool.echo({ "value": "nested" })', { agent: agent.agent })
    expect(result.isError).toBe(false)
    expect(calls).toEqual([{ value: 'nested' }])
  })
})

describe('config', () => {
  it('resolves the max-parallel cap with the same validation as upstream', () => {
    expect(resolveMaxParallelSubCalls(undefined)).toBe(10)
    expect(resolveMaxParallelSubCalls(1)).toBe(1)
    expect(() => resolveMaxParallelSubCalls(0)).toThrow('dashr-repl: maxParallelSubCalls must be a positive integer')
    expect(() => resolveMaxParallelSubCalls(1.5)).toThrow('dashr-repl: maxParallelSubCalls must be a positive integer')
  })

  it('mounts against a composition with no replRuntime by staying pending, not crashing the registry', async () => {
    // The wait is declared, not a static inject: a runtime-less deployment
    // simply never activates the row's registrations.
    const { ctx, other } = await setupPresentation(false)
    registerEcho(ctx)
    const neighbor = await ctx.systemPrompt.assemble({ scope: other.agent })
    expect(neighbor.tools.map(tool => tool.name)).toEqual(['echo'])
    expect(ctx.tools.schemas(undefined).map(tool => tool.name)).toEqual(['echo'])
  })
})

describe('v0.2.1b — model-surface contracts (eval description, mask list, escalation guidance)', () => {
  /** Mount a fake host-plane `sandboxPolicy` service answering a fixed mode. */
  async function fakeSandboxPolicy(mode: string) {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await ctx.plugin({ name: 'fake-sandbox-policy', apply(c) {
      c.provide('sandboxPolicy', {
        resolve: () => ({ mode, workspaceRoot: '/tmp/fake-workspace' }),
      })
    } })
    return { ctx, agent }
  }

  it('eval description promises only what the kernel does (top-level return is a SyntaxError)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    expect(evalTool?.description).toContain('Top-level `await` works')
    expect(evalTool?.description).toContain('top-level `return` is a SyntaxError')
    expect(evalTool?.description).not.toContain('top-level `await` and `return` work')
    // No control-prompt section exists to restate it (single source).
    expect(assembly.sections.some(section => section.name === 'dashr:control-prompt')).toBe(false)
  })

  it('eval description states the non-flat exception and the subagent alias', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    const text = String(evalTool?.description)
    expect(text).toContain('not plain identifiers')
    expect(text).toContain('`subagent` is its native alias')
  })

  it('non-flat wording names non-identifier characters, not __ infixes', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    expect(evalTool?.description).toContain('not plain identifiers')
    expect(evalTool?.description).not.toContain('`__` infixes')
  })

  it('eval description equals the packaged markdown, and its example keys exist on the referenced tools\' wire schemas', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    // The real wire parameter names of the tools the description exemplifies.
    const wireParams: Record<string, string[]> = {
      read: ['path', 'offset', 'limit'],
      bash: ['command', 'description', 'timeoutMs', 'workdir', 'run_in_background', 'sandbox_permissions', 'justification'],
      grep: ['pattern', 'path', 'include'],
      glob: ['pattern', 'path'],
    }
    for (const [name, properties] of Object.entries(wireParams)) {
      ctx.tools.register(defineTool({
        name,
        description: `Fake ${name} (wire-shape fixture).`,
        parameters: Object.fromEntries(properties.map(key => [key, { type: 'string' }])),
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: () => Promise.resolve('ok'),
      }))
    }
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const evalTool = assembly.tools.find(tool => tool.name === 'eval')
    const description = String(evalTool?.description)
    // Byte fidelity with the packaged user-editable markdown.
    const packaged = readFileSync(new URL('../eval-description.md', import.meta.url), 'utf8')
    expect(description).toBe(packaged)
    // D1-drift guard: every quoted key the description writes must exist on
    // some referenced tool's wire schema (or eval's own parameters).
    const allowed = new Set([...Object.values(wireParams).flat(), 'cell', 'description', 'timeout', 'reset'])
    for (const match of description.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)":/g)) {
      expect(allowed.has(match[1]!)).toBe(true)
    }
  })

  it('mask list keeps the seven masked names and excludes subagent (alias) and skill (2026-09-12 unmask)', () => {
    const masked = [...MASKED_TOOL_NAMES]
    expect(masked).not.toContain('subagent')
    expect(masked).not.toContain('skill')
    for (const name of ['send_message', 'report', 'list_agents', 'subagent_fork', 'interrupt_agent', 'workflow', 'ralph']) {
      expect(masked).toContain(name)
    }
  })

  it('escalation guidance sits at order 116 in the runtime-context band', () => {
    expect(ESCALATION_GUIDANCE_ORDER).toBe(116)
  })

  it('escalation guidance injects under workspace-write', async () => {
    const { ctx, agent } = await fakeSandboxPolicy('workspace-write')
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent, agent: agent.agent })
    const guidance = assembly.contexts.find(context => context.name === 'dashr:escalation-guidance')
    expect(guidance).toBeDefined()
    expect(guidance?.text).toContain('A sandbox-deniable/denied call may be escalated with `sandbox_permissions="danger-full-access"`')
    expect(guidance?.text).not.toContain('retried once')
    expect(guidance?.text).toContain('approval/denial are per-call')
  })

  it('escalation guidance renders empty under read-only and danger-full-access', async () => {
    for (const mode of ['read-only', 'danger-full-access']) {
      const { ctx, agent } = await fakeSandboxPolicy(mode)
      const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent, agent: agent.agent })
      const guidance = assembly.contexts.find(context => context.name === 'dashr:escalation-guidance')
      expect(guidance?.text).toBe('')
    }
  })

  it('escalation guidance fails closed without a sandboxPolicy service', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent, agent: agent.agent })
    const guidance = assembly.contexts.find(context => context.name === 'dashr:escalation-guidance')
    expect(guidance?.text).toBe('')
  })
})
