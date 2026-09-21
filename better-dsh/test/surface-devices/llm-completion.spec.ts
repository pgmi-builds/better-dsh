import { describe, expect, it, onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FakeCellRuntime, fakeRuntime, runCell, setupPresentation } from '../helpers.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * The `llm_completion` tool (native-tools Wave2): one-shot, toolless,
 * historyless LLM call over the host-plane `ctx.llm` service. These tests
 * mount a fake llm service that records the GenerateOptions it received and
 * streams a fixed text, then drive the tool through the real registry
 * pipeline (cell → auto-bridge → dispatch → execute) and assert: route
 * follows the calling agent, the request carries no tools and exactly one
 * user message, sessionId attribution, the string-root output, and the
 * structured-error contract for bad input and degraded finishes.
 */

/** The GenerateOptions the fake llm service received. */
interface RecordedCall {
  provider: string
  model: string
  system: string | undefined
  maxTokens: number | undefined
  sessionId: string | undefined
  messageCount: number
  promptText: string
  tools: unknown
  signalPresent: boolean
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
  ]
}

async function fakeLlm(
  ctx: Context,
  chunks: () => StreamChunk[] = () => textChunks('FAKE-JUDGE-VERDICT'),
): Promise<RecordedCall[]> {
  const calls: RecordedCall[] = []
  const fiber = await ctx.plugin({ name: 'fake-llm', apply(c) {
    c.provide('llm', {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls.push({
          provider: options.provider,
          model: options.model,
          system: options.system,
          maxTokens: options.maxTokens,
          sessionId: options.sessionId,
          messageCount: options.messages.length,
          promptText: String((options.messages[0] as { content: { type: string, text?: string }[] }).content.filter(b => b.type === 'text').map(b => b.text).join(' ')),
          tools: options.tools,
          signalPresent: options.signal !== undefined,
        })
        async function* iterate(): AsyncIterable<StreamChunk> {
          yield* chunks()
        }
        return iterate()
      },
    })
  } })
  onTestFinished(() => fiber.dispose())
  return calls
}

describe('llm_completion tool', () => {
  it('returns the model text as a bare string root, routed on the calling agent, toolless', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime, {}, { provider: 'fake-provider', model: 'fake-model' })
    const calls = await fakeLlm(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const binding = request.bindings.find(b => b.global === 'tool')?.functions['llm_completion']
      if (!binding) throw new Error('llm_completion not in the binding set')
      const value = await binding({ prompt: 'judge this: is 2+2=4?', system: 'answer tersely' })
      return { logs: [], value }
    }
    const result = await runCell(ctx, 'program', { agent: agent.agent })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    expect((result.value as { result?: unknown }).result).toBe('FAKE-JUDGE-VERDICT')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.provider).toBe(agent.agent.options.provider)
    expect(calls[0]!.model).toBe(agent.agent.options.model)
    expect(calls[0]!.system).toBe('answer tersely')
    expect(calls[0]!.messageCount).toBe(1)
    expect(calls[0]!.promptText).toBe('judge this: is 2+2=4?')
    expect(calls[0]!.tools).toBeUndefined()
    expect(calls[0]!.sessionId).toBe(agent.agent.session.id)
    expect(calls[0]!.signalPresent).toBe(true)
  })

  it('binds as a flat tool.* member (auto-bridge picked it up, no per-name wiring)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeLlm(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const toolMembers = Object.keys(request.bindings.find(b => b.global === 'tool')?.functions ?? {})
      return { logs: [], value: { toolMembers } }
    }
    const result = await runCell(ctx, 'program', { agent: agent.agent })
    expect(result.isError).toBe(false)
    const { toolMembers } = (result.value as { result?: unknown }).result as { toolMembers: string[] }
    expect(toolMembers).toContain('llm_completion')
  })

  it('answers a structured error for bad input (no prompt, oversized maxTokens, bad system)', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    await fakeLlm(ctx)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const binding = request.bindings.find(b => b.global === 'tool')?.functions['llm_completion']
      if (!binding) throw new Error('llm_completion not bound')
      const noPrompt = await binding({})
      let badSystem = 'UNREACHED'
      try { await binding({ prompt: 'x', system: 5 }) } catch (error) { badSystem = String(error) }
      const overMax = await binding({ prompt: 'x', maxTokens: 999999 })
      return { logs: [], value: { noPrompt, badSystem, overMax } }
    }
    const result = await runCell(ctx, 'program', { agent: agent.agent })
    expect(result.isError).toBe(false)
    const errors = (result.value as { result?: unknown }).result as Record<string, { error: string }>
    expect(errors['noPrompt']).toEqual({ error: expect.stringContaining('requires {"prompt"') })
    // A type-mismatched field (system: 5) is a CALL-PROTOCOL error: the
    // registry's schema validation rejects it before execute, as a thrown
    // dispatch error — the structured-error contract covers semantic failures.
    expect(errors['badSystem']).toContain('invalid arguments')
    expect(errors['overMax']).toEqual({ error: expect.stringContaining('maxTokens') })
  })

  it('answers a structured error when no llm service is mounted', async () => {
    const { ctx, agent } = await setupPresentation(fakeRuntime)
    const runtime = ctx.get('replRuntime') as FakeCellRuntime
    runtime.behavior = async (request) => {
      const binding = request.bindings.find(b => b.global === 'tool')?.functions['llm_completion']
      if (!binding) throw new Error('llm_completion not bound')
      const value = await binding({ prompt: 'x' })
      return { logs: [], value }
    }
    const result = await runCell(ctx, 'program', { agent: agent.agent })
    expect(result.isError).toBe(false)
    expect((result.value as { result?: unknown }).result).toEqual({ error: expect.stringContaining('no ctx.llm service') })
  })
})
