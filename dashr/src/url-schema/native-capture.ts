/**
 * Native tool capture: snapshot the host-plane tool surface an agent
 * inherits, BEFORE anything on this composition shadows or restricts it.
 *
 * Two consumers, one snapshot:
 *
 * - The URL-aware `write`/`grep`/`glob` tools are delegation shells: non-URL
 *   inputs must run through the NATIVE definition (its write-intent policy
 *   gate, its ripgrep invocation) rather than a reimplementation. The capture
 *   must happen before `createWriteTool`/`createGrepTool`/`createGlobTool`
 *   register on the agent's own scope layer — `ctx.tools.get(name, agent)`
 *   resolves scoped-shadowed names, so a capture taken after registration
 *   would resolve back to the wrapper itself and delegate into infinite
 *   recursion. The wiring step therefore calls {@link captureNativeTools} at
 *   `agent/session-start`, then registers the wrappers with the captured set.
 * - The wire mask (`restrict({deny})`, src/index.ts) removes the displaced
 *   delegation names from every registry projection, including `get(name,
 *   agent)`. The `send_message` bridge downlink must still reach the native
 *   definition, so the full snapshot ({@link captureAllTools}) is taken at
 *   the same session-start moment, BEFORE the restrict call runs, and the
 *   bridge reads it back through {@link getCapturedTools} — a direct
 *   `def.execute` that never re-enters the masked name space.
 *
 * A missing definition is not an error: a host that did not deploy the
 * native tool leaves the slot absent, and the corresponding wrapper reports
 * a structured `NATIVE_*_UNAVAILABLE` error when it is actually asked to
 * run without a delegate.
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
 * once, before its own layer gains the wrappers and before the wire mask
 * restricts it; the WeakMap keeps the snapshot alive with the agent and
 * makes repeated session starts cheap.
 */
const captured = new WeakMap<Agent, ReadonlyMap<string, ToolDefinition>>()

/** The projected wrapper triple per agent, cached beside the full snapshot. */
const projections = new WeakMap<Agent, NativeToolSet>()
/**
 * Snapshot EVERY tool `agent` can see, before any wrapper registers or any
 * restriction lands: enumerate `ctx.tools.schemas(agent)` (the agent's
 * pre-mask visible projection) and resolve each name through
 * `ctx.tools.get(name, agent)`.
 *
 * MUST run at `agent/session-start` BEFORE (a) the URL-aware wrappers
 * register on the agent's own scope layer and (b) the wire-mask
 * `tools.restrict({deny})` call — after either, names this snapshot exists
 * to preserve (the shadowed natives, the masked delegation tools) read as
 * the wrapper or as absent. A definition that fails to resolve is skipped,
 * not thrown: the snapshot serves best-effort internal delegation.
 *
 * @returns the cached full snapshot for `agent` (stable across recalls).
 */
export function captureAllTools(ctx: Context, agent: Agent): ReadonlyMap<string, ToolDefinition> {
  const cached = captured.get(agent)
  if (cached !== undefined) return cached

  const all = new Map<string, ToolDefinition>()
  for (const schema of ctx.tools.schemas(agent)) {
    try {
      const definition = ctx.tools.get(schema.name, agent)
      if (definition !== undefined) all.set(schema.name, definition)
    } catch {
      // A definition that cannot resolve here stays absent; nothing in the
      // snapshot is load-bearing for registry correctness.
    }
  }
  captured.set(agent, all)
  return all
}

/**
 * Read back one agent's full session-start snapshot (see
 * {@link captureAllTools}). `undefined` means no capture ran for the agent
 * (a lifecycle that never fired `agent/session-start`).
 */
export function getCapturedTools(agent: Agent): ReadonlyMap<string, ToolDefinition> | undefined {
  return captured.get(agent)
}

/**
 * Capture the native `write`/`grep`/`glob` definitions as `agent` sees them,
 * projected out of the full snapshot ({@link captureAllTools}).
 *
 * MUST be called before the URL-aware wrappers register on the agent's own
 * scope layer (see the module comment); the result is cached per agent.
 */
export function captureNativeTools(ctx: Context, agent: Agent): NativeToolSet {
  const cachedProjection = projections.get(agent)
  if (cachedProjection !== undefined) return cachedProjection
  const all = captureAllTools(ctx, agent)
  const set: NativeToolSet = {}
  for (const name of NATIVE_TOOL_NAMES) {
    const definition = all.get(name)
    if (definition !== undefined) set[name] = definition
  }
  projections.set(agent, set)
  return set
}
