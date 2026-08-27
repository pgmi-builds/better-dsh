/**
 * Content-Length JSON-RPC framing for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/jsonrpc/
 * message-framing.ts, MIT — see ../LICENSE-OMP.md): near-verbatim port to
 * plain Node Buffer APIs; upstream's private `#` fields kept. This is the
 * whole vendored surface of that module — no trims were needed.
 */

const MESSAGE_DECODER = new TextDecoder('utf-8')

/**
 * Locate the `\r\n\r\n` header terminator across the pending chunk list.
 * Returns the absolute byte index of the first `\r`, or -1 when not present.
 * Equivalent to scanning the contiguous concatenation of the chunks.
 */
function findHeaderEndInChunks(chunks: Buffer[]): number {
  let global = 0
  let b0 = -1
  let b1 = -1
  let b2 = -1
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]
      if (b0 === -1) {
        if (byte === 0x0d) b0 = global + i
      } else if (b1 === -1) {
        if (byte === 0x0a) b1 = global + i
        else b0 = b1 = b2 = -1
      } else if (b2 === -1) {
        if (byte === 0x0d) b2 = global + i
        else b0 = b1 = b2 = -1
      } else {
        if (byte === 0x0a) return b0
        b0 = b1 = b2 = -1
      }
    }
    global += chunk.length
  }
  return -1
}

/** Copy the byte range [from, to) out of the pending chunk list into one Buffer. */
function copyChunkRange(chunks: Buffer[], from: number, to: number): Buffer {
  const out = Buffer.allocUnsafe(to - from)
  let global = 0
  let written = 0
  for (const chunk of chunks) {
    const start = Math.max(from, global)
    const end = Math.min(to, global + chunk.length)
    if (start < end) {
      chunk.copy(out, written, start - global, end - global)
      written += end - start
    }
    global += chunk.length
  }
  return out
}

/** Drop the first `count` bytes from the pending chunk list in place. */
function dropChunkFront(chunks: Buffer[], count: number): void {
  let removed = 0
  while (chunks.length > 0) {
    const chunk = chunks[0]
    if (chunk === undefined) break
    if (removed + chunk.length <= count) {
      removed += chunk.length
      chunks.shift()
    } else {
      chunks[0] = chunk.subarray(count - removed)
      removed = count
      break
    }
  }
}

/**
 * Incremental Content-Length frame decoder for a JSON message byte stream.
 * Push raw stdout chunks in; `drain` yields the JSON text of every complete
 * buffered message; `remainder` exposes the unparsed tail. A header block
 * without `Content-Length` is treated as non-protocol noise and skipped past
 * its terminator via `onResync` (upstream resync behavior).
 */
export class MessageFramer {
  readonly #pendingChunks: Buffer[] = []
  #pendingLen = 0

  /** Seed the buffer with any unparsed remainder left by a previous reader. */
  constructor(seed: Buffer) {
    if (seed.length > 0) {
      this.#pendingChunks.push(seed)
      this.#pendingLen = seed.length
    }
  }

  /** Append a freshly read chunk to the pending buffer. */
  push(chunk: Buffer): void {
    this.#pendingChunks.push(chunk)
    this.#pendingLen += chunk.length
  }

  /**
   * Yield the JSON text of every complete message currently buffered. A header
   * block without a `Content-Length` is non-protocol noise (e.g. a server
   * printing to stdout); `onResync` is invoked with the offending header text
   * and the framer drops past the bogus terminator to recover instead of
   * stalling on the same junk header forever.
   */
  *drain(onResync: (headerText: string) => void): Generator<string> {
    while (true) {
      const headerEnd = findHeaderEndInChunks(this.#pendingChunks)
      if (headerEnd === -1) break

      const headerText = MESSAGE_DECODER.decode(copyChunkRange(this.#pendingChunks, 0, headerEnd))
      const contentLengthMatch = headerText.match(/Content-Length: (\d+)/i)
      if (!contentLengthMatch) {
        onResync(headerText)
        dropChunkFront(this.#pendingChunks, headerEnd + 4)
        this.#pendingLen -= headerEnd + 4
        continue
      }

      const contentLength = Number.parseInt(contentLengthMatch[1] as string, 10)
      const messageStart = headerEnd + 4 // Skip \r\n\r\n
      const messageEnd = messageStart + contentLength
      if (this.#pendingLen < messageEnd) break

      const messageText = MESSAGE_DECODER.decode(copyChunkRange(this.#pendingChunks, messageStart, messageEnd))
      dropChunkFront(this.#pendingChunks, messageEnd)
      this.#pendingLen -= messageEnd
      yield messageText
    }
  }

  /** The unparsed remainder, to persist when the reader stops. */
  remainder(): Buffer {
    return this.#pendingChunks.length === 0
      ? Buffer.alloc(0)
      : this.#pendingChunks.length === 1
        ? (this.#pendingChunks[0] as Buffer)
        : Buffer.concat(this.#pendingChunks, this.#pendingLen)
  }
}
