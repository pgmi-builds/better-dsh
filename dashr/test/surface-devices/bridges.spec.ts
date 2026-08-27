import { describe, expect, it, onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { FakeCellRuntime, fakeRuntime, runCell, setupPresentation } from '../helpers.ts'
import { captureAllTools } from '../../src/url-schema/native-capture.ts'
import type { ReplJsonValue } from '../../src/runtime-surface.ts'

/**
 * The three delegation bridges (Wave5): `agent` (spawn/fork), `agent_message`
 * (followup/report/interrupt), `agent_workflow` (workflow/ralph). `agent` and
 * `agent_message` are thin adapters over the host-plane `ctx.subagents`
 * service; `agent_workflow` passes through the CAPTURED native workflow/ralph
 * definitions (the workflowEngine service is entry-local to the preset's
 * delegation realm, invisible to any outside ctx). The tests route through a
 * fake service / fake captured tools and assert the EXACT passthrough —
 * request fields, provider selection, interrupt authority — plus the
 * structured-error contract and the three flat names in the REPL binding set.
 */

type Callable = (args: unknown) => Promise<ReplJsonValue>

/** One bare callable binding function of a run request (the {args, kwargs} packaging). */
function callableOf(request: { bindings: { global: string, functions: Record<string, Callable> }[] }, global: string): Callable {
  const found = request.bindings.find(binding => binding.global === 'tool')
  if (!found) throw new Error(`no binding global ${JSON.stringify(global)}; have ${request.bindings.map(b => b.global).join(', ')}`)
  const fn = found.functions[global]
  if (!fn) throw new Error(`binding global ${JSON.stringify(global)} has no member named ${global}`)
  return fn
}

/** Drive one `eval` through the registry pipeline and return its value. */
async function cell(ctx: Context, agent: Agent, code: string): Promise<{ value: { logs: string[], result?: unknown } }> {
  const result = await runCell(ctx, code, { agent })
  expect(result.isError, `cell failed: ${JSON.stringify(result.content)}`).toBe(false)
  return { value: result.value as { logs: string[], result?: unknown } }
}

/** Every delegation call the fake services recorded, in call order. */
interface DelegationCalls {
  starts: { provider: string, label: string, promptText: string, parent: Agent, maxDepth: number }[]
  continuableStarts: { provider: string, label: string, promptText: string, maxDepth: number }[]
  followups: { childId: string, message: string, sourceKind: string, senderId: string }[]
  interrupts: { targetId: string, authorityKind: string, authorityAgent: Agent }[]
  reports: { message: string }[]
  workflowStarts: { script: string, metaName: string, objective: unknown, subagentProvider: unknown, maxTotalAgents: unknown, args: unknown }[]
}

/**
 * Mount a fake root-realm `ctx.subagents` + `ctx.workflowEngine` pair that
 * records every delegation call and answers fixed defaults. The `stopReason`
 * override lets a test drive the foreground `agent` non-`completed` path.
 */
async function fakeDelegationServices(
  ctx: Context,
  overrides: { startStopReason?: string, reportFrom?: (call: { message: string }) => Promise<string> } = {},
): Promise<DelegationCalls> {
  const calls: DelegationCalls = { starts: [], continuableStarts: [], followups: [], interrupts: [], reports: [], workflowStarts: [] }
  const fiber = await ctx.plugin({ name: 'fake-delegation-services', apply(c) {
    c.provide('subagents', {
      start: (provider: string, request: { label: string, prompt: { text: string }[], parent: Agent, maxDepth: number, signal: AbortSignal }) => {
        calls.starts.push({ provider, label: request.label, promptText: request.prompt[0]!.text, parent: request.parent, maxDepth: request.maxDepth })
        return Promise.resolve({
          id: 'run-1',
          result: Promise.resolve({ output: [{ type: 'text', text: 'child finished' }], stopReason: overrides.startStopReason ?? 'completed' }),
          dispose: () => Promise.resolve(),
        })
      },
      startContinuable: (spec: { provider: string, label: string, request: { label: string, prompt: { text: string }[], maxDepth: number }, signal: AbortSignal }) => {
        calls.continuableStarts.push({ provider: spec.provider, label: spec.label, promptText: spec.request.prompt[0]!.text, maxDepth: spec.request.maxDepth })
        return Promise.resolve({ childId: 'child-1' })
      },
      followup: (parent: Agent, childId: string, content: { text: string }[], options: { source: { kind: string, senderSessionId: string } }) => {
        calls.followups.push({ childId, message: content[0]!.text, sourceKind: options.source.kind, senderId: options.source.senderSessionId })
        return Promise.resolve('msg-1')
      },
      interrupt: (targetSessionId: string, authority: { kind: string, agent: Agent }) => {
        calls.interrupts.push({ targetId: targetSessionId, authorityKind: authority.kind, authorityAgent: authority.agent })
      },
      reportFrom: (child: Agent, content: { text: string }[]) => {
        calls.reports.push({ message: content[0]!.text })
        return overrides.reportFrom !== undefined ? overrides.reportFrom({ message: content[0]!.text }) : Promise.resolve('mid-1')
      },
    })
    c.provide('workflowEngine', {
      start: (request: { script: string, meta: { name: string }, args?: { objective?: unknown }, subagentProvider?: unknown, maxTotalAgents?: unknown }) => {
        calls.workflowStarts.push({ script: request.script, metaName: request.meta.name, objective: request.args?.objective, subagentProvider: request.subagentProvider, maxTotalAgents: request.maxTotalAgents, args: request.args })
        return {
          id: 'wf-1',
          result: Promise.resolve({ value: { ok: true }, stopReason: 'completed', agentsStarted: 2 }),
          cancel: () => {},
          dispose: () => Promise.resolve(),
        }
      },
    })
  } })
  onTestFinished(() => fiber.dispose())
  return calls
}


describe('agent bridge — spawn/fork unified', () => {
  it("mode 'delegate' with run_in_background false starts a ONE-SHOT child on the spawn provider with the native request fields", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent')({ description: 'worker', prompt: 'do the thing', run_in_background: false })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ kind: 'foreground', runId: 'run-1', output: [{ type: 'text', text: 'child finished' }] })
    expect(calls.starts).toHaveLength(1)
    expect(calls.starts[0]!.provider).toBe('spawn')
    expect(calls.starts[0]!.label).toBe('worker')
    expect(calls.starts[0]!.promptText).toBe('do the thing')
    expect(calls.starts[0]!.parent).toBe(agent.agent)
    expect(calls.starts[0]!.maxDepth).toBe(3)
    expect(calls.continuableStarts).toHaveLength(0)
  })

  it('an omitted run_in_background defaults to the native continuable semantics: background, durable id, no one-shot start', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent')({ description: 'worker', prompt: 'default me' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(calls.continuableStarts).toHaveLength(1)
    expect(calls.starts).toHaveLength(0)
  })

  it("mode 'fork' starts the child on the fork provider", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent')({ description: 'twin', prompt: 'fork me', mode: 'fork', run_in_background: false })
      return { logs: [], value: result }
    }
    await cell(ctx, agent.agent, 'program')
    expect(calls.starts).toHaveLength(1)
    expect(calls.starts[0]!.provider).toBe('fork')
  })

  it('run_in_background true starts a continuable child and returns its durable id', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent')({ description: 'worker', prompt: 'background me', run_in_background: true })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ kind: 'continuable', subagentId: 'child-1' })
    expect(calls.continuableStarts).toHaveLength(1)
    expect(calls.continuableStarts[0]!.provider).toBe('spawn')
    expect(calls.continuableStarts[0]!.label).toBe('worker')
    expect(calls.continuableStarts[0]!.promptText).toBe('background me')
    expect(calls.starts).toHaveLength(0)
  })

  it('a non-completed child maps to a structured error', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeDelegationServices(ctx, { startStopReason: 'error' })
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent')({ description: 'worker', prompt: 'do the thing', run_in_background: false })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('subagent run failed') })
  })
})

describe('agent_message bridge — followup / report / interrupt', () => {
  it("receiver='child' follows up through the service layer with the coordinator source", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'child', message: 'more work', subagent_id: 'child-9' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ messageId: 'msg-1' })
    expect(calls.followups).toHaveLength(1)
    expect(calls.followups[0]!.childId).toBe('child-9')
    expect(calls.followups[0]!.message).toBe('more work')
    expect(calls.followups[0]!.sourceKind).toBe('coordinator')
    expect(calls.followups[0]!.senderId).toBe(agent.agent.id)
  })

  it("receiver='parent' reports up through reportFrom", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'parent', message: 'task complete' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ delivered: true, message_id: 'mid-1' })
    expect(calls.reports).toHaveLength(1)
    expect(calls.reports[0]!.message).toBe('task complete')
  })

  it("receiver='interrupt' passes the ancestor authority (the exact live caller)", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'interrupt', target_session_id: 'agent-7' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ accepted: true })
    expect(calls.interrupts).toHaveLength(1)
    expect(calls.interrupts[0]!.targetId).toBe('agent-7')
    expect(calls.interrupts[0]!.authorityKind).toBe('ancestor')
    expect(calls.interrupts[0]!.authorityAgent).toBe(agent.agent)
  })
})

describe('agent_workflow bridge — engine via serviceForAgent addressing', () => {
  it("mode 'script' passes script/meta/args through to workflowEngine.start", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_workflow')({ mode: 'script', script: 'return 1', meta: { name: 'audit', description: 'Audit the repo' }, args: { files: ['a'] } })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ runId: 'wf-1', agentsStarted: 2, result: { ok: true } })
    expect(calls.workflowStarts).toHaveLength(1)
    expect(calls.workflowStarts[0]!.script).toBe('return 1')
    expect(calls.workflowStarts[0]!.metaName).toBe('audit')
    expect(calls.workflowStarts[0]!.args).toEqual({ files: ['a'] })
  })

  it("mode 'rfc' routes the fixed Ralph loop with the objective and defaults", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const calls = await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_workflow')({ mode: 'rfc', objective: 'finish the migration' })
      return { logs: [], value: result }
    }
    await cell(ctx, agent.agent, 'program')
    expect(calls.workflowStarts).toHaveLength(1)
    const start = calls.workflowStarts[0]!
    expect(start.metaName).toBe('ralph-loop')
    expect(start.objective).toBe('finish the migration')
    expect(start.subagentProvider).toBe('spawn')
    expect(start.maxTotalAgents).toBe(256)
    expect(start.script).toContain('Ralph round: ')
  })

  it('answers a structured unavailable when no engine is resolvable for the agent', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    // The services plugin provides subagents but deliberately NO workflowEngine.
    const fiber = await ctx.plugin({ name: 'fake-no-engine', apply() {} })
    onTestFinished(() => fiber.dispose())
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const script = await callableOf(request, 'agent_workflow')({ mode: 'script', script: 'return 1', meta: { name: 'x', description: 'x' } })
      return { logs: [], value: { script } }
    }
    const result = await cell(ctx, agent.agent, 'program')
    const errors = result.value.result as Record<string, { error: unknown }>
    expect(errors['script']).toEqual({ error: expect.stringContaining('no workflowEngine service is mounted') })
  })
})

describe('bridge error contract', () => {
  it("agent() without description/prompt, a bad mode, or no agent is a structured error", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const agentBridge = callableOf(request, 'agent')
      const noDesc = await agentBridge({ prompt: 'p' })
      const noPrompt = await agentBridge({ description: 'd' })
      const badMode = await agentBridge({ description: 'd', prompt: 'p', mode: 'clone' })
      const stray = await agentBridge({ description: 'd', prompt: 'p', urgent: true })
      return { logs: [], value: { noDesc, noPrompt, badMode, stray } }
    }
    const result = await cell(ctx, agent.agent, 'program')
    const errors = result.value.result as Record<string, { error: unknown }>
    expect(errors['noDesc']).toEqual({ error: expect.stringContaining('requires {"description"') })
    expect(errors['noPrompt']).toEqual({ error: expect.stringContaining('requires {"prompt"') })
    expect(errors['badMode']).toEqual({ error: expect.stringContaining("expected 'delegate' or 'fork'") })
    expect(errors['stray']).toEqual({ error: expect.stringContaining('unexpected key(s): urgent') })
  })

  it("agent_message() interrupt without target_session_id is a structured error", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_message')({ receiver: 'interrupt' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('requires {"target_session_id"') })
  })

  it("agent_workflow() with a missing mode field is a structured error", async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeDelegationServices(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const result = await callableOf(request, 'agent_workflow')({ script: 'return 1' })
      return { logs: [], value: result }
    }
    const result = await cell(ctx, agent.agent, 'program')
    expect(result.value.result).toEqual({ error: expect.stringContaining('requires {"meta"') })
  })
})

describe('bridge binding surface', () => {
  it('the three bridges are flat names in the REPL binding set', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const toolMembers = Object.keys(request.bindings.find(binding => binding.global === 'tool')?.functions ?? {})
      return { logs: [], value: { toolMembers } }
    }
    const result = await cell(ctx, agent.agent, 'program')
    const { toolMembers } = result.value.result as { toolMembers: string[] }
    for (const bridge of ['agent', 'agent_message', 'agent_workflow']) {
      expect(toolMembers).toContain(bridge)
    }
  })
})
