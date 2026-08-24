import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FakeCellRuntime, fakeRuntime, registerFakeDelegationTools, runCell, setupPresentation } from './helpers.ts'
import { resolveMaxParallelSubCalls } from '../src/index.ts'

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
    callId: CallId('call-direct'),
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
    expect(assembly.tools.map(tool => tool.name)).toEqual(['echo', 'eval'])
    const catalog = assembly.sections.find(section => section.name === 'dashr:tool-catalog')
    expect(catalog).toBeDefined()
    expect(catalog?.text).toContain('## Writing cells for eval')
    // FLAT shape: the tool is a top-level function, no Tools protocol, no
    // tools singleton — and the bridge tools render in the same section.
    expect(catalog?.text).toContain('tool.echo(args: EchoArgs) -> str')
    expect(catalog?.text).not.toContain('class Tools(Protocol)')
    expect(catalog?.text).not.toContain('tools: Tools')
    expect(catalog?.text).toContain('tool.send_message(')
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
    // The masked report uplink is never taught: send_message('parent', ...)
    // is the single child->parent channel, and a root has no parent.
    expect(text).not.toContain('await report(')
    expect(text).not.toContain('report tool')
    // The catalog renders the bridge tools as ordinary async-def
    // declarations — one flat surface, no separate bridge-tools block.
    // v0.1.8b: the removed refine/compact bridges are GONE from the catalog;
    // send_message is the only remaining bridge tool.
    const catalog = String(assembly.sections.find(section => section.name === 'dashr:tool-catalog')?.text)
    expect(catalog).not.toContain('tool.refine(')
    expect(catalog).not.toContain('tool.compact(')
    expect(catalog).toContain('tool.send_message(')
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
    expect(ctx.tools.schemas(agent.agent).map(tool => tool.name).sort()).toEqual(['echo', 'eval'])
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

  it('the Tool Catalog masks only the A2A names (send_message/report) and renames glob to file_glob', async () => {
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
    ctx.tools.register(defineTool({
      name: 'glob',
      description: 'Glob files by pattern.',
      parameters: { pattern: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: args => Promise.resolve(`globbed:${String((args as { pattern: string }).pattern)}`),
    }))
    const assembly = await ctx.systemPrompt.assemble({ scope: agent.agent })
    const catalog = String(assembly.sections.find(section => section.name === 'dashr:tool-catalog')?.text)
    // Masking (ADR-0002): exactly the two A2A names disappear as callable
    // declarations — while staying registered and executable (send_message
    // dispatches them; rlm.spec covers that half). Every OTHER delegation
    // tool is exposed directly as a native `tool.*` member.
    for (const masked of ['send_message', 'report']) {
      expect(catalog).not.toContain(`async def ${masked}(`)
    }
    for (const exposed of ['subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'workflow', 'ralph']) {
      expect(catalog).toContain(`tool.${exposed}(`)
    }
    // The one rename: file_glob in, glob out — with the stdlib-shadow note.
    expect(catalog).toContain('tool.glob(args: GlobArgs) -> str')
    expect(catalog).not.toContain('tool.file_glob(')
    expect(catalog).toContain('tool.glob')
    // The registry itself is untouched: every masked name is still there.
    const registered = ctx.tools.schemas(agent.agent).map(schema => schema.name)
    expect(registered.filter(name => ['subagent', 'subagent_fork', 'send_message', 'list_agents', 'interrupt_agent', 'workflow', 'ralph', 'report', 'glob'].includes(name)).sort())
      .toEqual(['glob', 'interrupt_agent', 'list_agents', 'ralph', 'report', 'send_message', 'subagent', 'subagent_fork', 'workflow'])
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
