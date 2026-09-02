import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { toolCallId } from '../src/tool-call-id.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
  it('a preset-scope mount leaves eval the only contributed tool and ships the Tool Catalog', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual(['agent', 'agent_message', 'agent_workflow', 'echo', 'eval', 'llm_completion'])
    const catalog = assembly.sections.find(section => section.name === 'dashr:tool-catalog')
    expect(catalog).toBeDefined()
    // v0.1.8e: the catalog is REPL bridge instructions for the scripting
    // pad — one compact signature line per tool, no kernel wording.
    expect(catalog?.text).toContain('## Calling tools from the scripting pad')
    expect(catalog?.text).not.toContain('kernel')
    // FLAT shape: the tool is a top-level function, no Tools protocol, no
    // tools singleton — and the bridge tools render in the same section.
    expect(catalog?.text).toContain('tool.echo(')
    expect(catalog?.text).not.toContain('class Tools(Protocol)')
    expect(catalog?.text).not.toContain('tools: Tools')
    expect(catalog?.text).toContain('tool.agent_message(')
    expect(catalog?.text).not.toContain('eval(')
  })

  it('ships the Control Prompt section BEFORE the Tool Catalog, teaching the single-entry contract and flat bindings', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const names = assembly.sections.map(section => section.name)
    const control = assembly.sections.find(section => section.name === 'dashr:control-prompt')
    expect(control).toBeDefined()
    expect(names.indexOf('dashr:control-prompt')).toBeGreaterThanOrEqual(0)
    expect(names.indexOf('dashr:control-prompt')).toBeLessThan(names.indexOf('dashr:tool-catalog'))
    const text = String(control?.text)
    // The guard contract, taught up front rather than learned by failing.
    expect(text).toContain('TWO ways to act')
    expect(text).toContain('Logic-shaped work')
    // Flat everywhere: no namespaced promise survives into the prose.
    expect(text).not.toContain('await tools.')
    expect(text).not.toContain('tools.')
    // The renamed file glob and the bridge tools get flat guidance.
    expect(text).toContain('tool.glob')
    // The masked report uplink is never taught: agent_message('parent', ...)
    // is the single child->parent channel, and a root has no parent.
    expect(text).not.toContain('await report(')
    expect(text).not.toContain('report tool')
    // The catalog renders the bridge tools as ordinary async-def
    // declarations — one flat surface, no separate bridge-tools block.
    // v0.1.8e: the three delegation bridges (agent / agent_message /
    // agent_workflow) replace the old single send_message bridge.
    const catalog = String(assembly.sections.find(section => section.name === 'dashr:tool-catalog')?.text)
    expect(catalog).not.toContain('tool.refine(')
    expect(catalog).not.toContain('tool.compact(')
    expect(catalog).toContain('tool.agent_message(')
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

  it('the SDK section regenerates from the calling scope: a restricted agent loses the tool from its SDK', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerEcho(ctx)
    ctx.tools.register(defineTool({
      name: 'secret',
      description: 'Scoped-only tool.',
      parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: args => Promise.resolve(`secret:${String((args as { value: string }).value)}`),
    }))
    // The joined agent restricts the GLOBAL `secret` tool away for itself.
    agent.scope.ctx.tools.restrict({ deny: ['secret'] })
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const catalog = assembly.sections.find(section => section.name === 'dashr:tool-catalog')
    expect(catalog?.text).toContain('tool.echo(')
    expect(catalog?.text).not.toContain('secret')
  })

  it('the catalog renderer applies no masking of its own — it renders every schema it is handed (masking is session-start restrict, covered by surface.spec)', async () => {
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
    const catalog = String(assembly.sections.find(section => section.name === 'dashr:tool-catalog')?.text)
    // The renderer is mask-agnostic: every registered flat name renders as a
    // one-line signature. Restriction (which removes the replaced-presentation
    // names from `schemas(agent)`) happens at agent/session-start and is the
    // surface.spec responsibility — this layer must not double-filter.
    for (const name of ['send_message', 'report', 'subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'workflow', 'ralph']) {
      expect(catalog).toContain(`tool.${name}(`)
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
    expect(evalTool?.description).toContain('top-level `await` works')
    expect(evalTool?.description).toContain('top-level `return` is a SyntaxError')
    expect(evalTool?.description).not.toContain('top-level `await` and `return` work')
    const control = assembly.sections.find(section => section.name === 'dashr:control-prompt')
    expect(control?.text).toContain('top-level `await` works')
    expect(control?.text).toContain('top-level `return` is a SyntaxError')
    expect(control?.text).not.toContain('top-level `await` and `return` work')
  })

  it('control prompt states the non-flat exception and the subagent alias', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const control = assembly.sections.find(section => section.name === 'dashr:control-prompt')
    expect(control?.text).toContain('Tool names that are not plain identifiers')
    expect(control?.text).toContain('`subagent` is its native alias')
  })

  it('catalog non-flat wording names non-identifier characters, not __ infixes', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const catalog = assembly.sections.find(section => section.name === 'dashr:tool-catalog')
    expect(catalog?.text).toContain('non-identifier characters')
    expect(catalog?.text).not.toContain('`__` infixes')
  })

  it('mask list keeps the eight masked names and excludes subagent (v0.2.1b alias)', () => {
    const masked = [...MASKED_TOOL_NAMES]
    expect(masked).not.toContain('subagent')
    for (const name of ['skill', 'send_message', 'report', 'list_agents', 'subagent_fork', 'interrupt_agent', 'workflow', 'ralph']) {
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
    expect(guidance?.text).toContain('Restricted operations may be retried once with sandbox_permissions')
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
