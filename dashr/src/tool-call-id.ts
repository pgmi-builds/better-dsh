/**
 * The 0.1.2+ tool-call id brand constructor.
 *
 * `@deepseek-ai/dsh-llm` renamed its tool-call correlation brand from `CallId`
 * to `ToolCallId` in 0.1.2. dashr targets 0.1.2-alpha and later, so it resolves
 * `ToolCallId` directly — no pre-0.1.2 (`CallId`) fallback. The two symbols are
 * byte-for-byte the same thing at runtime (a zero-cost nominal cast over a
 * plain string); only the exported constructor symbol moved.
 *
 * @module dashr/tool-call-id
 */
import * as dshLlm from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'

/** The host's tool-call id brand, as carried by `ToolExecutionInput.callId`. */
export type ToolCallId = ToolExecutionInput['callId']

/** Brand a string as the host's tool-call id (identity at runtime). */
export const toolCallId = (dshLlm as unknown as Record<string, unknown>).ToolCallId as (id: string) => ToolCallId
