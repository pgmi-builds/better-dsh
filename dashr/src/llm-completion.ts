/**
 * The `llm_completion` tool (native-tools Wave2, v0.1.9-a): a one-shot,
 * stateless LLM call — no tools, no conversation history, no agent creation.
 *
 * It wraps the HOST-PLANE `ctx.llm` service (dsh-llm's LlmRuntime — the same
 * service the session-title generator uses for its own bare auxiliary call),
 * so there is no preset-realm visibility problem: `ctx.get('llm')` resolves
 * directly. Registered as a real registry tool at the same host layer as
 * `eval`; the registry projection is then the single source for wire,
 * catalog, and REPL bindings alike.
 *
 * Model route: the CALLING agent's own selection (`agent.options.provider` /
 * `agent.options.model` — a judge/extraction call is only meaningful on the
 * same tier as its caller). An agentless call, or one whose agent has no
 * provider/model selected, answers a structured error rather than guessing a
 * hidden default.
 *
 * `GenerateOptions.purpose` is a closed host enum ('compaction' |
 * 'session-title'); this call passes none — attribution rides the caller's
 * sessionId and the normal request event stream.
 * @module dashr-repl/llm-completion
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ObjectValueSchemaSpec, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

/** The `ctx.llm` service surface this tool calls (structural mirror of dsh-llm's LlmRuntime.stream). */
export interface DASHRLlmSurface {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** Host-level resolver for the llm service. */
export interface LlmCompletionDeps {
  requireLlm: () => DASHRLlmSurface | undefined
}

/** Default output-token ceiling for one completion (cost guard; the caller may lower it, never raise past this). */
const MAX_COMPLETION_TOKENS = 4096

/** Structured failure text for one non-`stop` finish (mirrors the session-title generator's finishError). */
function finishError(finish: { kind: string, failure?: { message?: unknown } }): string {
  switch (finish.kind) {
    case 'stop': return ''
    case 'error': case 'aborted': return `llm_completion() call ${finish.kind}: ${String(finish.failure?.message ?? finish.kind)}`
    case 'max-tokens': return 'llm_completion() output reached its maxTokens ceiling'
    case 'tool-calls': return 'llm_completion() model unexpectedly requested a tool (a bare call offers none)'
    default: return `llm_completion() unsupported finish reason ${JSON.stringify(finish.kind)}`
  }
}

/**
 * Build the `llm_completion` tool. Input: `{ prompt, system?, maxTokens? }`;
 * output: the model's text (a bare string root), or a structured `{ error }`
 * object — never a thrown exception for bad input or a degraded finish.
 */
export function createLlmCompletionTool(deps: LlmCompletionDeps): ToolDefinition {
  const errorVariant: ObjectValueSchemaSpec = { type: 'object', properties: { error: { type: 'string' } }, additionalProperties: false }
  return defineTool({
    name: 'llm_completion',
    description: 'One-shot stateless LLM call — no tools, no history, no agent. Give {prompt} (and optional {system}, {maxTokens}); get the model\'s text back. For judge steps, extraction, and handoff compression inside one cell, without spawning a subagent.',
    parameters: {
      // No schema-level `required`: validation owns the structured-error contract in execute.
      prompt: { type: 'string', description: 'The prompt for the one-shot call.' },
      system: { type: 'string', description: 'Optional system prompt for the call.' },
      maxTokens: { type: 'integer', description: `Optional output-token ceiling for this call (default ${MAX_COMPLETION_TOKENS}, which is also the cap).` },
    },
    output: {
      schema: { oneOf: [{ type: 'string' }, errorVariant] },
      render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec): Promise<never> => {
      const a = args as Record<string, unknown>
      const prompt = a['prompt']
      if (typeof prompt !== 'string' || prompt.length === 0) {
        return { error: 'llm_completion() requires {"prompt": "..."} — the one-shot prompt' } as never
      }
      const system = a['system']
      if (system !== undefined && typeof system !== 'string') {
        return { error: 'llm_completion() system must be a string' } as never
      }
      const maxTokens = a['maxTokens'] === undefined ? MAX_COMPLETION_TOKENS : a['maxTokens']
      if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_COMPLETION_TOKENS) {
        return { error: `llm_completion() maxTokens must be a positive safe integer no greater than ${MAX_COMPLETION_TOKENS}` } as never
      }
      const llm = deps.requireLlm()
      if (llm === undefined) {
        return { error: 'llm_completion() is unavailable: no ctx.llm service is mounted in this composition' } as never
      }
      const agent = exec.agent
      const route = agent?.options as { provider?: string, model?: string } | undefined
      const provider = route?.provider
      const model = route?.model
      if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) {
        return { error: 'llm_completion() requires a model route: the calling agent has no provider/model selected (a judge call runs on its caller\'s tier)' } as never
      }
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: '@pgmi-builds/dashr' },
      })]
      const options: GenerateOptions = {
        provider,
        model,
        messages,
        maxTokens,
        ...(system !== undefined ? { system } : {}),
        ...agent ? { sessionId: agent.session.id } : {},
        signal: exec.signal,
      }
      const assembler = new BlockAssembler()
      try {
        for await (const chunk of llm.stream(options)) {
          exec.signal.throwIfAborted()
          assembler.push(chunk)
        }
      } catch (error: unknown) {
        return { error: `llm_completion() failed: ${error instanceof Error ? error.message : String(error)}` } as never
      }
      const failure = finishError(assembler.finish)
      if (failure !== '') return { error: failure } as never
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type === 'tool-call')) {
        return { error: 'llm_completion() output must contain text only' } as never
      }
      const text = blocks
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      if (text.trim().length === 0) {
        return { error: 'llm_completion() produced no text' } as never
      }
      return text as never
    },
  })
}
