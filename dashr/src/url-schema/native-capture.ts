/**
 * Native tool capture: snapshot the host-plane tool definitions that the
 * URL-aware wrappers shadow, BEFORE those wrappers register.
 *
 * The URL-aware `write`/`grep`/`glob` tools are delegation shells: non-URL
 * inputs must run through the NATIVE definition (its write-intent policy
 * gate, its ripgrep invocation) rather than a reimplementation. The capture
 * must happen before `createWriteTool`/`createGrepTool`/`createGlobTool`
 * register on the agent's own scope layer — `ctx.tools.get(name, agent)`
 * resolves scoped-shadowed names, so a capture taken after registration
 * would resolve back to the wrapper itself and delegate into infinite
 * recursion. The wiring step therefore calls {@link captureNativeTools} at
 * `agent/session-start`, then registers the wrappers with the captured set.
 *
 * A missing definition is not an error: a host that did not deploy the
 * native tool leaves the slot `undefined`, and the corresponding wrapper
 * reports a structured `NATIVE_*_UNAVAILABLE` error when it is actually
 * asked to run without a delegate.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/**
 * The native definitions the URL-aware wrappers delegate to. Every field is
 * optional: `undefined` means the host did not deploy that native tool.
 */
export interface NativeToolSet {
  write?: ToolDefinition
  grep?: ToolDefinition
  glob?: ToolDefinition
}

/** Tool names the wrappers shadow and delegate back to. */
const NATIVE_TOOL_NAMES = ['write', 'grep', 'glob'] as const

/**
 * Per-agent capture cache. An agent's inherited tool surface is captured
 * once, before its own layer gains the wrappers; the WeakMap keeps the
 * snapshot alive with the agent and makes repeated session starts cheap.
 */
const captured = new WeakMap<Agent, NativeToolSet>()

/**
 * Capture the native `write`/`grep`/`glob` definitions as `agent` sees them.
 *
 * MUST be called before the URL-aware wrappers register on the agent's own
 * scope layer (see the module comment); the result is cached per agent.
 */
export function captureNativeTools(ctx: Context, agent: Agent): NativeToolSet {
  const cached = captured.get(agent)
  if (cached !== undefined) return cached

  const set: NativeToolSet = {}
  for (const name of NATIVE_TOOL_NAMES) {
    const definition = ctx.tools.get(name, agent)
    if (definition !== undefined) set[name] = definition
  }
  captured.set(agent, set)
  return set
}
