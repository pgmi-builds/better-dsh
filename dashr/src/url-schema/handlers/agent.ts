/**
 * `agent://` scheme handler — subagent roster, output artifact, transcript,
 * and nested-child output.
 *
 * Absorbs the `history://` semantics (roster + transcript) plus the output
 * artifact and nested-child lookups into one scheme, per design.md D3:
 *
 *   - `agent://`                → roster table (all live sessions)
 *   - `agent://<id>`            → the agent's final output artifact
 *   - `agent://<id>/transcript` → the agent's full message transcript
 *   - `agent://<id>/<child>`    → a direct child's output artifact
 *
 * Services required (for the integration/wiring step):
 *   - `ctx.subagents` — the host-plane subagent seam, for `listChildren`
 *     (nested-child resolution). Mirrored STRUCTURALLY (see `subagents-surface.ts`)
 *     because `@deepseek-ai/dsh-subagent` is a host-plane root-realm singleton
 *     that is deliberately not in this package's dependency graph.
 *   - `ctx.sessions` — the event-sourced session store, for the roster
 *     (`list()`), live-session lookup (`get()`), output, and transcript.
 */

import { SessionId, type Session, type SessionStore } from '@deepseek-ai/dsh-session'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'
import { UrlSchemaError } from '../selector.ts'

/**
 * Structural mirror of the host-plane `SubagentListEntry` — only the fields the
 * nested-child lookup consumes. The real entry is a discriminated union; this
 * looser shape stays structurally assignable from `SubagentRuntime.listChildren`.
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

/** The subset of `ctx.subagents` this handler calls. */
export interface AgentSubagentsSurface {
  listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<AgentChildEntry[]>
}

/** Dependencies captured by the agent:// handler. */
export interface AgentHandlerDeps {
  /** Live session store — roster, output, transcript reads. */
  sessions: Pick<SessionStore, 'list' | 'get'>
  /** Subagent enumeration — nested-child resolution. */
  subagents: AgentSubagentsSurface
}

/**
 * Friendly migration pointer for the deprecated `history://` scheme.
 *
 * Per design.md D3, `history://` was absorbed into `agent://` (the agent
 * handler already serves the roster and the full `<id>/transcript`). The
 * resolver routes an unregistered `history://` URL here instead of raising
 * `URL_UNREGISTERED_SCHEME`, so callers get a pointer to the equivalent
 * `agent://` URL rather than a bare "no handler" error.
 */
export function historyAliasHint(rawPath: string): string {
  const id = rawPath.replace(/^\/+/, '').trim()
  if (id === '') {
    return 'history:// 已并入 agent://：裸 agent:// 列出全部 session，agent://<id>/transcript 查看完整 transcript'
  }
  return `history:// 已并入 agent://，请用 agent://${id}/transcript 查看完整 transcript`
}

/**
 * Build the `agent://` scheme handler. Handlers return the FULL text of the
 * resource; the resolver applies any `:raw`/`:N-M`/`/path`/`?q=` selector.
 */
export function createAgentHandler(deps: AgentHandlerDeps): SchemeHandler {
  const { sessions, subagents } = deps
  return {
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const segments = path.replace(/^\/+/, '').split('/').filter((seg) => seg !== '')

      if (segments.length === 0) {
        return renderRoster(sessions.list())
      }

      const [id, rest] = [segments[0]!, segments[1]]

      if (segments.length === 1) {
        return outputArtifact(requireSession(sessions, id))
      }

      if (segments.length === 2 && rest === 'transcript') {
        return renderTranscript(requireSession(sessions, id))
      }

      if (segments.length === 2) {
        return nestedOutput(subagents, sessions, id, rest!)
      }

      throw new UrlSchemaError(
        'AGENT_BAD_PATH',
        `agent:// path "${path}" has too many segments — expected <id>, <id>/transcript, or <id>/<child>`,
      )
    },
  }
}

/** Resolve a raw id to its live session, or fail with a structured error. */
function requireSession(sessions: Pick<SessionStore, 'get'>, rawId: string): Session {
  const session = sessions.get(SessionId(rawId))
  if (session === undefined) {
    throw new UrlSchemaError('AGENT_UNKNOWN_ID', `unknown agent "${rawId}"`)
  }
  return session
}

/** Resolve `<id>/<child>`: enumerate the parent's direct children, then read the child's output. */
async function nestedOutput(
  subagents: AgentSubagentsSurface,
  sessions: Pick<SessionStore, 'get'>,
  parentRaw: string,
  childRaw: string,
): Promise<string> {
  const parentId = SessionId(parentRaw)
  const childId = SessionId(childRaw)
  const children = await subagents.listChildren(parentId)
  const entry = children.find((child) => child.kind === 'child' && child.id === childId)
  if (entry === undefined) {
    throw new UrlSchemaError('AGENT_UNKNOWN_ID', `unknown child agent "${childRaw}" of "${parentRaw}"`)
  }
  const childSession = sessions.get(childId)
  if (childSession === undefined) {
    throw new UrlSchemaError(
      'AGENT_UNKNOWN_ID',
      `child agent "${childRaw}" of "${parentRaw}" is not live in the session store`,
    )
  }
  return outputArtifact(childSession)
}

/** Roster table: every live session, oldest first, one row each. */
function renderRoster(sessions: Session[]): string {
  if (sessions.length === 0) {
    return 'no agents'
  }
  const sorted = [...sessions].sort((a, b) => a.header.createdAt - b.header.createdAt)
  const rows = sorted.map((session) => {
    const header = session.header
    return `${session.id}\t${header.origin ?? 'main'}\t${header.delegationDepth ?? 0}\t${header.cwd ?? ''}`
  })
  return ['id\torigin\tdepth\tcwd', ...rows].join('\n')
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
