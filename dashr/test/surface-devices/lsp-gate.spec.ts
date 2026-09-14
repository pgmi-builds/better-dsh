/**
 * lsp gate + stage-1 action surface (spec docs/specs/lsp/spec.md).
 *
 * Unit-level: gate state machine (unasked → on/off, 10-nag cap, per-session
 * isolation, no-repo-artifact by construction) and the device's gate action
 * arg validation (session injection contract). Server-contact paths are
 * covered by lsp-device.spec.ts with the fake stdio server.
 */

import { describe, expect, it } from 'vitest'

import {
  disposeLspGate,
  lspGateAllows,
  lspGateDecide,
  lspGateNotice,
  lspGateState,
  lspGateSyncOnLand,
  registerLspGateTransport,
} from '../../src/devices/lsp/lsp-gate.ts'

describe('lsp gate state machine', () => {
  it('starts unasked, nags at most 10 times, then goes silent', () => {
    disposeLspGate('s1')
    expect(lspGateState('s1')).toBe('unasked')
    let nags = 0
    for (let i = 0; i < 15; i++) {
      if (lspGateNotice('s1', '/repo/a.py') !== undefined) nags++
    }
    expect(nags).toBe(10)
    // Further mutations stay silent without a decision.
    expect(lspGateNotice('s1', '/repo/b.ts')).toBeUndefined()
    disposeLspGate('s1')
  })

  it('deciding on/off mutes the notice immediately and is per-session', () => {
    disposeLspGate('s2a')
    disposeLspGate('s2b')
    expect(lspGateDecide('s2a', true)).toContain('lsp on')
    expect(lspGateState('s2a')).toBe('on')
    expect(lspGateAllows('s2a')).toBe(true)
    // Session b is a different session — still unasked.
    expect(lspGateState('s2b')).toBe('unasked')
    expect(lspGateNotice('s2a', '/repo/a.py')).toBeUndefined()
    expect(lspGateDecide('s2b', false)).toContain('lsp off')
    expect(lspGateState('s2b')).toBe('off')
    disposeLspGate('s2a')
    disposeLspGate('s2b')
  })

  it('only nags for table languages', () => {
    disposeLspGate('s3')
    expect(lspGateNotice('s3', '/repo/readme.md')).toBeUndefined()
    expect(lspGateState('s3')).toBe('unasked')
    disposeLspGate('s3')
  })

  it('sync is fire-and-forget: off gate never calls the transport', async () => {
    disposeLspGate('s4')
    let calls = 0
    registerLspGateTransport(async () => { calls++ })
    lspGateSyncOnLand('s4', 'edit', '/repo/a.ts')
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(0)
    lspGateDecide('s4', true)
    lspGateSyncOnLand('s4', 'edit', '/repo/a.ts')
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toBe(1)
    disposeLspGate('s4')
  })
})

describe('dvc://lsp gate actions', () => {
  it('gate ack messages name the decision', () => {
    disposeLspGate('s5')
    expect(lspGateDecide('s5', true)).toMatch(/on/)
    disposeLspGate('s5')
    expect(lspGateDecide('s5', false)).toMatch(/off/)
    disposeLspGate('s5')
  })
})
