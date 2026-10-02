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

// dsh session format v4: producer-owned source kinds — each producer declares
// its own kind in the merge-extensible MessageSourceMap (no shared catch-all
// 'plugin' kind; the v3→v4 migration rewrites `{ kind: 'plugin', plugin }`
// sources to exactly this shape).
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** LLM completion answers produced by the better-dsh plugin. */
    'plugin:better-dsh': { kind: 'plugin:better-dsh' }
  }
}

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
/** Narrow a tool result to the success variant (for the model-facing render). */
function isTextResult(value: unknown): value is { ok: true, text: string } {
  return typeof value === 'object' && value !== null
    && (value as { ok?: unknown }).ok === true
    && typeof (value as { text?: unknown }).text === 'string'
}

export function createLlmCompletionTool(deps: LlmCompletionDeps): ToolDefinition {
  // Both outcomes are objects: the caller branches on `ok` instead of guessing
  // whether it holds a string or an error object (the pre-2026-10 shape).
  const textVariant: ObjectValueSchemaSpec = {
    type: 'object',
    properties: { ok: { type: 'boolean', required: true }, text: { type: 'string', required: true } },
    additionalProperties: false,
  }
  const errorVariant: ObjectValueSchemaSpec = {
    type: 'object',
    properties: { ok: { type: 'boolean', required: true }, error: { type: 'string', required: true } },
    additionalProperties: false,
  }
  return defineTool({
    name: 'llm_completion',
    description: 'One-shot stateless LLM call — no tools, no history, no agent. Give {prompt} (and optional {system}, {maxTokens}); get a discriminated result back: {ok:true,text} on success or {ok:false,error} on failure, so a programmatic caller can branch without shape guessing (a direct tool call renders just the text on success). For judge steps, extraction, and handoff compression inside one cell, without spawning a subagent.',
    parameters: {
      // No schema-level `required`: validation owns the structured-error contract in execute.
      prompt: { type: 'string', description: 'The prompt for the one-shot call.' },
      system: { type: 'string', description: 'Optional system prompt for the call.' },
      maxTokens: { type: 'integer', description: `Optional output-token ceiling for this call (default ${MAX_COMPLETION_TOKENS}, which is also the cap).` },
    },
    output: {
      schema: { oneOf: [textVariant, errorVariant] },
      render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: isTextResult(value) ? value.text : JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec): Promise<never> => {
      const a = args as Record<string, unknown>
      const prompt = a['prompt']
      if (typeof prompt !== 'string' || prompt.length === 0) {
        return { ok: false, error: 'llm_completion() requires {"prompt": "..."} — the one-shot prompt' } as never
      }
      const system = a['system']
      if (system !== undefined && typeof system !== 'string') {
        return { ok: false, error: 'llm_completion() system must be a string' } as never
      }
      const maxTokens = a['maxTokens'] === undefined ? MAX_COMPLETION_TOKENS : a['maxTokens']
      if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_COMPLETION_TOKENS) {
        return { ok: false, error: `llm_completion() maxTokens must be a positive safe integer no greater than ${MAX_COMPLETION_TOKENS}` } as never
      }
      const llm = deps.requireLlm()
      if (llm === undefined) {
        return { ok: false, error: 'llm_completion() is unavailable: no ctx.llm service is mounted in this composition' } as never
      }
      const agent = exec.agent
      const route = agent?.options as { provider?: string, model?: string } | undefined
      const provider = route?.provider
      const model = route?.model
      if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) {
        return { ok: false, error: 'llm_completion() requires a model route: the calling agent has no provider/model selected (a judge call runs on its caller\'s tier)' } as never
      }
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        // dsh session format v4 admits only producer-owned source kinds; the
        // bare `{ kind: 'plugin', plugin }` wrapper was retired in 0.1.7.
        source: { kind: 'plugin:better-dsh' },
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
        return { ok: false, error: `llm_completion() failed: ${error instanceof Error ? error.message : String(error)}` } as never
      }
      const failure = finishError(assembler.finish)
      if (failure !== '') return { ok: false, error: failure } as never
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type === 'tool-call')) {
        return { ok: false, error: 'llm_completion() output must contain text only' } as never
      }
      const text = blocks
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      if (text.trim().length === 0) {
        return { ok: false, error: 'llm_completion() produced no text' } as never
      }
      return { ok: true, text } as never
    },
  })
}
