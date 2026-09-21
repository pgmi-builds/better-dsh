import { describe, expect, it } from 'vitest'
import { isFlatBindableName } from '../src/py-sdk.ts'

describe('isFlatBindableName — the one binding-name policy (the SDK renderers are gone; the wire catalog is the only catalog)', () => {
  it('accepts the flat seam: plain identifiers and __-infixed names alike', () => {
    for (const name of ['echo', 'read', 'agent_message', 'llm_completion', 'web_search', 'mcp__server__tool']) {
      expect(isFlatBindableName(name)).toBe(true)
    }
  })

  it('rejects non-flat names (hyphens), underscore-leading names, reserved words, and seam globals', () => {
    for (const name of ['hyphen-tool', 'mcp__srv__tool-name', '_private', '__dunder__', 'for', 'class', 'type', 'match', 'console']) {
      expect(isFlatBindableName(name)).toBe(false)
    }
  })
})
