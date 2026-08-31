/**
 * Host-plane general LLM failover (per-turn, per-completion transparent).
 *
 * On an `AUTH`/`MISSING_CREDENTIAL`/`QUOTA`/`RATE_LIMIT` failure the runtime walks the two-slot
 * fallback chain and then STAYS on the fallback for the rest of the turn
 * (KV-cache friendly — "换了就跑完"). No cooldown, no primary-model tracking,
 * no revert: the only state is a per-agent `{ turn, fallbackIndex }` latch
 * (0 = primary, 1 = fallback1, 2 = fallback2), reset when the turn advances.
 * Every completion starts at the primary unless the turn is already latched.
 *
 * Hooks two native agent-loop waterfalls (shared with `dsh-llm-retry` and
 * native model-selection):
 *   agent/request-error → on trigger-code failure, advance the latch, retry
 *   agent/request       → if latched this turn, override provider/model
 *
 * @module dashr/failover
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import {
  FAILOVER_SETTINGS_NS, FAILOVER_TRIGGER_CODES,
  defaultFailoverConfig, fallbackRoutes, splitRoute,
  type FailoverConfig,
} from './config.ts'

/** The `failover` settings schema: two optional fallback slots, both default "not set". */
export const Config = z.object({
  fallback1: z.string().default(''),
  fallback2: z.string().default(''),
}) as unknown as z<FailoverConfig>

/** Replace provider/model on a request config, dropping the inherited reasoning effort. */
function overrideConfig(seed: LlmCallConfig, to: { provider: string; model: string }): LlmCallConfig {
  const { reasoningEffort: _inherited, ...rest } = seed
  return { ...rest, provider: to.provider, model: to.model }
}

/** Per-agent turn latch: which fallback (0 = primary) is active for the current turn. */
interface TurnLatch {
  turn: number
  fallbackIndex: number
}

/** Install the failover. A no-op composition degrades gracefully (empty chain = pass-through). */
export function installFailover(ctx: Context, config: FailoverConfig = defaultFailoverConfig): void {
  const logger = ctx.logger('llm-failover')

  // Live config source: the schema-resolved entry, swapped for the settings
  // scope's resolved value when a settings service is composed.
  let source: () => FailoverConfig = () => Config(config)
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, FAILOVER_SETTINGS_NS, Config, Config(config), {
      setSource: (current) => {
        source = current
      },
      onChange: () => {},
    })
  })

  // Per-agent turn latch; keyed by agent id, cleared on disposal.
  const latches = new Map<string, TurnLatch>()

  ctx.on('agent/disposed', ({ agent }) => {
    latches.delete(agent.id)
  })

  ctx.on('agent/request-error', async ({ agent, turn, step, provider, failure }, next) => {
    // The native retry policy (a core service) registers upstream of this plugin
    // listener, so it runs first: it short-circuits us through its own retry
    // attempts and only delegates here once exhausted (or for non-retryable
    // codes). We therefore fail over only after the primary's attempts are spent;
    // every non-failover path keeps delegating downstream via `next()`.
    if (FAILOVER_TRIGGER_CODES[failure.code] !== true) return next()
    const routes = fallbackRoutes(source())
    if (routes.length === 0) return next()
    const latch = latches.get(agent.id)
    const fallbackIndex = latch !== undefined && latch.turn === turn ? latch.fallbackIndex : 0
    // Chain exhausted this turn: no further fallback, let the failure propagate.
    if (fallbackIndex >= routes.length) return next()
    const nextIndex = fallbackIndex + 1
    const route = routes[nextIndex - 1]!
    if (splitRoute(route) === undefined) return next()
    latches.set(agent.id, { turn, fallbackIndex: nextIndex })
    logger.info(
      'llm-failover: agent "%s" provider="%s" code=%s -> switch to "%s" (per turn)',
      agent.id,
      provider,
      failure.code,
      route,
    )
    // Durable, non-surface retry record on the native `llm/retry` channel: the UI
    // renders it as a model-retry row WITHOUT making it model-visible (no second
    // completion). A uniform `failover` code renders the message verbatim; the
    // original code rides the bracketed prefix for the audit trail.
    agent.session.append('llm/retry', {
      retryId: RetryId(randomUUID()),
      turn,
      step,
      provider,
      mode: 'normal',
      policyKey: 'llm-failover',
      retry: nextIndex,
      maxRetries: routes.length,
      delayMs: 0,
      failure: {
        ...failure,
        code: 'failover',
        message: `[${failure.code}] ${failure.message} → switched to "${route}"`,
      },
    })
    return { kind: 'retry' }
  })

  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const seed = await next()
    const latch = latches.get(agent.id)
    if (latch === undefined || latch.turn !== turn || latch.fallbackIndex <= 0) return seed
    const route = splitRoute(fallbackRoutes(source())[latch.fallbackIndex - 1] ?? '')
    if (route === undefined) return seed
    return overrideConfig(seed, route)
  })
}
