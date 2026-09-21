#!/usr/bin/env node
/**
 * Best-effort kernel provisioning entry — the single code path behind BOTH
 * `postinstall` and `npm run kernel:venv`.
 *
 * Fail-open by design (2026-09-03 ruling): any failure logs a remedy hint and
 * exits 0. The installation must NEVER fail because the kernel could not be
 * provisioned here — the daemon spin-up check (primary path) and first-use
 * lazy provisioning (final fallback) complete the three-trigger ladder.
 */
import { access } from 'node:fs/promises'

const libUrl = new URL('../lib/kernel-env.js', import.meta.url)

try {
  await access(libUrl)
} catch {
  // Dev checkout before the first build, or a pruned install: nothing to call.
  console.log('[dashr] kernel-env build output not present yet — skipping install-time pre-provision (the daemon spin-up check will provision on start)')
  process.exit(0)
}

const { resolveKernelEnv } = await import(libUrl)

try {
  const env = await resolveKernelEnv({
    autoInstall: true,
    log: (level, message) => console[level === 'warn' ? 'warn' : 'log'](`[dashr] ${message}`),
  })
  console.log(`[dashr] kernel ready: python ${env.version} at ${env.python}${env.dill ? '' : ' (dill missing — snapshots disabled)'}`)
} catch (error) {
  console.warn(`[dashr] kernel pre-provision failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`)
  console.warn('[dashr] remedies: run "npm run kernel:venv" in the dashr package; or rely on the daemon spin-up check / first-use auto-install; or set python to a prepared interpreter')
  process.exit(0)
}
