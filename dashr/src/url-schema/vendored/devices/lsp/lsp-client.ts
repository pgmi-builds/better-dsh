/**
 * Minimal LSP client for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/lsp/client.ts,
 * MIT — see ../LICENSE-OMP.md), rewritten thin on Node `child_process`:
 * the JSON-RPC loop, request/response correlation, `initialize` →
 * `initialized` → `didChangeConfiguration` handshake, `didOpen` tracking,
 * publishDiagnostics capture, the publish-settle diagnostics wait, graceful
 * `shutdown`/`exit` teardown, client reuse keyed `<command>:<root>` with an
 * init lock + failure backoff, $/progress project-load tracking, and the idle
 * reaper. Deliberately NOT vendored (host-coupled or out of scope): ptree/Bun
 * transports, the LSP mux daemon (broker-shared servers), rust-analyzer
 * workspace-ready polling, watched-files notifications, workspace-edit
 * application, writethrough/linter clients, the textDocument/diagnostic pull,
 * and abort-signal plumbing (the device uses plain per-request timeouts).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'
import { type Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { MessageFramer } from './lsp-jsonrpc.ts'
import { detectLanguageId } from './lsp-language.ts'
import type {
  Diagnostic,
  LspClientState,
  LspJsonRpcNotification,
  LspJsonRpcRequest,
  LspJsonRpcResponse,
  PublishDiagnosticsParams,
  ServerConfig,
} from './lsp-types.ts'

// =============================================================================
// Constants (upstream client.ts values)
// =============================================================================

/** Default per-request timeout when no explicit budget is given (upstream 30s). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** Max time to wait for the `initialize` response (upstream WARMUP/init budget). */
const INIT_TIMEOUT_MS = 30_000
/** Max time to wait for graceful LSP shutdown and process exit (upstream 5s/1s). */
const SHUTDOWN_TIMEOUT_MS = 5_000
const EXIT_TIMEOUT_MS = 1_000
/** Negative cache of recent init failures so a broken server fails fast (upstream 3min). */
const INIT_FAILURE_BACKOFF_MS = 3 * 60 * 1000
/** Diagnostics wait: poll interval and publish-settle window (upstream values). */
const DIAGNOSTICS_POLL_MS = 50
const DIAGNOSTICS_SETTLE_MS = 250
/** Default diagnostics wait budget (upstream single-file budget, widened for cold real servers). */
const DIAGNOSTICS_WAIT_MS = 10_000
/** Auto-resolve budget for project loading (upstream PROJECT_LOAD_TIMEOUT_MS). */
const PROJECT_LOAD_TIMEOUT_MS = 15_000
/**
 * Grace window after the handshake for servers that never report progress:
 * omp absorbs the full 15s budget in session warmup; a device cannot, so a
 * progress-less server is treated as loaded once this window passes.
 */
const PROJECT_LOAD_GRACE_MS = 750
/** Default idle reaper window; override via {@link setIdleTimeoutMs}. */
const DEFAULT_IDLE_TIMEOUT_MS = 120_000

// =============================================================================
// URI helpers (upstream utils.ts fileToUri/uriToFile, Node impl)
// =============================================================================

/** Convert a file path to a `file://` URI (upstream utils.ts). */
export function fileToUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).href
}

/** Convert a `file://` URI back to a path; tolerates lax raw-path servers. */
export function uriToFile(uri: string): string {
  try {
    return fileURLToPath(uri)
  } catch {
    return uri.startsWith('file://') ? uri.slice('file://'.length) : uri
  }
}

// =============================================================================
// Client capabilities (upstream CLIENT_CAPABILITIES, trimmed to the 4 actions)
// =============================================================================

const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: {
      didSave: true,
      dynamicRegistration: false,
      willSave: false,
      willSaveWaitUntil: false,
    },
    hover: { contentFormat: ['markdown', 'plaintext'], dynamicRegistration: false },
    definition: { dynamicRegistration: false, linkSupport: true },
    references: { dynamicRegistration: false },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: true,
      tagSupport: { valueSet: [1, 2] },
      codeDescriptionSupport: true,
      dataSupport: true,
    },
    diagnostic: { dynamicRegistration: true },
  },
  window: { workDoneProgress: true },
  workspace: {
    configuration: true,
    workspaceFolders: true,
  },
} as const

// =============================================================================
// Client registry (upstream clients/clientLocks/initFailures maps)
// =============================================================================

const clients = new Map<string, LspClientState>()
const clientLocks = new Map<string, Promise<LspClientState>>()
const initFailures = new Map<string, { at: number; message: string }>()

/** Idle reaper window for every client; null disables (upstream defaults off). */
let idleTimeoutMs: number | null = DEFAULT_IDLE_TIMEOUT_MS

/** Configure the idle reaper window (null disables); test seam. */
export function setIdleTimeoutMs(ms: number | null): void {
  idleTimeoutMs = ms
}

// =============================================================================
// Spawn bookkeeping + write path (upstream writeMessage/queueWriteMessage)
// =============================================================================

/** Per-client spawn bookkeeping kept outside the state interface (proc, stderr tail). */
interface SpawnedProcess {
  proc: ChildProcess
  stderrTail: string
  exitCode: number | null
  exited: Promise<number>
}

const spawned = new WeakMap<LspClientState, SpawnedProcess>()

/** Activity touch: bump `lastActivity` and rearm the idle timer (upstream lastActivity). */
function touch(client: LspClientState): void {
  client.lastActivity = Date.now()
  clearTimeout(client.idleTimer)
  if (idleTimeoutMs !== null) {
    client.idleTimer = setTimeout(() => {
      void shutdownClientInstance(client)
    }, idleTimeoutMs)
    client.idleTimer.unref()
  }
}

function writeMessage(
  client: LspClientState,
  message: LspJsonRpcRequest | LspJsonRpcNotification | LspJsonRpcResponse,
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const stdin: Writable | undefined = spawned.get(client)?.proc.stdin ?? undefined
  if (stdin === undefined || stdin.destroyed) {
    reject(new Error(`LSP server ${client.name} stdin is closed`))
    return promise
  }
  const content = JSON.stringify(message)
  stdin.write(`Content-Length: ${Buffer.byteLength(content, 'utf-8')}\r\n\r\n${content}`, error => {
    if (error !== undefined && error !== null) reject(error)
    else resolve()
  })
  return promise
}

function queueWriteMessage(
  client: LspClientState,
  message: LspJsonRpcRequest | LspJsonRpcNotification | LspJsonRpcResponse,
): Promise<void> {
  const write = client.writeQueue.catch(() => {}).then(() => writeMessage(client, message))
  client.writeQueue = write.catch(() => {})
  return write
}

function killClient(client: LspClientState): void {
  try {
    spawned.get(client)?.proc.kill()
  } catch {
    // already gone — the exit handler finishes cleanup
  }
}

// =============================================================================
// Client lifecycle (upstream getOrCreateClient core)
// =============================================================================

/**
 * Get or create an LSP client for `config` rooted at `root`. `resolvedCommand`
 * is the probed absolute binary path. Reuses a live client, coalesces
 * concurrent inits through a lock, fails fast inside the init-failure backoff
 * window, and performs the full initialize handshake before publishing the
 * client.
 */
export async function getOrCreateClient(
  config: ServerConfig,
  root: string,
  resolvedCommand: string,
): Promise<LspClientState> {
  const key = `${config.command}:${root}`

  const existing = clients.get(key)
  if (existing !== undefined) {
    touch(existing)
    return existing
  }

  const existingLock = clientLocks.get(key)
  if (existingLock !== undefined) return existingLock

  const recentFailure = initFailures.get(key)
  if (recentFailure !== undefined) {
    if (Date.now() - recentFailure.at < INIT_FAILURE_BACKOFF_MS) {
      throw new Error(`LSP server ${config.command} failed to initialize recently: ${recentFailure.message}`)
    }
    initFailures.delete(key)
  }

  const clientPromise = (async () => {
    const proc = spawn(resolvedCommand, config.args ?? [], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    const record: SpawnedProcess = {
      proc,
      stderrTail: '',
      exitCode: null,
      exited: new Promise<number>(resolve => {
        proc.once('exit', code => {
          record.exitCode = code ?? -1
          resolve(record.exitCode)
        })
        proc.once('error', err => {
          record.exitCode = -1
          record.stderrTail = record.stderrTail || String(err)
          resolve(record.exitCode)
        })
      }),
    }

    proc.stderr?.on('data', (chunk: Buffer) => {
      record.stderrTail = (record.stderrTail + chunk.toString('utf-8')).slice(-4000)
    })

    // Project-load promise (upstream projectLoaded): resolves when the
    // server's $/progress stream drains, auto-resolves after the upstream 15s
    // budget, or after the progress-less grace window (device-side; omp
    // absorbs this wait in session warmup).
    const { promise: projectLoaded, resolve: resolveProjectLoaded } = Promise.withResolvers<void>()
    const projectLoadTimeout = setTimeout(resolveProjectLoaded, PROJECT_LOAD_TIMEOUT_MS)
    projectLoadTimeout.unref()

    const client: LspClientState = {
      name: key,
      root,
      config,
      requestId: 0,
      pendingRequests: new Map(),
      openFiles: new Map(),
      diagnostics: new Map(),
      diagnosticsVersion: 0,
      status: 'connecting',
      readyAt: 0,
      lastActivity: Date.now(),
      writeQueue: Promise.resolve(),
      idleTimer: undefined,
      activeProgressTokens: new Set(),
      projectLoaded,
      resolveProjectLoaded: () => {
        clearTimeout(projectLoadTimeout)
        resolveProjectLoaded()
      },
    }
    spawned.set(client, record)

    // Crash recovery: evict on process exit and reject anything pending
    // (upstream proc.exited.then block).
    void record.exited.then(() => {
      if (clients.get(key) === client) clients.delete(key)
      const stderr = record.stderrTail.trim()
      const err = new Error(
        stderr !== ''
          ? `LSP server exited (code ${record.exitCode}): ${stderr}`
          : `LSP server exited unexpectedly (code ${record.exitCode})`,
      )
      for (const pending of client.pendingRequests.values()) pending.reject(err)
      client.pendingRequests.clear()
      client.resolveProjectLoaded()
      clearTimeout(client.idleTimer)
    })

    startMessageReader(client)

    try {
      const initResult = (await sendRequest(
        client,
        'initialize',
        {
          processId: process.pid,
          rootUri: fileToUri(root),
          rootPath: root,
          capabilities: CLIENT_CAPABILITIES,
          initializationOptions: config.initOptions ?? {},
          workspaceFolders: [{ uri: fileToUri(root), name: path.basename(root) || 'workspace' }],
        },
        INIT_TIMEOUT_MS,
      )) as { capabilities?: unknown } | null

      if (initResult === null || initResult === undefined) {
        throw new Error('Failed to initialize LSP: no response')
      }
      client.serverCapabilities = initResult.capabilities as Record<string, unknown> | undefined

      await sendNotification(client, 'initialized', {})
      await sendNotification(client, 'workspace/didChangeConfiguration', { settings: config.settings ?? {} })

      client.status = 'ready'
      client.readyAt = Date.now()
      clients.set(key, client)
      initFailures.delete(key)
      const progressGrace = setTimeout(() => {
        if (client.activeProgressTokens.size === 0) client.resolveProjectLoaded()
      }, PROJECT_LOAD_GRACE_MS)
      progressGrace.unref()
      touch(client)
      return client
    } catch (err) {
      client.status = 'error'
      if (clients.get(key) === client) clients.delete(key)
      killClient(client)
      const message = err instanceof Error ? err.message : String(err)
      initFailures.set(key, { at: Date.now(), message })
      throw err
    } finally {
      clientLocks.delete(key)
    }
  })()

  clientLocks.set(key, clientPromise)
  return clientPromise
}

// =============================================================================
// Reader loop (upstream startMessageReader)
// =============================================================================

/**
 * Start the background stdout reader: frames messages, routes responses to
 * pending requests, answers the server requests a stdio server may make
 * during init, and captures publishDiagnostics + $/progress.
 */
function startMessageReader(client: LspClientState): void {
  const record = spawned.get(client)
  const stdout = record?.proc.stdout
  if (record === undefined || stdout === null || stdout === undefined) return

  const framer = new MessageFramer(Buffer.alloc(0))

  stdout.on('data', (chunk: Buffer) => {
    framer.push(chunk)
    for (const messageText of framer.drain(() => {
      // Non-protocol bytes on stdout: drop past the bogus terminator and resync
      // (upstream logger.warn path — kept silent here, no host logger).
    })) {
      // A throwing handler must not kill the reader (upstream try/catch).
      try {
        const message: Partial<LspJsonRpcResponse> & Partial<LspJsonRpcRequest> = JSON.parse(messageText)

        // Route on `method` FIRST: server request ids live in the server's own
        // id space and routinely collide with in-flight client request ids
        // (upstream #3001 fix).
        if (typeof message.method === 'string') {
          if (message.id !== undefined && message.id !== null) {
            void handleServerRequest(client, message as LspJsonRpcRequest)
          } else if (message.method === 'textDocument/publishDiagnostics' && message.params !== undefined) {
            const params = message.params as PublishDiagnosticsParams
            client.diagnostics.set(params.uri, {
              diagnostics: params.diagnostics ?? [],
              version: params.version ?? null,
            })
            client.diagnosticsVersion += 1
            touch(client)
          } else if (message.method === '$/progress' && message.params !== undefined) {
            // Track work-done progress: loading is done when the token set
            // drains (upstream activeProgressTokens handling). Progress also
            // counts as activity so a long initial load cannot be reaped.
            const params = message.params as { token?: string | number; value?: { kind?: string } }
            if (params.value?.kind === 'begin') {
              if (params.token !== undefined) client.activeProgressTokens.add(params.token)
              touch(client)
            } else if (params.value?.kind === 'end') {
              if (params.token !== undefined) client.activeProgressTokens.delete(params.token)
              if (client.activeProgressTokens.size === 0) client.resolveProjectLoaded()
            }
          }
          // Other server notifications (window/logMessage, …) are ignored.
        } else if (typeof message.id === 'number') {
          const pending = client.pendingRequests.get(message.id)
          if (pending !== undefined) {
            client.pendingRequests.delete(message.id)
            if (message.error !== undefined && message.error !== null) {
              const code = message.error.code
              pending.reject(
                new Error(`LSP error${typeof code === 'number' ? ` ${code}` : ''}: ${String(message.error.message)}`),
              )
            } else {
              pending.resolve(message.result)
            }
            touch(client)
          }
        }
      } catch {
        // Malformed message — later messages are still well-framed.
      }
    }
  })

  stdout.on('error', () => {
    const err = new Error(`LSP connection closed for ${client.name}`)
    for (const pending of client.pendingRequests.values()) pending.reject(err)
    client.pendingRequests.clear()
  })
}

/**
 * Respond to a server-initiated request (upstream handleServerRequest, trimmed
 * to the requests stdio servers actually make during the supported lifecycle:
 * configuration pulls answered from the config's `settings`, workspace folder
 * pulls, progress-token creation, and capability registrations; everything
 * else gets -32601).
 */
async function handleServerRequest(client: LspClientState, message: LspJsonRpcRequest): Promise<void> {
  const respond = (result: unknown, error?: { code: number; message: string }) =>
    queueWriteMessage(client, {
      jsonrpc: '2.0',
      id: message.id,
      ...(error === undefined ? { result } : { error }),
    }).catch(() => {
      // Server exited mid-response; the exit handler cleans up.
    })

  switch (message.method) {
    case 'workspace/configuration': {
      const params = message.params as { items?: Array<{ scopeUri?: string }> } | undefined
      const items = params?.items ?? []
      await respond(items.map(() => client.config.settings ?? {}))
      return
    }
    case 'workspace/workspaceFolders': {
      await respond([{ uri: fileToUri(client.root), name: path.basename(client.root) || 'workspace' }])
      return
    }
    case 'window/workDoneProgress/create':
    case 'window/workDoneProgress/cancel':
    case 'client/registerCapability':
    case 'client/unregisterCapability': {
      await respond(null)
      return
    }
    default:
      await respond(null, { code: -32601, message: `method not found: ${message.method}` })
  }
}

// =============================================================================
// Requests / notifications (upstream sendRequest/sendNotification)
// =============================================================================

/** Send an LSP request and wait for its response under `timeoutMs`. */
export function sendRequest(
  client: LspClientState,
  method: string,
  params: unknown,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const id = ++client.requestId
  const request: LspJsonRpcRequest = { jsonrpc: '2.0', id, method, params }

  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
  let timer: NodeJS.Timeout | undefined
  const fail = (error: Error): void => {
    clearTimeout(timer)
    client.pendingRequests.delete(id)
    reject(error)
  }
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      fail(new Error(`LSP request ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timer.unref()
  }
  client.pendingRequests.set(id, {
    resolve: result => {
      clearTimeout(timer)
      client.pendingRequests.delete(id)
      resolve(result)
    },
    reject: fail,
    method,
  })
  touch(client)
  queueWriteMessage(client, request).catch(error => {
    fail(error instanceof Error ? error : new Error(String(error)))
  })
  return promise
}

/** Send an LSP notification (no response expected). */
export async function sendNotification(client: LspClientState, method: string, params: unknown): Promise<void> {
  const notification: LspJsonRpcNotification = { jsonrpc: '2.0', method, params }
  touch(client)
  await queueWriteMessage(client, notification)
}

// =============================================================================
// File lifecycle (upstream ensureFileOpen, trimmed)
// =============================================================================

/**
 * Ensure a file is opened in the client: sends `textDocument/didOpen` with the
 * on-disk content unless the server already tracks it.
 */
export async function ensureFileOpen(client: LspClientState, filePath: string): Promise<void> {
  const uri = fileToUri(filePath)
  if (client.openFiles.has(uri)) return

  let content: string
  try {
    content = await fsPromises.readFile(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const languageId = client.config.languageId ?? detectLanguageId(filePath)
  await sendNotification(client, 'textDocument/didOpen', {
    textDocument: { uri, languageId, version: 1, text: content },
  })
  client.openFiles.set(uri, { version: 1, languageId })
}

// =============================================================================
// Waits (upstream waitForDiagnostics / waitForProjectLoaded)
// =============================================================================

/**
 * Wait for fresh diagnostics for `uri` after a `didOpen`: accepts an exact
 * document-version publish immediately, otherwise lets the publish stream
 * settle for {@link DIAGNOSTICS_SETTLE_MS} before accepting the latest, until
 * `timeoutMs` elapses (then returns whatever arrived, possibly empty).
 */
export async function waitForDiagnostics(
  client: LspClientState,
  uri: string,
  options: { timeoutMs?: number; minVersion?: number } = {},
): Promise<Diagnostic[]> {
  const { timeoutMs = DIAGNOSTICS_WAIT_MS, minVersion } = options
  const deadline = Date.now() + timeoutMs
  let settledRef: { diagnostics: Diagnostic[] } | undefined
  let settledAt = 0

  while (Date.now() < deadline) {
    // Keep the idle reaper at bay while the caller is actively waiting on
    // this client — a long settle window must not read as idleness.
    touch(client)
    const versionOk = minVersion === undefined || client.diagnosticsVersion > minVersion
    const published = client.diagnostics.get(uri)
    if (published !== undefined && versionOk) {
      // didOpen always sends version 1, so an exact match is authoritative.
      if (published.version === 1) return published.diagnostics
      // Unversioned/mismatched publish: wait for the stream to go quiet so an
      // in-flight pre-open publish is superseded by the fresh one.
      if (settledRef !== published) {
        settledRef = published
        settledAt = Date.now()
      } else if (Date.now() - settledAt >= DIAGNOSTICS_SETTLE_MS) {
        return published.diagnostics
      }
    }
    await new Promise(resolve => setTimeout(resolve, DIAGNOSTICS_POLL_MS))
  }

  const published = client.diagnostics.get(uri)
  return published?.diagnostics ?? []
}

/**
 * Wait for the server's initial project loading to complete (upstream
 * waitForProjectLoaded, minus the rust-analyzer-specific workspace-ready
 * polling): resolves when the $/progress token set drains, after the
 * progress-less grace window, or at the 15s cap — whichever comes first.
 */
export async function waitForProjectLoaded(client: LspClientState): Promise<void> {
  const keepAlive = setInterval(() => touch(client), 100)
  keepAlive.unref()
  try {
    await client.projectLoaded
  } finally {
    clearInterval(keepAlive)
    touch(client)
  }
}

// =============================================================================
// Shutdown (upstream shutdownClientInstance/shutdownAll)
// =============================================================================

function waitForExit(client: LspClientState, timeoutMs: number): Promise<boolean> {
  const record = spawned.get(client)
  if (record === undefined) return Promise.resolve(true)
  return Promise.race([
    record.exited.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      timer.unref()
    }),
  ])
}

/**
 * Tear down one client with the LSP `shutdown` → `exit` handshake, bounded by
 * the upstream budgets, force-killing whatever outlives them. Idempotent.
 */
export async function shutdownClientInstance(client: LspClientState): Promise<boolean> {
  if (clients.get(client.name) === client) clients.delete(client.name)
  clearTimeout(client.idleTimer)
  client.status = 'error'

  const err = new Error('LSP client shutdown')
  for (const pending of client.pendingRequests.values()) pending.reject(err)
  client.pendingRequests.clear()

  const shutdownCompleted = await sendRequest(client, 'shutdown', null, SHUTDOWN_TIMEOUT_MS).then(
    () => true,
    () => false,
  )
  if (shutdownCompleted) {
    await sendNotification(client, 'exit', undefined).catch(() => {})
    if (await waitForExit(client, EXIT_TIMEOUT_MS)) return true
  }

  killClient(client)
  return waitForExit(client, EXIT_TIMEOUT_MS)
}

/** Shut down every live client (upstream shutdownAll). */
export async function shutdownAllLspClients(): Promise<void> {
  const toShutdown = [...clients.values()]
  clients.clear()
  await Promise.allSettled(toShutdown.map(client => shutdownClientInstance(client)))
}

if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    void shutdownAllLspClients()
  })
}
