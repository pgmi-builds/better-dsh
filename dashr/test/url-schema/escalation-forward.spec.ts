/**
 * Regression (2026-09-03, v0.2.1f follow-up): the hashline `edit` tool MUST
 * forward the escalation arguments (`sandbox_permissions`/`justification`)
 * from the model's call into `sandbox.resolvePolicy`.
 *
 * The bug this pins: `tool-edit.js` re-built the args object as
 * `{ path, edits }` at the resolvePolicy call site, silently dropping the
 * escalation fields — so every escalated edit resolved to the standing
 * policy, the approval card NEVER fired (`approveEscalation` was unreachable),
 * and the model looped on the denial+hint marker: session 8e966430 on the
 * 4999 instance logged 8 identical escalated edits all denied with
 * `[sandbox: escalation available — retry …]` and zero `approval/asked`
 * events, while the same session's `write` escalation popped the card and
 * was approved (upstream tool-fs forwards the RAW args).
 *
 * `batch_edit` and `undo_last_edit` pass the normalized request through
 * (`contract.normalizeRequest` re-adds both fields), so `edit` was the single
 * broken call site.
 */

import { describe, expect, it } from 'vitest'

import { buildEditTool } from '../../src/url-schema/vendored/hashline/tool-edit.js'

interface ToolDef {
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** A stub sandbox controller that records what the tool call site forwards. */
function recordingSandbox(captured: { toolName: string; args: Record<string, unknown> }) {
  return {
    escalationModes: ['workspace-write', 'danger-full-access'],
    schemaFields: () => ({}),
    resolvePolicy: async (toolName: string, args: Record<string, unknown>) => {
      captured.toolName = toolName
      captured.args = { ...args }
      return { mode: 'workspace-write', workspaceRoot: '/tmp' }
    },
  }
}

/** A dummy io: execution aborts right after resolvePolicy, so it never runs. */
const dummyIo = {} as never

// The aborted signal stops execution at the abortIf immediately AFTER
// resolvePolicy, so the fs-mutation half never runs and the test needs no
// real io/fs surface — only the forwarding through the call site.
const abortedExec = { signal: AbortSignal.abort(), callId: 'call_regression', agent: undefined }

describe('hashline edit escalation forwarding', () => {
  it('forwards sandbox_permissions/justification into sandbox.resolvePolicy', async () => {
    const captured = { toolName: '', args: {} as Record<string, unknown> }
    const def = buildEditTool(dummyIo, recordingSandbox(captured) as never) as unknown as ToolDef

    await expect(def.execute(
      {
        path: '/outside/workspace/report.md',
        edits: [['aaa', 'aaa', 'replacement text']],
        sandbox_permissions: 'danger-full-access',
        justification: 'Editing a report outside the session workspace.',
      },
      abortedExec,
    )).rejects.toThrow(/aborted/i)

    expect(captured.toolName).toBe('edit')
    expect(captured.args.sandbox_permissions).toBe('danger-full-access')
    expect(captured.args.justification).toBe('Editing a report outside the session workspace.')
  })

  it('a call without escalation fields still reaches policy resolution (plain path intact)', async () => {
    const captured = { toolName: '', args: {} as Record<string, unknown> }
    const def = buildEditTool(dummyIo, recordingSandbox(captured) as never) as unknown as ToolDef

    await expect(def.execute(
      { path: '/outside/workspace/report.md', edits: [['aaa', 'aaa', 'replacement text']] },
      abortedExec,
    )).rejects.toThrow(/aborted/i)

    // Keys arrive as explicit undefined when the model sent none — the
    // controller's `=== undefined` checks treat that as absent; the test
    // above proves presence is preserved when the model sends them.
    expect(captured.toolName).toBe('edit')
    expect(captured.args.sandbox_permissions).toBeUndefined()
    expect(captured.args.justification).toBeUndefined()
  })
})
