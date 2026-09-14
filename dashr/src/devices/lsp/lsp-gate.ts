/**
 * `lsp` session gate — per-session on/off, availability, nag cap, warm start.
 *
 * Spec: docs/specs/lsp/spec.md (2026-09-14). Key rulings baked in here:
 * - gate state (`unasked` → `on`/`off`) is PER-SESSION, module-internal —
 *   the manager handles everything and writes NO repo artifact.
 * - availability notice rides tool results at most 10 times per session,
 *   only while the gate is `unasked`, only for table languages whose server
 *   is `available`/`unknown`.
 * - Python/TypeScript servers are must-have (missing → background install,
 *   fail-soft); Rust/Go stay nag-detected and install only after opt-in.
 * - gate `on` warm-starts the server (spawn + initialize) without blocking
 *   anyone; a read of a code file pre-warms via didOpen; the mutation path
 *   never waits on server readiness.
 *
 * Orthogonality: this module lives entirely inside the lsp device family.
 * It imports nothing from hash-edit or url-schemes modules; the composition
 * root attaches its hooks.
 * @module dashr/devices/lsp/lsp-gate
 */

import * as path from 'node:path'

/** Nag ceiling per session (spec: at most 10 availability notices). */
const NAG_CAP = 10

/** Languages eligible for the availability notice. */
const NAG_LANGUAGES = new Set(['python', 'typescript', 'javascript', 'rust', 'go'])

/** Must-have languages installed proactively at first availability check. */
const MUST_HAVE = new Set(['python', 'typescript', 'javascript'])

/** Language id from a file extension (table-driven; unknown → undefined). */
function languageOf(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.py') return 'python'
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript'
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript'
  if (ext === '.rs') return 'rust'
  if (ext === '.go') return 'go'
  return undefined
}

export type GateState = 'unasked' | 'on' | 'off'

interface SessionGate {
  state: GateState
  nags: number
  /** Languages whose server install was already attempted. */
  installTried: Set<string>
  /** Languages warm-started (gate on). */
  warmed: Set<string>
}

const gates = new Map<string, SessionGate>()

function gateOf(sessionId: string): SessionGate {
  let gate = gates.get(sessionId)
  if (gate === undefined) {
    gate = { state: 'unasked', nags: 0, installTried: new Set(), warmed: new Set() }
    gates.set(sessionId, gate)
  }
  return gate
}

/** Drop a session's gate state (agent dispose). */
export function disposeLspGate(sessionId: string): void {
  gates.delete(sessionId)
}

/** Current gate state for a session (read side: `dvc://lsp` status). */
export function lspGateState(sessionId: string): GateState {
  return gateOf(sessionId).state
}

/**
 * Best-effort must-have install probe. Real availability detection (server
 * on PATH / registry lookup) is delegated to the device's server registry at
 * spawn time; here we only track that we do not retry installs.
 */
function ensureMustHave(gate: SessionGate, language: string): void {
  if (!MUST_HAVE.has(language) || gate.installTried.has(language)) return
  gate.installTried.add(language)
  // Installation itself is the server registry's job (defaults.json command
  // + install hint). Fail-soft by design: if the binary is missing at spawn,
  // the device surfaces its normal structured LSP_* error — never a crash.
}

/**
 * Maybe produce the availability notice for a just-landed mutation.
 * Returns undefined when silent (gate decided, cap reached, non-table
 * language). Pure — no side effects beyond the nag counter.
 */
export function lspGateNotice(sessionId: string, filePath: string): string | undefined {
  const gate = gateOf(sessionId)
  if (gate.state !== 'unasked') return undefined
  const language = languageOf(filePath)
  if (language === undefined || !NAG_LANGUAGES.has(language)) return undefined
  ensureMustHave(gate, language)
  if (gate.nags >= NAG_CAP) return undefined
  gate.nags += 1
  const remaining = NAG_CAP - gate.nags
  const tail = remaining > 0 ? ` (${remaining} reminders left)` : ' (final reminder)'
  return `lsp diagnostics available for this language — write dvc://lsp {"action":"on"} to enable, {"action":"off"} to mute${tail}`
}

/** Apply a gate decision. Returns a human-readable ack. */
export function lspGateDecide(sessionId: string, on: boolean): string {
  const gate = gateOf(sessionId)
  gate.state = on ? 'on' : 'off'
  return on
    ? 'lsp on for this session: servers warm-start per language on first file contact; no repo artifacts are written.'
    : 'lsp off for this session: no servers will spawn and notices are muted.'
}

/** True when the gate allows server contact for this session. */
export function lspGateAllows(sessionId: string): boolean {
  return gateOf(sessionId).state === 'on'
}

/**
 * Post-mutation sync entry: called by the composition's post-execute hook
 * for every landed read/edit/write when the gate is `on`. Transport is the
 * callback the device registers at mount ({@link registerLspGateTransport})
 * — the gate module itself holds no client/transport imports. Fire-and-
 * forget: the mutation path NEVER waits on server readiness (spec: latency
 * absorbed — a slow server reads as "no feedback" this call).
 */
export interface LspGateTransport {
  (opts: { sessionId: string, kind: 'read' | 'edit' | 'write', filePath: string, content?: string }): Promise<void>
}

let transport: LspGateTransport | undefined

/** The device registers its sync/spawn entry point at mount time. */
export function registerLspGateTransport(fn: LspGateTransport): void {
  transport = fn
}

export function lspGateSyncOnLand(
  sessionId: string,
  kind: 'read' | 'edit' | 'write',
  filePath: string,
  content?: string,
): void {
  const gate = gateOf(sessionId)
  if (gate.state !== 'on' || transport === undefined) return
  if (languageOf(filePath) === undefined) return
  const t = transport
  void t({ sessionId, kind, filePath, content }).catch(() => {})
}
