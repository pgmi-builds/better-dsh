/**
 * Post-execute reminder hooks (change 2026-09-26-lsp-ast-reminder).
 *
 * Drives the real `tools/post-execute` listener installed by apply() against
 * a fake agent scope and asserts the suffix-appending contract end to end:
 * LSP nag (gate semantics untouched) + AST reminder (new, gate-independent,
 * every matching result) compose onto one accept decision; errors and
 * non-accept decisions stay untouched. apply() runs ONCE — the vendored dvc
 * device registry is module-global, so re-apply would double-register; the
 * lsp gate is reset per test via its session id instead.
 */

import { describe, expect, it } from 'vitest'

import plugin from '../../src/url-schemes/index.ts'
import { disposeAstReminders } from '../../src/devices/ast/ast-reminder.ts'
import { disposeLspGate } from '../../src/devices/lsp/lsp-gate.ts'

interface RecordedListener {
  (exec: { name: string, arguments?: unknown }, result: { isError?: boolean, content?: Array<{ type: string, text?: string }> }, next: () => Promise<unknown>): Promise<unknown>
}

const AGENT_ID = 'pe-reminders-agent'
const content = (...texts: string[]) => texts.map(text => ({ type: 'text', text }))

describe('post-execute reminders', () => {
  let postExecute: RecordedListener

  it('bootstraps the plugin once and exposes the composed listener', async () => {
    let onAgentCreated: ((payload: { agent: unknown }) => void) | undefined
    const rootCtx = {
      on: (evt: string, cb: (payload: { agent: unknown }) => void) => {
        if (evt === 'agent/created') onAgentCreated = cb
      },
      logger: () => ({ warn: () => {} }),
      skills: { get: async () => undefined },
      fs: {
        resolve: async (p: string) => ({ displayPath: p }),
        readText: async () => 'fn landed() {}\n',
        processPath: (target: unknown) => target,
        writeText: async () => ({ operation: 'create' }),
      },
      sessions: { list: () => [], get: () => undefined },
      subagents: { listChildren: async () => [] },
      settings: {},
      agents: { get: () => undefined },
      tools: {
        schemas: () => ['write', 'grep', 'glob'].map(name => ({ name })),
        get: (name: string) => ({ name, execute: async () => ({}) }),
        register: () => () => {},
      },
    } as unknown as Parameters<typeof plugin.apply>[0]

    plugin.apply(rootCtx, undefined)

    const listeners = new Map<string, RecordedListener>()
    const agent = {
      id: AGENT_ID,
      ctx: {
        effect: (fn: () => unknown) => fn(),
        on: (evt: string, cb: never) => {
          listeners.set(evt, cb as RecordedListener)
          return () => {}
        },
        tools: { register: () => () => {} },
      },
    }
    onAgentCreated!({ agent })
    // The agent effect is async (installHashline awaits): the LAST
    // tools/post-execute registration is the composed lsp+ast hook, and it
    // lands a microtask later — flush before grabbing it.
    await new Promise((r) => setTimeout(r, 0))
    postExecute = listeners.get('tools/post-execute')!
    expect(postExecute, 'post-execute listener must be installed').toBeDefined()
  })

  it('grep over a directory appends exactly the AST line', async () => {
    disposeLspGate(AGENT_ID)
    disposeAstReminders(AGENT_ID)
    const out = await postExecute(
      { name: 'grep', arguments: { path: '/repo/src' } },
      { isError: false, content: content('3 matched lines') },
      () => Promise.resolve({ kind: 'accept' }),
    ) as { content?: Array<{ type: string, text?: string }> }
    expect(out.content!.map(block => block.text)).toEqual([
      '3 matched lines',
      expect.stringContaining('dvc://ast_grep'),
    ])
  })

  it('write on a python file appends the LSP nag then the AST line', async () => {
    disposeLspGate(AGENT_ID)
    disposeAstReminders(AGENT_ID)
    const out = await postExecute(
      { name: 'write', arguments: { file_path: '/repo/a.py' } },
      { isError: false, content: content('Created file') },
      () => Promise.resolve({ kind: 'accept' }),
    ) as { content?: Array<{ type: string, text?: string }> }
    const texts = out.content!.map(block => block.text)
    expect(texts[0]).toBe('Created file')
    expect(texts[1]).toContain('lsp diagnostics available')
    expect(texts[2]).toContain('dvc://ast_edit')
  })

  it('write on a non-code file leaves the accept decision bare', async () => {
    const out = await postExecute(
      { name: 'write', arguments: { path: '/repo/x.md' } },
      { isError: false, content: content('Created file') },
      () => Promise.resolve({ kind: 'accept' }),
    )
    expect(out).toEqual({ kind: 'accept' })
  })

  it('error results are never touched', async () => {
    const out = await postExecute(
      { name: 'write', arguments: { path: '/repo/a.py' } },
      { isError: true, content: content('boom') },
      () => Promise.resolve({ kind: 'accept' }),
    )
    expect(out).toEqual({ kind: 'accept' })
  })

  it('non-accept decisions pass through unmutated', async () => {
    disposeLspGate(AGENT_ID)
    disposeAstReminders(AGENT_ID)
    const blocked = { kind: 'block', feedback: content('no') }
    const out = await postExecute(
      { name: 'write', arguments: { path: '/repo/a.py' } },
      { isError: false, content: [] },
      () => Promise.resolve(blocked),
    )
    expect(out).toBe(blocked)
  })
})
