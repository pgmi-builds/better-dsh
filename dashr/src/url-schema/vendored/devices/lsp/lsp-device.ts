/**
 * `dvc://lsp` device — LSP queries over vendored stdio language servers (Wave2).
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/lsp, MIT — see
 * ../LICENSE-OMP.md): the action contract (diagnostics/definition/references/
 * hover), server selection, and result normalization follow `src/lsp/tool.ts`
 * + `src/lsp/diagnostics.ts`; the client/registry live in the sibling vendored
 * modules. Trimmed vs upstream: single primary server per file (upstream fans
 * diagnostics out to every applicable server), one file per request (no
 * workspace-wide `*` mode), explicit `line`+`character` (upstream additionally
 * resolves a `symbol` column), and the LSP workspace root is the nearest
 * root-marker ancestor of the file (upstream always uses the session cwd).
 *
 * Actions (JSON args via `dispatchDvcWrite('dvc://lsp', ...)`):
 * - `{"action":"diagnostics","file":"x.ts"}` — open the file in the resolved
 *   server, wait for fresh publishDiagnostics, return them with a summary.
 * - `{"action":"definition","file","line","character"}` — `textDocument/
 *   definition` → normalized locations (`references` likewise; both include
 *   the declaration).
 * - `{"action":"hover","file","line","character"}` — `textDocument/hover` →
 *   extracted hover text.
 *
 * `line`/`character` are 1-based (editor convention) and converted to the
 * wire's 0-based positions; both default to 1. An explicit `"server"` picks a
 * named defaults.json entry, and `"command"`+`"args"` override the registry
 * lookup entirely (point the device at any stdio LSP server).
 *
 * TODO(upstream parity): rename / code_actions / reload / workspace `*`
 * diagnostics; multi-server diagnostics fan-out; documentDiagnostic pull.
 *
 * Servers spawn lazily on first execute, are reused per `<command>:<root>`,
 * and are reaped after the idle window. Every failure is a structured
 * {@link UrlSchemaError} (`LSP_*`); through the dispatcher these surface as
 * `DVC_DEVICE_ERROR` carrying the message.
 */

import { existsSync } from 'node:fs'
import * as path from 'node:path'

import { registerDvcDevice } from '../../../handlers/dvc.ts'
import type { DvcDevice } from '../../../handlers/dvc.ts'
import { UrlSchemaError } from '../../../selector.ts'
import {
  ensureFileOpen,
  fileToUri,
  getOrCreateClient,
  sendRequest,
  setIdleTimeoutMs,
  shutdownAllLspClients,
  uriToFile,
  waitForDiagnostics,
  waitForProjectLoaded,
} from './lsp-client.ts'
import type { Diagnostic, Hover, LspClientState, Location, LocationLink, ServerConfig } from './lsp-types.ts'
import {
  findWorkspaceRoot,
  installHintFor,
  primaryServerForFile,
  resolveCommandPath,
  serverByName,
} from './lsp-server-registry.ts'

const ACTIONS = new Set(['diagnostics', 'definition', 'references', 'hover'])

const SEVERITY_NAMES: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' }

/** Configure the idle-reaper window for every client (test seam; ms or null). */
export function setLspDeviceIdleTimeout(ms: number | null): void {
  setIdleTimeoutMs(ms)
}

/** Shut down every live language server (test teardown). */
export function shutdownLspDevice(): Promise<void> {
  return shutdownAllLspClients()
}

/** Uniform `unknown`-error rendering (mirrors the dvc dispatcher's helper). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Assert the args payload is a plain JSON object and return it as a record. */
function requireObjectArgs(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    const shape = args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args
    throw new UrlSchemaError(
      'LSP_BAD_ARGS',
      `lsp device: args must be a JSON object with an "action" ("diagnostics" | "definition" | "references" | "hover"), got ${shape}`,
    )
  }
  return args as Record<string, unknown>
}

/** Resolve the request's server config: named `server` → `command` override → file-type lookup. */
function resolveServerConfig(args: Record<string, unknown>, filePath: string): { name: string; config: ServerConfig } {
  const server = args.server
  if (server !== undefined) {
    if (typeof server !== 'string' || server === '') {
      throw new UrlSchemaError('LSP_BAD_ARGS', 'lsp device: "server" must be a non-empty server name')
    }
    const config = serverByName(server)
    if (config === undefined) {
      throw new UrlSchemaError('LSP_NO_SERVER', `lsp device: no defaults.json entry named "${server}"`)
    }
    return { name: server, config }
  }

  const command = args.command
  if (command !== undefined) {
    if (typeof command !== 'string' || command === '') {
      throw new UrlSchemaError('LSP_BAD_ARGS', 'lsp device: "command" override must be a non-empty string')
    }
    const commandArgs = args.args
    if (commandArgs !== undefined && (!Array.isArray(commandArgs) || commandArgs.some(a => typeof a !== 'string'))) {
      throw new UrlSchemaError('LSP_BAD_ARGS', 'lsp device: "args" override must be an array of strings')
    }
    return {
      name: command,
      config: {
        command,
        args: commandArgs as string[] | undefined,
        fileTypes: [],
        rootMarkers: [],
      },
    }
  }

  const primary = primaryServerForFile(filePath)
  if (primary === null) {
    throw new UrlSchemaError(
      'LSP_NO_SERVER',
      `lsp device: no defaults.json language server covers "${path.basename(filePath)}" — pass "server" or "command"/"args" to pick one explicitly`,
    )
  }
  return { name: primary[0], config: primary[1] }
}

/** 1-based `line`/`character` args → validated positive integers (default 1). */
function requirePosition(args: Record<string, unknown>): { line: number; character: number } {
  const read = (field: string): number => {
    const value = args[field]
    if (value === undefined) return 1
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new UrlSchemaError(
        'LSP_BAD_ARGS',
        `lsp device: "${field}" must be a 1-based positive integer (got ${JSON.stringify(value ?? null)})`,
      )
    }
    return value
  }
  return { line: read('line'), character: read('character') }
}

/**
 * Lazy server lifecycle: resolve the binary (structured miss with an install
 * hint), find the workspace root, get-or-create the reused client. The heavy
 * work (spawn + initialize handshake) happens on first execute per
 * `<command>:<root>` and is cached by the client registry.
 */
async function obtainClient(args: Record<string, unknown>, filePath: string): Promise<{ name: string; client: LspClientState }> {
  const { name, config } = resolveServerConfig(args, filePath)

  const resolvedCommand = resolveCommandPath(config.command, path.dirname(filePath))
  if (resolvedCommand === null) {
    throw new UrlSchemaError(
      'LSP_SERVER_MISSING',
      `lsp device: language server binary "${config.command}" not found (server "${name}") — ${installHintFor(config.command)}`,
    )
  }

  const root = findWorkspaceRoot(filePath, config.rootMarkers) ?? path.dirname(path.resolve(filePath))

  let client: LspClientState
  try {
    client = await getOrCreateClient(config, root, resolvedCommand)
  } catch (error) {
    throw new UrlSchemaError(
      'LSP_INIT_FAILED',
      `lsp device: language server "${name}" (${config.command}) failed to initialize: ${messageOf(error)}`,
    )
  }
  return { name, client }
}

/** `Location | LocationLink` result → normalized 1-based location records (upstream normalizeLocationResult). */
function normalizeLocations(result: unknown): Array<{ uri: string; path: string; line: number; character: number; endLine: number; endCharacter: number }> {
  const raw = Array.isArray(result) ? result : result === null || result === undefined ? [] : [result]
  const locations: Location[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    if ('uri' in item) {
      locations.push(item as Location)
    } else if ('targetUri' in item) {
      const link = item as LocationLink
      locations.push({ uri: link.targetUri, range: link.targetSelectionRange ?? link.targetRange })
    }
  }
  return locations.map(location => ({
    uri: location.uri,
    path: uriToFile(location.uri),
    line: location.range.start.line + 1,
    character: location.range.start.character + 1,
    endLine: location.range.end.line + 1,
    endCharacter: location.range.end.character + 1,
  }))
}

/** Extract plain text from hover contents (upstream utils.ts extractHoverText). */
function extractHoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(item => extractHoverText(item)).join('\n\n')
  if (typeof contents === 'object' && contents !== null && 'value' in contents) {
    const value = (contents as { value: unknown }).value
    if (typeof value === 'string') return value
  }
  return String(contents)
}

/** Diagnostic → 1-based JSON-safe record with a severity name (upstream severityToString). */
interface DiagnosticRecord {
  severity: number
  severityName: string
  line: number
  character: number
  endLine: number
  endCharacter: number
  message: string
  code?: number | string
  source?: string
}

function diagnosticRecord(diagnostic: Diagnostic): DiagnosticRecord {
  return {
    severity: diagnostic.severity ?? 1,
    severityName: SEVERITY_NAMES[diagnostic.severity ?? 1] ?? 'unknown',
    line: diagnostic.range.start.line + 1,
    character: diagnostic.range.start.character + 1,
    endLine: diagnostic.range.end.line + 1,
    endCharacter: diagnostic.range.end.character + 1,
    message: diagnostic.message,
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
    ...(diagnostic.source !== undefined ? { source: diagnostic.source } : {}),
  }
}

/** Compact "2 error(s), 1 warning(s)" summary (upstream formatDiagnosticsSummary shape). */
function diagnosticsSummary(records: Array<{ severityName: string }>): string {
  const counts = new Map<string, number>()
  for (const record of records) counts.set(record.severityName, (counts.get(record.severityName) ?? 0) + 1)
  const parts: string[] = []
  for (const name of ['error', 'warning', 'info', 'hint']) {
    const count = counts.get(name)
    if (count !== undefined) parts.push(`${count} ${name}(s)`)
  }
  return parts.length > 0 ? parts.join(', ') : 'no diagnostics'
}

/** Cold-start retry budget for empty position results (upstream references-retry shape, device-side bound). */
const COLD_START_RETRY_WINDOW_MS = 5_000
const COLD_START_RETRY_DELAY_MS = 400

/**
 * Run one action request against the client, wrapping transport/protocol
 * failures as `LSP_REQUEST_FAILED` with the method context. When
 * `retryWhileEmpty` is set (project-aware servers) and the client just became
 * ready, empty results are retried briefly: some servers (rust-analyzer on a
 * cold crate) answer immediately with empty results while their index is
 * still building, with no protocol signal for readiness — upstream handles
 * this with its references retry loop + rust-analyzer workspace polling,
 * neither of which is vendored.
 */
async function lspPositionRequest(
  client: LspClientState,
  method: string,
  params: unknown,
  retryWhileEmpty: boolean,
): Promise<unknown> {
  for (;;) {
    let result: unknown
    try {
      result = await sendRequest(client, method, params)
    } catch (error) {
      // rust-analyzer cancels in-flight queries with -32801 (content
      // modified) while its index settles after didOpen; treat cancel-family
      // codes as "empty" for the cold-start retry loop instead of failing.
      const message = messageOf(error)
      const retryable = retryWhileEmpty && /-3280[01]/.test(message) && Date.now() - client.readyAt <= COLD_START_RETRY_WINDOW_MS
      if (!retryable) {
        throw new UrlSchemaError(
          'LSP_REQUEST_FAILED',
          `lsp device: ${method} failed on ${client.config.command}: ${message}`,
        )
      }
      await new Promise(resolve => setTimeout(resolve, COLD_START_RETRY_DELAY_MS))
      continue
    }
    if (!retryWhileEmpty) return result
    if (!isEmptyPositionResult(result)) return result
    if (Date.now() - client.readyAt > COLD_START_RETRY_WINDOW_MS) return result
    await new Promise(resolve => setTimeout(resolve, COLD_START_RETRY_DELAY_MS))
  }
}

/** Whether an LSP position result carries no information (null/[]/blank hover). */
function isEmptyPositionResult(result: unknown): boolean {
  if (result === null || result === undefined) return true
  if (Array.isArray(result)) return result.length === 0
  if (typeof result === 'object' && 'contents' in result) {
    const contents = (result as { contents: unknown }).contents
    if (contents === null || contents === undefined) return true
    if (typeof contents === 'string') return contents.trim() === ''
  }
  return false
}


/** The `dvc://lsp` device: dispatch on `action`, structured errors on every bad path. */
const lspDevice: DvcDevice = {
  async execute(args: unknown): Promise<unknown> {
    const record = requireObjectArgs(args)
    const action = record.action
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      throw new UrlSchemaError(
        'LSP_BAD_ARGS',
        `lsp device: unknown action ${JSON.stringify(action ?? null)} — expected "diagnostics", "definition", "references", or "hover"`,
      )
    }

    const file = record.file
    if (typeof file !== 'string' || file === '') {
      throw new UrlSchemaError('LSP_BAD_ARGS', 'lsp device: this action requires a non-empty "file" string')
    }
    const filePath = path.resolve(file)
    if (!existsSync(filePath)) {
      throw new UrlSchemaError('LSP_BAD_ARGS', `lsp device: file not found: ${filePath}`)
    }

    const position = requirePosition(record)
    const { name, client } = await obtainClient(record, filePath)
    const base = { ok: true as const, server: name, file: filePath, root: client.root }
    const uri = fileToUri(filePath)
    const wirePosition = { line: position.line - 1, character: position.character - 1 }

    await ensureFileOpen(client, filePath)

    // Project-aware servers answer position queries with empty results until
    // their initial index is built; upstream gates the indexed actions on
    // waitForProjectLoaded — the device gates every position action (hover
    // needs it just as much on cold rust-analyzer).
    if (action !== 'diagnostics' && client.config.isLinter !== true) {
      await waitForProjectLoaded(client)
    }
    const retryCold = action !== 'diagnostics' && client.config.isLinter !== true

    switch (action) {
      case 'diagnostics': {
        const minVersion = client.diagnosticsVersion
        const diagnostics = await waitForDiagnostics(client, uri, { minVersion })
        const records = diagnostics.map(diagnosticRecord)
        return { ...base, diagnostics: records, summary: diagnosticsSummary(records) }
      }
      case 'definition': {
        const result = await lspPositionRequest(client, 'textDocument/definition', {
          textDocument: { uri },
          position: wirePosition,
        }, retryCold)
        return { ...base, position, locations: normalizeLocations(result) }
      }
      case 'references': {
        const result = await lspPositionRequest(client, 'textDocument/references', {
          textDocument: { uri },
          position: wirePosition,
          context: { includeDeclaration: true },
        }, retryCold)
        return { ...base, position, locations: normalizeLocations(result) }
      }
      case 'hover': {
        const result = (await lspPositionRequest(client, 'textDocument/hover', {
          textDocument: { uri },
          position: wirePosition,
        }, retryCold)) as Hover | null
        const text = result === null || result === undefined ? '' : extractHoverText(result.contents)
        return { ...base, position, text }
      }
      default:
        // Unreachable: ACTIONS gate above.
        throw new UrlSchemaError('LSP_BAD_ARGS', `lsp device: unhandled action "${String(action)}"`)
    }
  },
  summary:
    'LSP queries over stdio language servers (defaults.json registry) — diagnostics / definition / references / hover on {file,line,character}',
}

/** Registry seam: any `(name, device)` receiver; defaults to the dvc:// module registry. */
export type DvcRegistrar = (name: string, device: DvcDevice) => void

/**
 * Mount the lsp device. `registry` defaults to the dvc:// module-level registry
 * (`registerDvcDevice`); tests may pass their own recorder instead.
 */
export function installLspDevices(registry: DvcRegistrar = registerDvcDevice): void {
  registry('lsp', lspDevice)
}
