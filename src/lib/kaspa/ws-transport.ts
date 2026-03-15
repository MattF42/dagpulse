/**
 * ws-transport.ts — WebSocket transport for the DAGPulse bridge.
 */

const CONNECT_TIMEOUT_MS = 5_000
const MAX_BACKOFF_MS = 30_000
const PREFIX = '[WSTransport]'

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

// ← ADD THIS
export type StatsMessage = {
  type: 'stats'
  blueScore?: number
  daaScore?: number
  hashrate?: number
}

export type PingMessage = { type: 'ping' }
export type PongMessage = { type: 'pong' }

export type BridgeMessage = SnapshotMessage | BlockMessage | StatusMessage | ErrorMessage | StatsMessage | PingMessage | PongMessage

type SnapshotCallback = (msg: SnapshotMessage) => void
type BlockCallback = (msg: BlockMessage) => void
type StatusCallback = (msg: StatusMessage) => void
type ErrorCallback = (msg: ErrorMessage) => void
type StatsCallback = (msg: StatsMessage) => void   // ← ADD
type ConnectFailCallback = () => void

export class WSTransport {
  private ws: WebSocket | null = null
  private aborted = false
  private backoff = 1_000

  private snapshotCallbacks: SnapshotCallback[] = []
  private blockCallbacks: BlockCallback[] = []
  private statusCallbacks: StatusCallback[] = []
  private errorCallbacks: ErrorCallback[] = []
  private statsCallbacks: StatsCallback[] = []         // ← ADD
  private connectFailCallbacks: ConnectFailCallback[] = []

  onSnapshot(cb: SnapshotCallback) { this.snapshotCallbacks.push(cb) }
  onBlock(cb: BlockCallback)       { this.blockCallbacks.push(cb) }
  onStatus(cb: StatusCallback)     { this.statusCallbacks.push(cb) }
  onError(cb: ErrorCallback)       { this.errorCallbacks.push(cb) }
  onStats(cb: StatsCallback)       { this.statsCallbacks.push(cb) }  // ← ADD
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
        console.warn(PREFIX, 'Failed to parse message', event.data)
        return
      }

      switch (msg.type) {
        case 'snapshot': this.snapshotCallbacks.forEach(cb => cb(msg as SnapshotMessage)); break
        case 'block':    this.blockCallbacks.forEach(cb => cb(msg as BlockMessage));       break
        case 'status':   this.statusCallbacks.forEach(cb => cb(msg as StatusMessage));     break
        case 'error':    this.errorCallbacks.forEach(cb => cb(msg as ErrorMessage));       break
        case 'stats':    this.statsCallbacks.forEach(cb => cb(msg as StatsMessage));       break  // ← ADD
        case 'ping':     this.ws?.send(JSON.stringify({ type: 'pong' }));                  break
        case 'pong':                                                                        break
        default:
          console.warn(PREFIX, 'Unknown message type', (msg as Record<string, unknown>).type)
      }
    }

    ws.onclose = () => {
      console.warn(PREFIX, 'Disconnected')
      if (!this.aborted) this._scheduleReconnect()
    }

    ws.onerror = (e) => {
      console.warn(PREFIX, 'WebSocket error', e)
    }
  }

  disconnect(): void {
    this.aborted = true
    this.ws?.close()
    this.ws = null
  }

  _scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
  }
}

