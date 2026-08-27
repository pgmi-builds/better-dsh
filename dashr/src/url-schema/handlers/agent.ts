/**
 * `agent://` scheme handler — the caller's family tree: roster, output
 * artifact, transcript, and nested-child output (design.md D6).
 *
 *   - `agent://`                → the caller's roster: continuable descendants
 *                                 only (one-shot children are omitted — they
 *                                 are not continuation candidates), never a
 *                                 global session enumeration
 *   - `agent://<id>`            → that agent's final output artifact
 *   - `agent://<id>/transcript` → the agent's full message transcript
 *   - `agent://<id>/<child>`    → a direct child's output artifact
 *
 * Addressing is scoped to the caller's own family — itself plus the child
 * rows of `ctx.subagents.listDescendants(caller.id)` — mirroring the
 * service-layer lineage authorization: a cross-family id is AGENT_UNKNOWN_ID,
 * never a readable session. An id segment resolves by exact raw session id
 * first, then by the child's creation label; on label ambiguity the newest
 * child wins and failure messages say to use the raw id.
 *
 * A settled child (absent from the live store) stays addressable: its final
 * output is read from `ctx.sessionPersistence` — the URL analog of collecting
 * a background run's result via job_output.
 *
 * Services required (for the integration/wiring step):
 *   - `ctx.subagents` — the host-plane subagent seam, for `listDescendants`
 *     (family enumeration + addressing scope). Mirrored STRUCTURALLY because
 *     `@deepseek-ai/dsh-subagent` is a host-plane root-realm singleton that
 *     is deliberately not in this package's dependency graph.
 *   - `ctx.sessions` — the event-sourced session store, for live-session
 *     lookup (output, transcript, roster last-activity).
 *   - `ctx.sessionPersistence` — the durable session-log seam, for settled
 *     children's final output and creation times (same structural-mirror
 *     policy as `ctx.subagents`).
 *   - `ctx.agents` — the live agent registry, for the roster `status` column
 *     (optional; a registry miss renders `ready` — persisted-only, resumable,
 *     not terminal).
 */

import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemaError } from '../selector.ts'

/**
 * Structural mirror of the host-plane `SubagentListEntry` — only the fields
 * the family projection consumes. The real entry is a discriminated union;
 * this looser shape stays structurally assignable from
 * `SubagentRuntime.listDescendants`.
 */
export interface AgentChildEntry {
  readonly kind: 'child' | 'diagnostic'
  readonly id: SessionId
  readonly activity?: 'running' | 'inactive'
  readonly mode?: 'one-shot' | 'continuable'
  readonly label?: string
  readonly hasChildren?: boolean
  readonly reason?: 'corrupt' | 'unsupported' | 'unavailable'
}

/**
 * Structural mirror of the host-plane `SubagentDescendantListEntry` — a
 * {@link AgentChildEntry} plus its position in the enumerated tree.
 */
export interface AgentDescendantEntry extends AgentChildEntry {
  /** Durable direct parent of this child in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the enumerated root; direct children are `1`. */
  readonly depth: number
}

/** The subset of `ctx.subagents` this handler calls. */
export interface AgentSubagentsSurface {
  listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<AgentDescendantEntry[]>
}

/** The subset of the live agent registry (`ctx.agents`) the roster reads. */
export interface AgentRegistrySurface {
  get(id: SessionId): { readonly status: 'idle' | 'running' } | undefined
}

/**
 * Structural mirror of one persisted session event — only what the settled
 * output fallback and the roster's last-activity column read. The real
 * `SessionEvent` is a discriminated union over `data`; this looser shape
 * stays structurally assignable from `SessionPersistence.inspect`.
 */
export interface PersistedSessionEvent {
  readonly type: string
  readonly time: number
  readonly data?: unknown
}

/** The subset of `ctx.sessionPersistence` this handler calls. */
export interface SessionPersistenceSurface {
  inspect(id: SessionId, signal?: AbortSignal): Promise<
    | { readonly meta: { readonly createdAt: number }; readonly events: readonly PersistedSessionEvent[] }
    | undefined
  >
}

/** Dependencies captured by the agent:// handler. */
export interface AgentHandlerDeps {
  /** Live session store — live lookup for output, transcript, last activity. */
  sessions: Pick<SessionStore, 'get'>
  /** Subagent enumeration — family roster and addressing scope. */
  subagents: AgentSubagentsSurface
  /** Durable session log — settled children's output and creation times. */
  sessionPersistence: SessionPersistenceSurface
  /** Live agent registry — roster `status`; a miss renders `ready`. */
  agents?: AgentRegistrySurface
}

/** The `env` subset this handler reads: the calling agent's session id. */
export interface AgentEnv extends ResolverEnv {
  readonly agent?: { readonly id: SessionId | string }
}

/** The read surfaces the family lookups share: live sessions + persisted logs. */
interface FamilyReads {
  readonly sessions: Pick<SessionStore, 'get'>
  readonly sessionPersistence: SessionPersistenceSurface
}

/** One resolved address segment: the raw id plus its label-ambiguity trail. */
interface AddressResolution {
  readonly rawId: string
  readonly ambiguous?: { readonly label: string; readonly matches: number }
}

/**
 * Build the `agent://` scheme handler. Handlers return the FULL text of the
 * resource; the resolver applies any `:raw`/`:N-M`/`/path`/`?q=` selector.
 */
export function createAgentHandler(deps: AgentHandlerDeps): SchemeHandler {
  const { sessions, subagents, sessionPersistence, agents } = deps
  const family: FamilyReads = { sessions, sessionPersistence }
  return {
    async resolve(env: ResolverEnv, path: string): Promise<string> {
      const segments = path.replace(/^\/+/, '').split('/').filter((seg) => seg !== '')
      const callerRaw = requireCaller(env)

      // The family enumeration doubles as the addressing scope. Only `child`
      // rows are members; diagnostics relay enumeration damage and never name
      // a usable agent.
      const children = (await subagents.listDescendants(SessionId(callerRaw)))
        .filter((entry) => entry.kind === 'child')

      if (segments.length === 0) {
        return await renderRoster(family, children, agents)
      }

      const [first, rest] = [segments[0]!, segments[1]]

      if (segments.length === 1) {
        const target = requireAddress(await resolveAddress(first, callerRaw, children, family), first)
        return await outputFor(target, family)
      }

      if (segments.length === 2 && rest === 'transcript') {
        const target = requireAddress(await resolveAddress(first, callerRaw, children, family), first)
        return renderTranscript(requireLiveSession(target, family))
      }

      if (segments.length === 2) {
        const parent = requireAddress(await resolveAddress(first, callerRaw, children, family), first)
        const grandChildren = children.filter((entry) => String(entry.parentId) === parent.rawId)
        const child = requireAddress(
          await resolveAddress(rest!, parent.rawId, grandChildren, family),
          rest!,
          `unknown child agent "${rest}" of "${parent.rawId}"`,
        )
        return await outputFor(child, family)
      }

      throw new UrlSchemaError(
        'AGENT_BAD_PATH',
        `agent:// path "${path}" has too many segments — expected <id>, <id>/transcript, or <id>/<child>`,
      )
    },
  }
}

/** The calling agent's raw session id, or a structured error without one. */
function requireCaller(env: ResolverEnv): string {
  const { agent } = env as AgentEnv
  if (agent === undefined) {
    throw new UrlSchemaError(
      'AGENT_NO_AGENT',
      'agent:// requires the calling agent in the resolver env (this context has none)',
    )
  }
  return String(agent.id)
}

/**
 * Resolve one id segment against a candidate set: exact raw session id first
 * (the caller itself, then an exact candidate id — a label that collides with
 * a raw id never shadows it), then the creation label. On label ambiguity the
 * newest candidate wins; `undefined` means no match at all.
 */
async function resolveAddress(
  segment: string,
  selfRaw: string,
  candidates: readonly AgentDescendantEntry[],
  family: FamilyReads,
): Promise<AddressResolution | undefined> {
  if (segment === selfRaw) return { rawId: selfRaw }
  const byId = candidates.find((entry) => String(entry.id) === segment)
  if (byId !== undefined) return { rawId: String(byId.id) }
  const byLabel = candidates.filter((entry) => entry.label === segment)
  if (byLabel.length === 1) return { rawId: String(byLabel[0]!.id) }
  if (byLabel.length > 1) {
    const newest = await newestByCreation(byLabel, family)
    return { rawId: String(newest.id), ambiguous: { label: segment, matches: byLabel.length } }
  }
  return undefined
}

/** Turn a failed address resolution into its structured error. */
function requireAddress(
  target: AddressResolution | undefined,
  segment: string,
  message = `unknown agent "${segment}" — addressing is scoped to your family tree (self and descendants)`,
): AddressResolution {
  if (target === undefined) throw new UrlSchemaError('AGENT_UNKNOWN_ID', message)
  return target
}

/** The newest entry by creation time (live header, else persisted metadata). */
async function newestByCreation(
  entries: readonly AgentDescendantEntry[],
  family: FamilyReads,
): Promise<AgentDescendantEntry> {
  let newest = entries[0]!
  let newestAt = await createdAtOf(newest, family)
  for (const entry of entries.slice(1)) {
    const at = await createdAtOf(entry, family)
    if (at >= newestAt) {
      newest = entry
      newestAt = at
    }
  }
  return newest
}

/** One child's creation time: its live header, else its persisted metadata. */
async function createdAtOf(entry: AgentDescendantEntry, family: FamilyReads): Promise<number> {
  const live = family.sessions.get(entry.id)
  if (live !== undefined) return live.header.createdAt
  const inspection = await family.sessionPersistence.inspect(entry.id)
  return inspection?.meta.createdAt ?? 0
}

/**
 * The output artifact for one resolved address: the live session's last
 * non-empty assistant message, else the persisted log's — a settled child
 * with neither is unreachable.
 */
async function outputFor(target: AddressResolution, family: FamilyReads): Promise<string> {
  const live = family.sessions.get(SessionId(target.rawId))
  if (live !== undefined) return outputArtifact(live)
  const inspection = await family.sessionPersistence.inspect(SessionId(target.rawId))
  if (inspection === undefined) {
    throw unknownId(target, `agent "${target.rawId}" has no live session and no persisted log`)
  }
  return persistedOutput(inspection.events)
}

/** The live session for one resolved address, or a structured error. */
function requireLiveSession(target: AddressResolution, family: FamilyReads): Session {
  const session = family.sessions.get(SessionId(target.rawId))
  if (session === undefined) {
    throw unknownId(
      target,
      `agent "${target.rawId}" is not live in the session store (transcript requires a live session)`,
    )
  }
  return session
}

/** A structured AGENT_UNKNOWN_ID with the label-ambiguity hint appended. */
function unknownId(target: AddressResolution, message: string): UrlSchemaError {
  const note = target.ambiguous === undefined
    ? ''
    : `; label "${target.ambiguous.label}" is ambiguous (${target.ambiguous.matches} children share it) — address the raw session id to disambiguate`
  return new UrlSchemaError('AGENT_UNKNOWN_ID', `${message}${note}`)
}

/**
 * Roster table: one row per continuable descendant, in enumeration (stable
 * pre-order) order. One-shot children are omitted — they are not continuation
 * candidates. Columns per spec: `id` (creation label when present, else the
 * raw session id), `status` (`running`/`idle` from the live registry, `ready`
 * when only persisted), `parent` (durable direct parent), `last activity`
 * (last event time, ISO 8601, `-` when no log is reachable).
 */
async function renderRoster(
  family: FamilyReads,
  descendants: readonly AgentDescendantEntry[],
  agents?: AgentRegistrySurface,
): Promise<string> {
  const continuable = descendants.filter((entry) => entry.mode === 'continuable')
  if (continuable.length === 0) {
    return 'no agents'
  }
  const rows = await Promise.all(continuable.map(async (entry) => {
    const rawId = String(entry.id)
    const status = agents?.get(entry.id)?.status ?? 'ready'
    const lastActivity = await lastActivityOf(rawId, family)
    return `${entry.label ?? rawId}\t${status}\t${String(entry.parentId)}\t${lastActivity}`
  }))
  return ['id\tstatus\tparent\tlast activity', ...rows].join('\n')
}

/** One child's last activity: its live log's last event, else its persisted one. */
async function lastActivityOf(rawId: string, family: FamilyReads): Promise<string> {
  const live = family.sessions.get(SessionId(rawId))
  if (live !== undefined) return lastEventTime(live.events)
  const inspection = await family.sessionPersistence.inspect(SessionId(rawId))
  return inspection === undefined ? '-' : lastEventTime(inspection.events)
}

/** The last event's time as ISO 8601, `-` for an empty log. */
function lastEventTime(events: readonly { readonly time: number }[]): string {
  const last = events.at(-1)
  return last === undefined ? '-' : new Date(last.time).toISOString()
}

/**
 * The agent's output artifact: the rendered content of its last non-empty
 * assistant message (matching `SubagentResult.output` semantics), or `''` when
 * the agent produced no non-empty assistant output.
 */
function outputArtifact(session: Session): string {
  const messages = session.deriveMessages()
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role === 'assistant') {
      const text = renderBlocks(message.content)
      if (text.trim() !== '') {
        return text
      }
    }
  }
  return ''
}

/**
 * The persisted log's final assistant output: the rendered content of the
 * last non-empty `assistant/message` event, or `''` when there is none. A
 * deliberately simple fold over the inspected events — the upstream
 * `finalAssistantOutput` helper is not exported.
 */
function persistedOutput(events: readonly PersistedSessionEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (event.type !== 'assistant/message') continue
    const message = (event.data as { message?: { readonly content?: readonly ContentBlock[] } } | undefined)?.message
    if (message === undefined) continue
    const text = renderBlocks(message.content ?? [])
    if (text.trim() !== '') {
      return text
    }
  }
  return ''
}

/** Full transcript: every derived message in order, role-headed. */
function renderTranscript(session: Session): string {
  return session
    .deriveMessages()
    .map((message) => `## ${messageLabel(message)}\n${renderBlocks(message.content)}`)
    .join('\n\n')
}

function messageLabel(message: Message): string {
  if (message.role === 'assistant') {
    return 'assistant'
  }
  if (message.role === 'system') {
    return 'system'
  }
  const first = message.content[0]
  return first !== undefined && first.type === 'tool-result' ? 'tool result' : 'user'
}

/** Render typed model content to plain text. */
function renderBlocks(content: readonly ContentBlock[]): string {
  return content.map(renderBlock).join('')
}

function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return `[tool: ${block.name}] ${block.arguments}`
    case 'tool-result':
      return block.isError === true
        ? `[tool error] ${renderBlocks(block.content)}`
        : renderBlocks(block.content)
    case 'image':
      return '[image]'
    default: {
      const unknown = block as { type?: string }
      return `[${unknown.type ?? 'unknown'}]`
    }
  }
}
