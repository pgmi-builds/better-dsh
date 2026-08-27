/**
 * Fake stdio LSP server fixture for the `dvc://lsp` device spec.
 *
 * Implements the server half of the vendored JSON-RPC loop on plain Node
 * stdio: `initialize` → capabilities (preceded by a colliding-id
 * `workspace/configuration` server request that exercises the device's
 * server-request routing, upstream #3001), `initialized`, `shutdown`/`exit`,
 * `textDocument/didOpen` → `publishDiagnostics` (one error + one warning), and
 * definition/references/hover answers. Positions echo the request so the spec
 * can prove the device's 1-based → 0-based conversion, and a hover at magic
 * 1-based line 1000 reports the server's initialize count so the spec can
 * observe client reuse vs respawn. Events append to `$FAKE_LSP_LOG` for
 * lifecycle assertions. Plain `.mjs` (run by Node, not typechecked).
 */

import * as fs from 'node:fs'

const LOG = process.env.FAKE_LSP_LOG ?? '/dev/null'

const append = line => {
  try {
    fs.appendFileSync(LOG, `${line}\n`)
  } catch {
    // log gone (torn-down fixture) — fine
  }
}

let buffer = ''
let initCount = 0

const send = message => {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n${body}`)
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result })

function handleRequest(message) {
  const id = message.id
  const params = message.params ?? {}

  switch (message.method) {
    case 'initialize': {
      initCount += 1
      append(`init:${initCount}`)
      // Server request whose NUMERIC id collides with the device's first
      // request id (initialize === 1), sent BEFORE the initialize reply: the
      // client must route on `method` first, answer this, and only then
      // resolve its own pending id 1 (upstream #3001 shape).
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'workspace/configuration',
        params: { items: [{ scopeUri: 'file:///probe' }] },
      })
      reply(id, {
        capabilities: { hoverProvider: true, definitionProvider: true, referencesProvider: true, textDocumentSync: 1 },
      })
      return
    }
    case 'shutdown': {
      append('shutdown')
      reply(id, null)
      return
    }
    case 'textDocument/definition': {
      const position = params.position ?? { line: 0, character: 0 }
      // Echo the requested (0-based) position back so the spec can prove the
      // device converted its 1-based args correctly.
      reply(id, {
        uri: params.textDocument?.uri ?? 'file:///unknown',
        range: { start: position, end: { line: position.line, character: position.character + 6 } },
      })
      return
    }
    case 'textDocument/references': {
      const uri = params.textDocument?.uri ?? 'file:///unknown'
      const position = params.position ?? { line: 0, character: 0 }
      reply(id, [
        { uri, range: { start: position, end: position } },
        { uri: uri.replace('main', 'other'), range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } } },
      ])
      return
    }
    case 'textDocument/hover': {
      // Magic 0-based line 999 (= 1-based 1000): reuse probe.
      if (params.position?.line === 999) {
        reply(id, { contents: { kind: 'plaintext', value: `init-count:${initCount}` } })
        return
      }
      reply(id, { contents: { kind: 'markdown', value: '```rust\nfn fake_hover() -> Answer\n```' } })
      return
    }
    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `no such method: ${String(message.method)}` } })
  }
}

function handleNotification(message) {
  switch (message.method) {
    case 'initialized':
      append('initialized')
      return
    case 'textDocument/didOpen': {
      const uri = message.params?.textDocument?.uri ?? 'file:///unknown'
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          version: 1,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
              severity: 1,
              source: 'fake-lsp',
              message: 'fake error: unresolved symbol `foo`',
            },
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
              severity: 2,
              source: 'fake-lsp',
              message: 'fake warning: unused variable',
            },
          ],
        },
      })
      return
    }
    case 'exit':
      append('exit')
      process.exit(0)
    default:
      // workspace/didChangeConfiguration etc. — acknowledge silently
      return
  }
}

process.stdin.on('data', chunk => {
  buffer += chunk.toString('utf-8')
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const match = buffer.slice(0, headerEnd).match(/Content-Length: (\d+)/i)
    if (match === null) {
      buffer = buffer.slice(headerEnd + 4)
      continue
    }
    const length = Number.parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + length) break
    const body = buffer.slice(bodyStart, bodyStart + length)
    buffer = buffer.slice(bodyStart + length)
    let message
    try {
      message = JSON.parse(body)
    } catch {
      continue
    }
    if (message.method !== undefined) {
      if (message.id !== undefined && message.id !== null) handleRequest(message)
      else handleNotification(message)
    }
    // Responses to the fake's own server requests: nothing to do.
  }
})

append(`spawn:${process.pid}`)
