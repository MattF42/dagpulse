/**
 * ws-transport.ts — WebSocket transport for the DAGPulse bridge.
 *
 * Connects to ws(s)://same-origin/ws (or a configurable URL) and:
 *  - emits snapshot, block, status, and error messages
 *  - reconnects with exponential backoff (max 30 s)
 *  - falls back to mock mode after CONNECT_TIMEOUT_MS if the socket never opens
 */

const CONNECT_TIMEOUT_MS = 5_000
const MAX_BACKOFF_MS = 30_000
const PREFIX = '[WSTransport]'

/** Resolve the WebSocket URL from the current page origin. */
function resolveWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/dagpulse/ws`
}

export type SnapshotMessage = {
  type: 'snapshot'
  info: Record<string, unknown>
  dagInfo: Record<string, unknown>
  blocks: Record<string, unknown>[]
}

export type BlockMessage = {
  type: 'block'
  block: Record<string, unknown>
}

export type StatusMessage = {
  type: 'status'
  connected: boolean
  serverVersion: string | null
  isSynced: boolean | null
}

export type ErrorMessage = {
  type: 'error'
  message: string
}

export type PingMessage = { type: 'ping' }
export type PongMessage = { type: 'pong' }

export type BridgeMessage = SnapshotMessage | BlockMessage | StatusMessage | ErrorMessage | PingMessage | PongMessage

type SnapshotCallback = (msg: SnapshotMessage) => void
type BlockCallback = (msg: BlockMessage) => void
type StatusCallback = (msg: StatusMessage) => void
type ErrorCallback = (msg: ErrorMessage) => void
type ConnectFailCallback = () => void

export class WSTransport {
  private ws: WebSocket | null = null
  private aborted = false
  private backoff = 1_000

  private snapshotCallbacks: SnapshotCallback[] = []
  private blockCallbacks: BlockCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private errorCallbacks: ErrorCallback[] = []
  private connectFailCallbacks: ConnectFailCallback[] = []

  onSnapshot(cb: SnapshotCallback) { this.snapshotCallbacks.push(cb) }
  onBlock(cb: BlockCallback)       { this.blockCallbacks.push(cb) }
  onStatus(cb: StatusCallback)     { this.statusCallbacks.push(cb) }
  onError(cb: ErrorCallback)       { this.errorCallbacks.push(cb) }
  /** Called once if the WebSocket never connects within CONNECT_TIMEOUT_MS. */
  onConnectFail(cb: ConnectFailCallback) { this.connectFailCallbacks.push(cb) }

  connect(): void {
    if (this.aborted) return
    const url = resolveWsUrl()
    console.log(PREFIX, `Connecting to ${url}`)

    let openedBeforeTimeout = false
    const timeoutId = setTimeout(() => {
      if (!openedBeforeTimeout && !this.aborted) {
        console.warn(PREFIX, `Connection timed out after ${CONNECT_TIMEOUT_MS}ms — falling back to mock`)
        this.connectFailCallbacks.forEach(cb => cb())
        // Don't abort — keep retrying in background in case bridge comes up later
        this._scheduleReconnect()
      }
    }, CONNECT_TIMEOUT_MS)

    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      clearTimeout(timeoutId)
      openedBeforeTimeout = true
      this.backoff = 1_000
      console.log(PREFIX, 'Connected')
    }

    ws.onmessage = (event: MessageEvent) => {
      let msg: BridgeMessage
      try {
        msg = JSON.parse(event.data as string) as BridgeMessage
      } catch {
        console.warn(PREFIX, 'Failed to parse message:', event.data)
        return
      }

      switch (msg.type) {
        case 'snapshot':
          this.snapshotCallbacks.forEach(cb => cb(msg as SnapshotMessage))
          break
        case 'block':
          this.blockCallbacks.forEach(cb => cb(msg as BlockMessage))
          break
        case 'status':
          this.statusCallbacks.forEach(cb => cb(msg as StatusMessage))
          break
        case 'error':
          console.warn(PREFIX, 'Bridge error:', (msg as ErrorMessage).message)
          this.errorCallbacks.forEach(cb => cb(msg as ErrorMessage))
          break
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }))
          break
        default:
          break
      }
    }

    ws.onerror = (event) => {
      clearTimeout(timeoutId)
      console.warn(PREFIX, 'WebSocket error', event)
    }

    ws.onclose = () => {
      clearTimeout(timeoutId)
      if (this.aborted) return
      console.warn(PREFIX, `Disconnected — reconnecting in ${this.backoff}ms`)
      this._scheduleReconnect()
    }
  }

  private _scheduleReconnect(): void {
    if (this.aborted) return
    setTimeout(() => {
      if (!this.aborted) this.connect()
    }, this.backoff)
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
  }

  disconnect(): void {
    this.aborted = true
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
  }
}
