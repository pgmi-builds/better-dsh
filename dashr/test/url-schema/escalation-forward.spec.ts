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
 *
 * Regression (2026-09-06, v0.2.2-c): the URL-aware `write` wrapper must
 * RE-ADVERTISE the escalation fields in its own `parameters`. The wrapper
 * shadows the native write tool, and its schema declared only
 * `{file_path, content}` — so a schema-obedient model (GLM-5.3, prod session
 * 2026-09-06) never SENT `sandbox_permissions`/`justification` and looped on
 * plain denials, while the args passthrough itself was intact (identity
 * forward). The 09-03 fix covered edit's call-site drop; this closes write's
 * advertisement gap of the same symptom class.
 */

import { describe, expect, it } from 'vitest'

import { buildEditTool } from '../../src/url-schema/vendored/hashline/tool-edit.js'
import { createWriteTool } from '../../src/url-schema/tools/write.ts'

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

describe('write wrapper escalation advertisement + forwarding', () => {
  /** A native-write stub that records the args the wrapper delegated. */
  function capturingNativeWrite(captured: { args: Record<string, unknown> }) {
    return {
      execute: async (args: Record<string, unknown>) => {
        captured.args = { ...args }
        return { path: '/outside/workspace/out.md', operation: 'create', before: null, after: '' }
      },
    }
  }

  /** The escalation surface shape the registration passes (FsSandboxController subset). */
  const sandboxSurface = (modes: string[]) => ({
    escalationModes: modes,
    schemaFields: () => ({
      sandbox_permissions: {
        type: 'string',
        enum: [...modes],
        description: 'The wider sandbox mode this file operation needs.',
      },
      justification: { type: 'string', description: 'Why this operation needs the wider access.' },
    }),
  })

  it('advertises sandbox_permissions/justification in the compiled parameters under a confining backend', () => {
    const def = createWriteTool({ sandbox: sandboxSurface(['workspace-write', 'danger-full-access']) as never })
    const properties = (def.parameters as { properties: Record<string, { enum?: string[] }> }).properties
    expect(properties.sandbox_permissions?.enum).toEqual(['workspace-write', 'danger-full-access'])
    expect(properties.justification).toBeDefined()
  })

  it('omits the escalation fields when no confining backend is mounted (or no sandbox dep wired)', () => {
    for (const def of [
      createWriteTool({ sandbox: sandboxSurface([]) as never }),
      createWriteTool({}),
    ]) {
      const properties = (def.parameters as { properties: Record<string, unknown> }).properties
      expect(properties.sandbox_permissions).toBeUndefined()
      expect(properties.justification).toBeUndefined()
      // The core pair stays declared in every composition.
      expect(properties.file_path).toBeDefined()
      expect(properties.content).toBeDefined()
    }
  })

  it('forwards sandbox_permissions/justification verbatim to the delegated native write', async () => {
    const captured = { args: {} as Record<string, unknown> }
    const def = createWriteTool({ nativeWrite: capturingNativeWrite(captured) as never })

    const outcome = await def.execute(
      {
        file_path: '/outside/workspace/out.md',
        content: 'payload',
        sandbox_permissions: 'danger-full-access',
        justification: 'Writing outside the session workspace.',
      },
      {} as never,
    )

    expect(outcome).toMatchObject({ path: '/outside/workspace/out.md', operation: 'create' })
    expect(captured.args.sandbox_permissions).toBe('danger-full-access')
    expect(captured.args.justification).toBe('Writing outside the session workspace.')
    expect(captured.args.content).toBe('payload')
  })
})
