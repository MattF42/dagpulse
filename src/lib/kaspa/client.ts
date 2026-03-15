import type { DagBlock, NetworkStats, ConnectionState, BlockDetail } from './types'
import { MockBlockStream } from './mock'
import { encodeMessage, decodeMessage } from './kaspa-proto'
import { grpcWebUnary, grpcWebStream } from './grpc-transport'

/**
 * gRPC-web endpoint for the local HTND node.
 *
 * In development the Vite dev-server proxies /protowire.RPC/* to this address
 * so the browser connects to the Vite origin (no CORS).
 *
 * For production behind nginx set VITE_RPC_HOST to the public origin
 * (e.g. https://your-server.com) — nginx proxies /protowire.RPC/* to
 * the grpcwebproxy sidecar which talks to the HTND node.
 *
 * An empty string means same-origin, which is correct for both the
 * Vite proxy and the nginx deployment.
 */
const RPC_HOST: string = import.meta.env.VITE_RPC_HOST ?? ''

type BlockCallback = (block: DagBlock) => void
type StatsCallback = (stats: Partial<NetworkStats>) => void
type StateCallback = (state: ConnectionState) => void
type BatchCallback = (blocks: DagBlock[]) => void

export class KaspaClient {
  private mockStream: MockBlockStream | null = null
  private blockCallbacks: BlockCallback[] = []
  private batchCallbacks: BatchCallback[] = []
  private statsCallbacks: StatsCallback[] = []
  private stateCallbacks: StateCallback[] = []
  private _state: ConnectionState = 'disconnected'
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private subscriptionAbort: AbortController | null = null
  private seenHashes = new Set<string>()
  private initialFetchDone = false

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
    try {
      // Probe the node with a lightweight GetInfo call
      const info = await this.rpcGetInfo()
      this.setState('connected')
      console.log(
        '[HTNDClient] Connected via gRPC-web to local HTND node.',
        'version:', info.serverVersion,
        'synced:', info.isSynced,
      )

      // Load an initial snapshot of the DAG, then subscribe for live updates
      await this.loadInitialBlocks()
      this.startBlockSubscription()
      this.startStatsPolling()
    } catch (e) {
      console.warn('[HTNDClient] gRPC connection failed, falling back to mock:', e)
      this.startMock()
    }
  }

  async getBlockDetail(hash: string): Promise<BlockDetail | null> {
    try {
      const resp = await this.rpcGetBlock(hash, true)
      if (!resp) return null
      return this.grpcBlockToDetail(resp, hash)
    } catch (e) {
      console.warn('[HTNDClient] getBlockDetail failed:', e)
      return null
    }
  }

  disconnect() {
    this.subscriptionAbort?.abort()
    this.subscriptionAbort = null

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

  // ─── gRPC helpers ──────────────────────────────────────────────────────────

  /** Send a KaspadMessage and return the decoded response object. */
  private async call(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const reqBytes = encodeMessage(payload)
    const respBytes = await grpcWebUnary(RPC_HOST, reqBytes)
    return decodeMessage(respBytes)
  }

  private async rpcGetInfo() {
    const resp = await this.call({ getInfoRequest: {} })
    return (resp.getInfoResponse ?? {}) as {
      serverVersion: string
      isSynced: boolean
      mempoolSize: number
    }
  }

  private async rpcGetBlockDagInfo() {
    const resp = await this.call({ getBlockDagInfoRequest: {} })
    return (resp.getBlockDagInfoResponse ?? {}) as {
      tipHashes: string[]
      virtualDaaScore: number
      networkName: string
    }
  }

  private async rpcGetBlock(hash: string, includeTransactions = false) {
    const resp = await this.call({
      getBlockRequest: { hash, includeTransactions },
    })
    const r = resp.getBlockResponse as Record<string, unknown> | undefined
    if (!r || (r.error as any)?.message) return null
    return r.block as Record<string, unknown> | undefined
  }

  private async rpcEstimateHashrate(): Promise<number> {
    const resp = await this.call({
      estimateNetworkHashesPerSecondRequest: { windowSize: 1000, startHash: '' },
    })
    const r = resp.estimateNetworkHashesPerSecondResponse as Record<string, unknown> | undefined
    return Number(r?.networkHashesPerSecond ?? 0)
  }

  // ─── Initial block load ────────────────────────────────────────────────────

  private async loadInitialBlocks() {
    const dagInfo = await this.rpcGetBlockDagInfo()
    const tipHashes: string[] = dagInfo.tipHashes ?? []
    if (tipHashes.length === 0) return

    const subgraph = await this.fetchSubgraph(tipHashes[0], 3, 80)
    this.classifyBlueRed(subgraph)

    for (const block of subgraph) this.seenHashes.add(block.hash)
    this.batchCallbacks.forEach(cb => cb(subgraph))
    for (const block of subgraph) this.blockCallbacks.forEach(cb => cb(block))
    this.statsCallbacks.forEach(cb => cb({ blocksSeen: this.seenHashes.size }))

    this.initialFetchDone = true

    if (dagInfo.virtualDaaScore) {
      this.statsCallbacks.forEach(cb => cb({ daaScore: dagInfo.virtualDaaScore }))
    }
  }

  /**
   * Walk a block's parent graph breadth-first up to maxDepth levels.
   * Caps total blocks at maxBlocks to keep the canvas manageable.
   */
  private async fetchSubgraph(startHash: string, maxDepth: number, maxBlocks = 80): Promise<DagBlock[]> {
    const result: DagBlock[] = []
    const visited = new Set<string>()
    let currentLevel = [startHash]

    for (let depth = 0; depth <= maxDepth && currentLevel.length > 0 && result.length < maxBlocks; depth++) {
      const nextLevel: string[] = []
      const levelHashes = currentLevel.slice(0, Math.max(5, maxBlocks - result.length))

      // Fetch in parallel batches of 5
      for (let i = 0; i < levelHashes.length && result.length < maxBlocks; i += 5) {
        const batch = levelHashes.slice(i, i + 5)
        const fetched = await Promise.all(
          batch.map(async (hash) => {
            if (visited.has(hash) || this.seenHashes.has(hash)) return null
            visited.add(hash)
            try {
              return await this.rpcGetBlock(hash, false)
            } catch {
              return null
            }
          }),
        )

        for (const raw of fetched) {
          if (!raw || result.length >= maxBlocks) continue
          const block = this.parseGrpcBlock(raw)
          if (!block) continue
          result.push(block)

          if (depth < maxDepth) {
            for (const parentHash of block.parentHashes.slice(0, 3)) {
              if (!visited.has(parentHash) && !this.seenHashes.has(parentHash)) {
                nextLevel.push(parentHash)
              }
            }
          }
        }
      }

      currentLevel = nextLevel
    }

    return result
  }

  // ─── Real-time block subscription ──────────────────────────────────────────

  /**
   * Subscribe to BlockAdded notifications from the HTND node via a
   * long-lived gRPC-web server-streaming call.  Restarts automatically
   * on disconnect unless `disconnect()` was called.
   */
  private startBlockSubscription() {
    const ac = new AbortController()
    this.subscriptionAbort = ac

    const reqBytes = encodeMessage({ notifyBlockAddedRequest: {} })

    const run = async () => {
      try {
        await grpcWebStream(
          RPC_HOST,
          reqBytes,
          (frameBytes) => {
            const msg = decodeMessage(frameBytes)

            if (msg.notifyBlockAddedResponse) {
              console.log('[HTNDClient] Block-added subscription confirmed')
            }

            if (msg.blockAddedNotification) {
              const notif = msg.blockAddedNotification as Record<string, unknown>
              const raw = notif.block as Record<string, unknown> | undefined
              if (!raw) return

              const block = this.parseGrpcBlock(raw)
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
            }
          },
          ac.signal,
        )
      } catch (e) {
        if (ac.signal.aborted) return
        console.warn('[HTNDClient] Block subscription dropped, reconnecting in 2 s:', e)
        setTimeout(run, 2000)
      }
    }

    run()
  }

  // ─── Stats polling ─────────────────────────────────────────────────────────

  private startStatsPolling() {
    const poll = async () => {
      try {
        const [dagInfo, nodeInfo, hashrate] = await Promise.allSettled([
          this.rpcGetBlockDagInfo(),
          this.rpcGetInfo(),
          this.rpcEstimateHashrate(),
        ])

        const stats: Partial<NetworkStats> = { isConnected: true }

        if (dagInfo.status === 'fulfilled') {
          const d = dagInfo.value
          if (d.virtualDaaScore) stats.daaScore = d.virtualDaaScore
        }

        if (nodeInfo.status === 'fulfilled') {
          const d = nodeInfo.value
          stats.isSynced      = d.isSynced
          stats.serverVersion = d.serverVersion
          stats.mempoolSize   = d.mempoolSize
        }

        if (hashrate.status === 'fulfilled') {
          const hr = hashrate.value
          if (hr > 0) {
            if (hr >= 1e12)      stats.hashrate = (hr / 1e12).toFixed(1) + ' TH/s'
            else if (hr >= 1e9)  stats.hashrate = (hr / 1e9).toFixed(1)  + ' GH/s'
            else if (hr >= 1e6)  stats.hashrate = (hr / 1e6).toFixed(1)  + ' MH/s'
            else                 stats.hashrate = hr.toFixed(0)           + ' H/s'
          }
        }

        this.statsCallbacks.forEach(cb => cb(stats))
      } catch (e) {
        console.warn('[HTNDClient] Stats poll failed:', e)
      }
    }

    poll()
    this.statsInterval = setInterval(poll, 5000)
  }

  // ─── Mock fallback ─────────────────────────────────────────────────────────

  private startMock() {
    this.mockStream = new MockBlockStream()
    this.mockStream.start((block) => {
      this.blockCallbacks.forEach(cb => cb(block))
    })
    this.setState('connected')

    this.statsInterval = setInterval(() => {
      const bps = 4.5 + Math.random() * 1.5 // ~5 BPS like a local HTND node
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
   * Convert a gRPC RpcBlock object (plain JS from protobufjs) to a DagBlock.
   * Field names and numbers are from the canonical Kaspa/HTND proto definitions.
   */
  private parseGrpcBlock(raw: Record<string, unknown>): DagBlock | null {
    try {
      const header  = (raw.header  ?? {}) as Record<string, unknown>
      const verbose = (raw.verboseData ?? {}) as Record<string, unknown>

      const hash = String(verbose.hash ?? '')
      if (!hash) return null

      // Collect parent hashes from all DAG levels
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

  private grpcBlockToDetail(raw: Record<string, unknown>, fallbackHash: string): BlockDetail | null {
    try {
      const header  = (raw.header  ?? {}) as Record<string, unknown>
      const verbose = (raw.verboseData ?? {}) as Record<string, unknown>
      const txs     = Array.isArray(raw.transactions) ? raw.transactions : []

      const parents: string[] = []
      const parentLevels = (header.parents ?? []) as Array<{ parentHashes?: string[] }>
      for (const level of parentLevels) {
        if (Array.isArray(level.parentHashes)) parents.push(...level.parentHashes)
      }

      return {
        hash:         String(verbose.hash ?? fallbackHash),
        parentHashes: parents,
        blueScore:    Number(verbose.blueScore ?? header.blueScore ?? 0),
        daaScore:     Number(header.daaScore ?? 0),
        timestamp:    Number(header.timestamp ?? 0),
        isBlue:       true,
        nonce:        String(header.nonce ?? '0'),
        bits:         Number(header.bits ?? 0),
        version:      Number(header.version ?? 0),
        transactions: txs.map((tx: any) => ({
          id:      String(tx?.verboseData?.transactionId ?? 'unknown'),
          inputs:  Array.isArray(tx?.inputs)  ? tx.inputs.length  : 0,
          outputs: Array.isArray(tx?.outputs) ? tx.outputs.length : 0,
          amount:  0,
        })),
      }
    } catch {
      return null
    }
  }

  /**
   * Second pass: mark blocks as red if they appear in any other block's
   * mergeSetReds.  All other blocks remain blue.
   */
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
