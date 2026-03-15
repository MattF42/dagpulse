<script lang="ts">
  import { selectedBlock, showInspector, selectBlock } from '../stores/ui'
  import { blockMap } from '../stores/dag'
  import { truncateHash, formatTimestamp } from '../lib/stats/engine'
  import { kaspaClient } from '../lib/kaspa/client'
  import type { BlockDetail, DagBlock } from '../lib/kaspa/types'

  let detail: BlockDetail | null = $state(null)
  let loading = $state(false)

  // Fetch full block detail when selection changes
  $effect(() => {
    const block = $selectedBlock
    if (block) {
      loading = true
      detail = null
      kaspaClient.getBlockDetail(block.hash).then(d => {
        detail = d
        loading = false
      }).catch(() => { loading = false })
    } else {
      detail = null
    }
  })

  function close() {
    selectBlock(null)
  }

  function copyHash() {
    if ($selectedBlock) {
      navigator.clipboard.writeText($selectedBlock.hash)
    }
  }

  function clickParent(hash: string) {
    const parent = $blockMap.get(hash)
    if (parent) {
      selectBlock(parent)
    }
  }

  function openExplorer() {
    if ($selectedBlock) {
      window.open(`https://explorer.hoosat.fi/blocks/${$selectedBlock.hash}`, '_blank')
    }
  }
</script>

{#if $showInspector && $selectedBlock}
  <div class="min-h-44 max-h-64 bg-surface/80 backdrop-blur border-t border-border flex flex-col animate-fade-in overflow-hidden">
    <div class="flex items-center justify-between px-4 py-2 border-b border-border">
      <h3 class="text-xs font-semibold text-text-dim uppercase tracking-wider">Block Inspector</h3>
      <div class="flex items-center gap-3">
        <button onclick={openExplorer} class="text-[10px] text-accent hover:text-accent-glow transition-colors cursor-pointer bg-transparent border-none px-2 py-0.5 rounded border border-border hover:border-accent">
          View on Explorer &#8599;
        </button>
        <button onclick={close} aria-label="Close block inspector" class="text-text-dim hover:text-text transition-colors text-sm cursor-pointer p-1">
          &times;
        </button>
      </div>
    </div>

    <div class="flex-1 px-4 py-2 grid grid-cols-2 md:grid-cols-4 gap-3 overflow-y-auto">
      <!-- Hash -->
      <div class="col-span-2">
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Block Hash</div>
        <button onclick={copyHash} class="text-xs font-mono text-accent hover:text-accent-glow transition-colors cursor-pointer bg-transparent border-none p-0" title="Click to copy full hash">
          {truncateHash($selectedBlock.hash, 16)}
        </button>
      </div>

      <!-- Blue Score -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Blue Score</div>
        <div class="text-sm font-bold tabular-nums text-text">{$selectedBlock.blueScore.toLocaleString()}</div>
      </div>

      <!-- DAA Score -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">DAA Score</div>
        <div class="text-sm font-bold tabular-nums text-text">{$selectedBlock.daaScore.toLocaleString()}</div>
      </div>

      <!-- Timestamp -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Timestamp</div>
        <div class="text-sm font-mono text-text">{formatTimestamp($selectedBlock.timestamp)}</div>
      </div>

      <!-- TX Count -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Transactions</div>
        <div class="text-sm font-bold tabular-nums {$selectedBlock.txCount > 0 ? 'text-tx' : 'text-text-dim'}">
          {$selectedBlock.txCount}
        </div>
      </div>

      <!-- Type -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Type</div>
        <div class="text-sm font-bold {$selectedBlock.isBlue ? 'text-accent' : 'text-block-red'}">
          {$selectedBlock.isBlue ? 'Blue (GHOSTDAG)' : 'Red'}
        </div>
      </div>

      <!-- Nonce (from detail) -->
      <div>
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Nonce</div>
        <div class="text-sm font-mono text-text-dim">
          {#if loading}...{:else if detail}{detail.nonce}{:else}---{/if}
        </div>
      </div>

      <!-- Parent Hashes -->
      <div class="col-span-2">
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Parents ({$selectedBlock.parentHashes.length})</div>
        <div class="flex flex-wrap gap-1">
          {#each $selectedBlock.parentHashes as parentHash}
            {@const inMap = $blockMap.has(parentHash)}
            <button
              onclick={() => clickParent(parentHash)}
              class="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors cursor-pointer border-none {inMap ? 'bg-accent/15 text-accent hover:bg-accent/30' : 'bg-border/30 text-text-dim'}"
              title={parentHash}
              disabled={!inMap}
            >
              {truncateHash(parentHash, 6)}
            </button>
          {/each}
        </div>
      </div>

      <!-- Transaction List (from detail) -->
      <div class="col-span-2">
        <div class="text-[10px] text-text-dim uppercase mb-0.5">Transaction IDs</div>
        {#if loading}
          <div class="text-[10px] text-text-dim">Loading...</div>
        {:else if detail && detail.transactions.length > 0}
          <div class="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
            {#each detail.transactions as tx}
              <a
                href="https://explorer.hoosat.fi/txs/{tx.id}"
                target="_blank"
                rel="noopener"
                class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-tx/10 text-tx hover:bg-tx/25 transition-colors no-underline"
                title={tx.id}
              >
                {truncateHash(tx.id, 6)}
                <span class="text-text-dim">({tx.inputs}in/{tx.outputs}out)</span>
              </a>
            {/each}
          </div>
        {:else}
          <div class="text-[10px] text-text-dim">Coinbase only</div>
        {/if}
      </div>
    </div>
  </div>
{/if}
