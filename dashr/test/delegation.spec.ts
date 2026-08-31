import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FakeCellRuntime, fakeRuntime, fakeSubagentsService, registerFakeDelegationTools, runCell, setupPresentation, setupKernel } from './helpers.ts'

/**
 * Native delegation + the delegation bridges (Wave5).
 *
 * The upstream delegation tools (`subagent`, `subagent_fork`, `list_agents`,
 * `interrupt_agent`, `workflow`, `ralph`) are dispatched directly as `tool.*`
 * members when the registry mask has NOT landed (this harness never fires
 * `agent/session-start`), through the same nested sub-dispatch pipeline. The
 * displaced A2A bridge is now named `agent_message` (Wave5 renamed it from
 * `send_message`): receiver 'child' → `ctx.subagents.followup`, 'parent' →
 * `ctx.subagents.reportFrom`, and 'interrupt' → `ctx.subagents.interrupt`.
 * The sibling `agent` and `agent_workflow` bridges are covered by
 * `test/surface-devices/bridges.spec.ts`.
 */

import type { ReplJsonValue } from '../src/runtime-surface.ts'

/** One bare callable binding function of a run request (the {args, kwargs} packaging). */
type Callable = (args: unknown) => Promise<ReplJsonValue>

/** Resolve one bare callable from a fake run request by its global name. */
function callableOf(request: { bindings: { global: string, functions: Record<string, (args: unknown) => Promise<ReplJsonValue>> }[] }, global: string): Callable {
  const found = request.bindings.find(binding => binding.global === 'tool')
  if (!found) throw new Error(`no binding global ${JSON.stringify(global)}; have ${request.bindings.map(b => b.global).join(', ')}`)
  const fn = found.functions[global]
  if (!fn) throw new Error(`binding global ${JSON.stringify(global)} has no __call__`)
  return fn
}

/** Drive one `eval` through the registry pipeline and return its value. */
async function cell(ctx: Context, agent: Agent, code: string): Promise<{ value: { logs: string[], result?: unknown } }> {
  const result = await runCell(ctx, code, { agent })
  expect(result.isError, `cell failed: ${JSON.stringify(result.content)}`).toBe(false)
  return { value: result.value as { logs: string[], result?: unknown } }
}

describe('native delegation tools exposed directly as tool.* members', () => {
  it('tool.subagent(...) dispatches the subagent tool with a parent token, JSON output unchanged', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = registerFakeDelegationTools(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'subagent')({ description: 'worker', prompt: 'do the thing' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    // The tool's own JSON output, unchanged (信息量不减).
    expect(result.value.result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(calls).toEqual([{ tool: 'subagent', args: { description: 'worker', prompt: 'do the thing' }, parented: true }])
  })

  it('the other delegation tools dispatch verbatim through the same pipeline', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = registerFakeDelegationTools(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const fork = await callableOf(request, 'subagent_fork')({ description: 'twin', prompt: 'fork me' })
      const interrupt = await callableOf(request, 'interrupt_agent')({ agent_id: 'agent-7' })
      const list = await callableOf(request, 'list_agents')({ scope: 'descendants' })
      const workflow = await callableOf(request, 'workflow')({ meta: { name: 'audit' }, script: 'return 1' })
      const ralph = await callableOf(request, 'ralph')({ objective: 'finish the migration' })
      return { logs: [], value: { fork, interrupt, list, workflow, ralph } }
    }
    await cell(ctx, agent.agent, 'program')
    expect(calls).toEqual([
      { tool: 'subagent_fork', args: { description: 'twin', prompt: 'fork me' }, parented: true },
      { tool: 'interrupt_agent', args: { agent_id: 'agent-7' }, parented: true },
      { tool: 'list_agents', args: { scope: 'descendants' }, parented: true },
      { tool: 'workflow', args: { meta: { name: 'audit' }, script: 'return 1' }, parented: true },
      { tool: 'ralph', args: { objective: 'finish the migration' }, parented: true },
    ])
  })

  it('a failed dispatch rejects the binding (ToolCallError at the kernel), carrying the tool error', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerFakeDelegationTools(ctx, { subagent: () => { throw new Error('depth limit exceeded') } })
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      try {
        await callableOf(request, 'subagent')({ description: 'subagent', prompt: 'p' })
        return { logs: [], value: 'unreachable' }
      } catch (error: unknown) {
        return { logs: [], value: `caught: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toBe('caught: depth limit exceeded')
  })

  it('logs code-dispatch audit events for a directly-called delegation tool (nested sub-dispatch pipeline)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerFakeDelegationTools(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      await callableOf(request, 'subagent')({ description: 'subagent', prompt: 'audited' })
      return { logs: [], value: 'done' }
    }
    await cell(ctx, agent.agent, 'program')
    const starts = agent.events.filter(event => event.type === 'tool/code-dispatch-start').map(event => (event.data as { name: string }).name)
    const settles = agent.events.filter(event => event.type === 'tool/code-dispatch').map(event => (event.data as { name: string }).name)
    expect(starts).toEqual(['subagent'])
    expect(settles).toEqual(['subagent'])
  })
})

describe('agent_message() — the A2A bridge', () => {
  it("receiver='child' follows up to the child through the service layer", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const followups: { childId: string, content: unknown[], source: { kind: string, form: string, senderSessionId: string } }[] = []
    await ctx.plugin({ name: 'fake-followup', apply(c) {
      c.provide('subagents', {
        followup: (_parent: unknown, childId: string, content: unknown[], options: { source: { kind: string, form: string, senderSessionId: string } }) => {
          followups.push({ childId, content, source: options.source })
          return Promise.resolve('mid-1')
        },
      })
    } })
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'child', message: 'here is more work', subagent_id: 'child-1' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ messageId: 'mid-1' })
    expect(followups).toHaveLength(1)
    expect(followups[0]!.childId).toBe('child-1')
    expect(followups[0]!.content).toEqual([{ type: 'text', text: 'here is more work' }])
    expect(followups[0]!.source.kind).toBe('coordinator')
  })

  it("receiver='child' without subagent_id is a structured error, calling nothing", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'child', message: 'hi' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('requires {"subagent_id"') })
  })

  it("receiver='parent' bridges the service layer: reportFrom with zero ids, next-step delivery", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const reports = await fakeSubagentsService(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'parent', message: 'task complete' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ delivered: true, message_id: 'mid-1' })
    expect(reports).toHaveLength(1)
    expect(reports[0]!.child).toBe(agent.agent)
    expect(reports[0]!.content).toEqual([{ type: 'text', text: 'task complete' }])
    expect(reports[0]!.delivery).toBe('next-step')
    expect(reports[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it("receiver='parent' surfaces a service UNAUTHORIZED rejection as a structured error value", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeSubagentsService(ctx, () => {
      const error = new Error('agent "dashr-agent" is not a live continuable subagent and cannot report') as Error & { code: string }
      error.code = 'UNAUTHORIZED'
      return Promise.reject(error)
    })
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'parent', message: 'root tries to report' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('only a live continuable child agent can report') })
  })

  it("receiver='parent' with no ctx.subagents service is a structured unavailable error", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'parent', message: 'hello?' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('no ctx.subagents service') })
  })

  it('unknown receivers and malformed signatures are structured errors', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const sendMessage = callableOf(request, 'agent_message')
      const sibling = await sendMessage({ receiver: 'sibling', message: 'm' })
      const oneArg = await sendMessage({ message: 'm' })
      const stray = await sendMessage({ receiver: 'child', message: 'm', urgent: true })
      return { logs: [], value: { sibling, oneArg, stray } }
    }
    const result = await cell(ctx, agent.agent, 'program')
    const errors = result.value.result as Record<string, { error: unknown }>
    expect(errors['sibling']).toEqual({ error: expect.stringContaining("expected 'child', 'parent', or 'interrupt'") })
    expect(errors['oneArg']).toEqual({ error: expect.stringContaining('requires {"receiver"') })
    expect(errors['stray']).toEqual({ error: expect.stringContaining('unexpected key(s): urgent') })
  })
})

describe('the tool.* binding surface', () => {
  it('binds native delegation tools and masks only the A2A names', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    registerFakeDelegationTools(ctx)
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    ctx.tools.register(defineTool({
      name: 'glob',
      description: 'Glob tool (test).',
      parameters: { pattern: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: () => Promise.resolve('globbed'),
    }))
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const globalsSeen = request.bindings.map(binding => binding.global)
      const toolMembers = Object.keys(request.bindings.find(binding => binding.global === 'tool')?.functions ?? {})
      const globbed = await callableOf(request, 'glob')({ pattern: '*.ts' })
      return { logs: [], value: { globalsSeen, toolMembers, globbed } }
    }
    const result = await cell(ctx, agent.agent, 'program')
    const { globalsSeen, toolMembers, globbed } = result.value.result as { globalsSeen: string[], toolMembers: string[], globbed: string }
    expect(globalsSeen).toContain('tool')
    expect(globalsSeen).not.toContain('file_glob')
    expect(globalsSeen).not.toContain('tools')
    // Native delegation tools are bound directly (the mask never landed in
    // this harness); the A2A uplink name is not.
    for (const exposed of ['subagent', 'subagent_fork', 'list_agents', 'interrupt_agent', 'workflow', 'ralph']) {
      expect(toolMembers).toContain(exposed)
    }
    expect(toolMembers).not.toContain('report')
    // The three delegation bridges are members beside the auto-mapped tools.
    for (const bridge of ['agent', 'agent_message', 'agent_workflow']) {
      expect(toolMembers).toContain(bridge)
    }
    expect(globbed).toBe('globbed')
  })
})

describe('native delegation end-to-end on a real kernel', () => {
  it('tool.subagent foreground call returns the tool result through the real kernel', async () => {
    const { ctx, agent } = await setupKernel()
    const calls = registerFakeDelegationTools(ctx, {
      subagent: () => ({ kind: 'foreground', runId: 'run-9', output: [{ type: 'text', text: 'child finished the work' }] }),
    })
    const result = await runCell(ctx, [
      "result = await tool.subagent({'description': 'subagent', 'prompt': 'do it synchronously'})",
      'result',
    ].join('\n'), { agent: agent.agent })
    expect(result.isError, `cell failed: ${JSON.stringify(result.content)}`).toBe(false)
    expect((result.value as { result: unknown }).result).toEqual({
      kind: 'foreground', runId: 'run-9', output: [{ type: 'text', text: 'child finished the work' }],
    })
    expect(calls).toEqual([{ tool: 'subagent', args: { description: 'subagent', prompt: 'do it synchronously' }, parented: true }])
  }, 60_000)
})
