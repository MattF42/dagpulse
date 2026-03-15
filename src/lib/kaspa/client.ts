import type { DagBlock, NetworkStats, ConnectionState, BlockDetail } from './types'
import { MockBlockStream } from './mock'
import { WSTransport } from './ws-transport'
import { formatHashrate } from '../stats/engine'

/** Target BPS that HTND is configured to run at; used only by the mock fallback. */
const HTND_TARGET_BPS = 5

type BlockCallback = (block: DagBlock) => void
type StatsCallback = (stats: Partial<NetworkStats>) => void
type StateCallback = (state: ConnectionState) => void
type BatchCallback = (blocks: DagBlock[]) => void

export class KaspaClient {
  private mockStream: MockBlockStream | null = null
  private transport: WSTransport | null = null
  private blockCallbacks: BlockCallback[] = []
  private batchCallbacks: BatchCallback[] = []
  private statsCallbacks: StatsCallback[] = []
  private stateCallbacks: StateCallback[] = []
  private _state: ConnectionState = 'disconnected'
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private seenHashes = new Set<string>()

  get state(): ConnectionState {
    return this._state
  }

  onBlock(cb: BlockCallback) { this.blockCallbacks.push(cb) }
  onBatch(cb: BatchCallback) { this.batchCallbacks.push(cb) }
  onStats(cb: StatsCallback) { this.statsCallbacks.push(cb) }
  onStateChange(cb: StateCallback) { this.stateCallbacks.push(cb) }

  private setState(s: ConnectionState) {
    this._state = s
    this.stateCallbacks.forEach(cb => cb(s))
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setState('connecting')

    const transport = new WSTransport()
    this.transport = transport

    // If bridge is unreachable within 5 s, fall back to mock
    transport.onConnectFail(() => {
      console.warn('[HTNDClient] WebSocket bridge unreachable, falling back to mock')
      this.startMock()
    })

    transport.onStatus((msg) => {
      if (msg.connected) {
        this.setState('connected')
        console.log(
          '[HTNDClient] Connected via WebSocket bridge.',
          'version:', msg.serverVersion,
          'synced:', msg.isSynced,
        )
        this.statsCallbacks.forEach(cb => cb({
          isConnected: true,
          isSynced: msg.isSynced ?? undefined,
          serverVersion: msg.serverVersion ?? undefined,
        }))
      }
    })

    transport.onSnapshot((msg) => {
      const info = msg.info ?? {}
      const dagInfo = msg.dagInfo ?? {}
      const blocks = (msg.blocks ?? []) as Record<string, unknown>[]

      this.setState('connected')

      if (info.serverVersion) {
        this.statsCallbacks.forEach(cb => cb({
          isConnected: true,
          isSynced: info.isSynced as boolean | undefined,
          serverVersion: info.serverVersion as string | undefined,
        }))
      }

      if (dagInfo.virtualDaaScore) {
        this.statsCallbacks.forEach(cb => cb({ daaScore: dagInfo.virtualDaaScore as number }))
      }

      if (dagInfo.virtualBlueScore) {
        this.statsCallbacks.forEach(cb => cb({ blueScore: dagInfo.virtualBlueScore as number }))
      }

      const parsed: DagBlock[] = []
      for (const raw of blocks) {
        const block = this.parseWsBlock(raw)
        if (block && !this.seenHashes.has(block.hash)) {
          this.seenHashes.add(block.hash)
          parsed.push(block)
        }
      }

      if (parsed.length > 0) {
        this.classifyBlueRed(parsed)
        this.batchCallbacks.forEach(cb => cb(parsed))
        for (const block of parsed) this.blockCallbacks.forEach(cb => cb(block))
        this.statsCallbacks.forEach(cb => cb({ blocksSeen: this.seenHashes.size }))
      }
    })

    transport.onBlock((msg) => {
      const raw = msg.block as Record<string, unknown> | undefined
      if (!raw) return

      const block = this.parseWsBlock(raw)
      if (!block || this.seenHashes.has(block.hash)) return

      this.seenHashes.add(block.hash)
      this.classifyBlueRed([block])

      // Trim seen-hash set to prevent unbounded memory growth
      if (this.seenHashes.size > 1000) {
        const iter = this.seenHashes.values()
        for (let i = 0; i < 400; i++) this.seenHashes.delete(iter.next().value!)
      }

      this.blockCallbacks.forEach(cb => cb(block))
      this.batchCallbacks.forEach(cb => cb([block]))
      this.statsCallbacks.forEach(cb => cb({ blocksSeen: this.seenHashes.size }))
    })

    transport.onStats((msg) => {
      const partial: Partial<NetworkStats> = {}
      if (msg.blueScore != null)  partial.blueScore = Number(msg.blueScore)
      if (msg.daaScore  != null)  partial.daaScore  = Number(msg.daaScore)
      if (msg.hashrate  != null)  partial.hashrate  = formatHashrate(Number(msg.hashrate))
      this.statsCallbacks.forEach(cb => cb(partial))
    })

    transport.connect()
  }

  /**
   * Block detail is not available via the WebSocket bridge (which only streams
   * live blocks).  Return null so the UI degrades gracefully.
   */
  async getBlockDetail(_hash: string): Promise<BlockDetail | null> {
    return null
  }

  disconnect() {
    if (this.transport) {
      this.transport.disconnect()
      this.transport = null
    }

    if (this.mockStream) {
      this.mockStream.stop()
      this.mockStream = null
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }

    this.setState('disconnected')
  }

  // ─── Mock fallback ─────────────────────────────────────────────────────────

  private startMock() {
    if (this._state === 'connected') return // already connected via WS
    this.mockStream = new MockBlockStream()
    this.mockStream.start((block) => {
      this.blockCallbacks.forEach(cb => cb(block))
    })
    this.setState('connected')

    this.statsInterval = setInterval(() => {
      const bps = HTND_TARGET_BPS * (0.9 + Math.random() * 0.2)
      this.statsCallbacks.forEach(cb => cb({
        blocksPerSecond: bps,
        txPerSecond: bps * 0.4,
        hashrate: (10 + Math.random() * 5).toFixed(1) + ' GH/s',
        peerCount: 8 + Math.floor(Math.random() * 4),
        isConnected: true,
        isSynced: true,
        serverVersion: 'mock',
      }))
    }, 1000)
  }

  // ─── Parsers ───────────────────────────────────────────────────────────────

  /**
   * Parse a block object received from the WebSocket bridge.
   * The bridge sends the raw protobuf-to-dict block as-is (same field names as
   * the gRPC client used previously).
   */
  private parseWsBlock(raw: Record<string, unknown>): DagBlock | null {
    try {
      const header  = (raw.header  ?? {}) as Record<string, unknown>
      const verbose = (raw.verboseData ?? {}) as Record<string, unknown>

      const hash = String(verbose.hash ?? '')
      if (!hash) return null

      const parents: string[] = []
      const parentLevels = (header.parents ?? []) as Array<{ parentHashes?: string[] }>
      for (const level of parentLevels) {
        if (Array.isArray(level.parentHashes)) parents.push(...level.parentHashes)
      }

      const blueScore = Number(verbose.blueScore ?? header.blueScore ?? 0)
      const daaScore  = Number(header.daaScore ?? 0)
      const timestamp = Number(header.timestamp ?? Date.now())
      const txCount   = Array.isArray(raw.transactions) ? raw.transactions.length : 0

      const mergeSetBlues: string[] = (verbose.mergeSetBluesHashes as string[] | undefined) ?? []
      const mergeSetReds:  string[] = (verbose.mergeSetRedsHashes  as string[] | undefined) ?? []
      const selectedParentHash: string | null = (verbose.selectedParentHash as string | undefined) ?? null

      return {
        hash,
        parentHashes: parents,
        blueScore,
        daaScore,
        timestamp,
        txCount,
        isBlue: true, // classifyBlueRed will correct this
        mergeSetBlues,
        mergeSetReds,
        isVirtualChain: Boolean(verbose.isChainBlock),
        selectedParentHash,
        x: 0, y: 0,
        targetX: 0, targetY: 0,
        opacity: 0, scale: 0.5,
        glowIntensity: 1,
        addedAt: performance.now(),
      }
    } catch {
      return null
    }
  }

  private classifyBlueRed(blocks: DagBlock[]) {
    const redSet = new Set<string>()
    for (const block of blocks) {
      for (const h of block.mergeSetReds) redSet.add(h)
    }
    for (const block of blocks) {
      if (redSet.has(block.hash)) block.isBlue = false
    }
  }
}

export const kaspaClient = new KaspaClient()
