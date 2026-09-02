import { describe, expect, it } from 'vitest'
import {
  DILL_VERSION,
  IPYKERNEL_VERSION,
  pipInstallArgs,
  uvInstallArgs,
  uvToolEnv,
  uvVenvArgs,
  venvFallbackArgs,
} from '../src/kernel-env.ts'

describe('kernel provisioning commands (pinned versions + cache redirection)', () => {
  it('pins ipykernel and dill in both install paths', () => {
    for (const args of [uvInstallArgs('/pkg/.venv-kernel/bin/python'), pipInstallArgs()]) {
      expect(args).toContain(`ipykernel==${IPYKERNEL_VERSION}`)
      expect(args).toContain(`dill==${DILL_VERSION}`)
    }
  })

  it('redirects uv caches next to the venv so a read-only home cannot block provisioning', () => {
    const env = uvToolEnv('/pkg/.venv-kernel')
    expect(env.UV_CACHE_DIR).toBe('/pkg/.uv-cache')
    expect(env.UV_PYTHON_INSTALL_DIR).toBe('/pkg/.uv-cache/python')
    expect(env.UV_LINK_MODE).toBe('copy')
  })

  it('keeps the python3-venv fallback cache-free and shapes uv venv args', () => {
    expect(venvFallbackArgs('/pkg/.venv-kernel')).toEqual(['-m', 'venv', '/pkg/.venv-kernel'])
    expect(uvVenvArgs('/pkg/.venv-kernel', '3.11')).toEqual(['venv', '/pkg/.venv-kernel', '--python', '3.11'])
  })
})
