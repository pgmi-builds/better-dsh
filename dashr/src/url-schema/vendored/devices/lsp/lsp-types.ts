/**
 * Minimal LSP protocol + config types for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/lsp/types.ts,
 * MIT — see ../LICENSE-OMP.md), trimmed to the four supported actions
 * (diagnostics/definition/references/hover): position/range/location/diagnostic/
 * hover shapes, the defaults.json `ServerConfig` fields, JSON-RPC message
 * types, and the client state interface. Dropped: schema, symbol/rename/code-
 * action/edit types, linter-client plumbing, mux transport shapes.
 */

// =============================================================================
// Core LSP Protocol Types (0-based positions, as on the wire)
// =============================================================================

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface LocationLink {
  targetUri: string
  targetRange: Range
  targetSelectionRange: Range
}

// =============================================================================
// Diagnostics
// =============================================================================

export type DiagnosticSeverity = 1 | 2 | 3 | 4 // error, warning, info, hint

export interface Diagnostic {
  range: Range
  severity?: DiagnosticSeverity
  code?: number | string
  source?: string
  message: string
}

export interface PublishedDiagnostics {
  diagnostics: Diagnostic[]
  version: number | null
}

export interface PublishDiagnosticsParams {
  uri: string
  version?: number
  diagnostics: Diagnostic[]
}

// =============================================================================
// Hover
// =============================================================================

export interface MarkupContent {
  kind: string
  value: string
}

export interface Hover {
  contents: string | MarkupContent | { language: string; value: string } | unknown[]
  range?: Range
}

// =============================================================================
// Server Configuration (the subset of defaults.json entries the device reads)
// =============================================================================

export interface ServerConfig {
  command: string
  args?: string[]
  fileTypes: string[]
  rootMarkers: string[]
  /** LSP language identifier sent in didOpen; inferred from the file path when omitted. */
  languageId?: string
  initOptions?: Record<string, unknown>
  settings?: Record<string, unknown>
  /** If true, a linter/formatter server — deprioritized for type-intelligence actions. */
  isLinter?: boolean
}

// =============================================================================
// Client State (the vendored single-process client)
// =============================================================================

export interface OpenFile {
  version: number
  languageId: string
}

export interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  method: string
}

export interface LspClientState {
  /** Registry key: `<command>:<root>`. */
  name: string
  /** LSP workspace root the server was spawned with. */
  root: string
  config: ServerConfig
  requestId: number
  pendingRequests: Map<number, PendingRequest>
  openFiles: Map<string, OpenFile>
  diagnostics: Map<string, PublishedDiagnostics>
  /** Monotonic bump on every publishDiagnostics; gates stale-diagnostic waits. */
  diagnosticsVersion: number
  serverCapabilities?: Record<string, unknown>
  status: 'connecting' | 'ready' | 'error'
  /** Wall-clock ms when the client became ready (0 before) — gates cold-start retries. */
  readyAt: number
  lastActivity: number
  /** Serializes outbound JSON-RPC writes to the server's stdin. */
  writeQueue: Promise<void>
  /** Rearmed on every activity; fires the idle shutdown. */
  idleTimer: NodeJS.Timeout | undefined
  /** Active work-done progress tokens from the server ($/progress begin/end). */
  activeProgressTokens: Set<string | number>
  /** Resolves when initial project loading completes (progress drained or timed out). */
  projectLoaded: Promise<void>
  resolveProjectLoaded: () => void
}

// =============================================================================
// JSON-RPC Protocol Types
// =============================================================================

export interface LspJsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface LspJsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface LspJsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
