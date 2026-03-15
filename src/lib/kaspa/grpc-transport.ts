/**
 * Minimal gRPC-web transport layer using the browser Fetch API.
 *
 * The gRPC-web wire protocol wraps each protobuf message in a 5-byte
 * length-prefix frame:
 *   [flags: 1 byte][length: 4 bytes big-endian][message: length bytes]
 *
 * Trailer frames use flags = 0x80 and are silently skipped.
 *
 * All requests go to the single bidirectional stream endpoint:
 *   POST <host>/protowire.RPC/MessageStream
 *
 * For unary-style calls the caller reads the first response frame then
 * cancels the stream.  For subscriptions (e.g. NotifyBlockAdded) the
 * caller keeps reading until the AbortSignal fires.
 */

/** gRPC-web / HTTP endpoint path for the Kaspa/HTND RPC stream */
export const GRPC_PATH = '/protowire.RPC/MessageStream'

// ─── Frame helpers ────────────────────────────────────────────────────────────

/** Wrap raw protobuf bytes in a 5-byte gRPC-web frame header. */
export function encodeFrame(data: Uint8Array): Uint8Array {
  const frame = new Uint8Array(5 + data.length)
  frame[0] = 0x00 // flags: not compressed
  new DataView(frame.buffer).setUint32(1, data.length, false /* big-endian */)
  frame.set(data, 5)
  return frame
}

/**
 * Stateful frame parser for incremental streaming reads.
 * Feed it `Uint8Array` chunks; it returns complete data frames
 * (trailer frames with flags & 0x80 are silently discarded).
 */
export class FrameParser {
  private buf = new Uint8Array(0)

  push(chunk: Uint8Array): Uint8Array[] {
    // Append chunk to leftover buffer
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    this.buf = merged

    const frames: Uint8Array[] = []
    let offset = 0

    while (offset + 5 <= this.buf.length) {
      const flags  = this.buf[offset]
      const length = new DataView(this.buf.buffer, this.buf.byteOffset + offset + 1).getUint32(0, false)

      if (offset + 5 + length > this.buf.length) break // incomplete frame

      if (!(flags & 0x80)) {
        // data frame (not trailers)
        frames.push(this.buf.slice(offset + 5, offset + 5 + length))
      }
      offset += 5 + length
    }

    this.buf = this.buf.slice(offset) // keep only the incomplete remainder
    return frames
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }
}

// ─── Transport ────────────────────────────────────────────────────────────────

/**
 * Open a gRPC-web request and deliver decoded frames via `onFrame`.
 *
 * @param host      Full origin, e.g. `http://localhost:8080` or `""` for
 *                  same-origin (used with a dev-server / nginx proxy).
 * @param msgBytes  Already-encoded protobuf request bytes (not framed).
 * @param onFrame   Called with each response frame's raw bytes.
 *                  Return `false` to cancel the stream immediately.
 * @param signal    Optional AbortSignal to cancel from the outside.
 */
export async function grpcWebStream(
  host: string,
  msgBytes: Uint8Array,
  onFrame: (bytes: Uint8Array) => boolean | void,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${host}${GRPC_PATH}`

  let response: Response
  try {
    // ArrayBuffer.slice() creates a copy.  For our gRPC-web frames this is
    // negligible (< a few hundred bytes per call), and the copy is required
    // because TypeScript 5.9+ tightened BodyInit to require ArrayBuffer (not
    // ArrayBufferLike), and the Uint8Array returned by encodeFrame() carries
    // the wider ArrayBufferLike constraint due to its Uint8Array parameter type.
    const frameBytes = encodeFrame(msgBytes)
    const body = frameBytes.buffer.slice(
      frameBytes.byteOffset,
      frameBytes.byteOffset + frameBytes.byteLength,
    ) as ArrayBuffer

    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'X-Grpc-Web': '1',
      },
      body,
      signal,
    })
  } catch (err) {
    // AbortError is expected when the caller cancels; re-throw everything else
    if (err instanceof DOMException && err.name === 'AbortError') return
    throw err
  }

  if (!response.ok) {
    throw new Error(`gRPC-web HTTP error ${response.status}: ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('gRPC-web: response body is null (server returned no body)')
  }

  const reader = response.body.getReader()
  const parser = new FrameParser()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      for (const frame of parser.push(value)) {
        const keepGoing = onFrame(frame)
        if (keepGoing === false) {
          reader.cancel()
          return
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return
    throw err
  }
}

/**
 * Convenience wrapper: send one request, wait for the first response frame,
 * and return it.  The stream is cancelled after the first frame is received.
 */
export async function grpcWebUnary(
  host: string,
  msgBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let resolved = false
    grpcWebStream(
      host,
      msgBytes,
      (frame) => {
        if (!resolved) {
          resolved = true
          resolve(frame)
        }
        return false // cancel after first frame
      },
      signal,
    ).catch((err) => {
      if (!resolved) reject(err)
    })
  })
}
