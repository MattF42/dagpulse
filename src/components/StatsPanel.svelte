<script lang="ts">
  import { blocksPerSecond, txPerSecond } from '../stores/dag'
  import { networkStats } from '../stores/stats'
  import { formatNumber } from '../lib/stats/engine'

  interface StatItem {
    label: string
    value: string
    accent?: boolean
    key: string
  }

  let stats: StatItem[] = $derived([
    { label: 'Blocks/sec', value: $blocksPerSecond.toFixed(1), accent: true, key: 'bps' },
    { label: 'TX/sec', value: $txPerSecond.toFixed(1), key: 'tps' },
    { label: 'Blue Score', value: $networkStats.blueScore > 0 ? formatNumber($networkStats.blueScore) : '---', key: 'blue' },
    { label: 'DAA Score', value: $networkStats.daaScore > 0 ? formatNumber($networkStats.daaScore) : '---', key: 'daa' },
    { label: 'Hashrate', value: $networkStats.hashrate, key: 'hash' },
    { label: 'Blocks Seen', value: String($networkStats.blocksSeen || 0), key: 'seen' },
  ])

  // Track previous BPS to trigger pulse animation
  let prevBps = ''
  let bpsPulseKey = $state(0)

  $effect(() => {
    const currentBps = $blocksPerSecond.toFixed(1)
    if (prevBps && prevBps !== currentBps) {
      bpsPulseKey++
    }
    prevBps = currentBps
  })
</script>

<div class="w-56 bg-surface/60 backdrop-blur border-r border-border flex flex-col overflow-y-auto">
  <div class="p-3 border-b border-border">
    <h2 class="text-xs font-semibold text-text-dim uppercase tracking-wider">Network Stats</h2>
  </div>

  <div class="flex-1 p-3 space-y-3">
    {#each stats as stat (stat.key)}
      <div class="animate-fade-in">
        <div class="text-[10px] text-text-dim uppercase tracking-wider mb-0.5">{stat.label}</div>
        {#if stat.key === 'bps'}
          {#key bpsPulseKey}
            <div class="text-xl font-bold tabular-nums text-accent animate-stat-pulse">
              {stat.value}
            </div>
          {/key}
        {:else}
          <div class="text-xl font-bold tabular-nums {stat.accent ? 'text-accent' : 'text-text'}">
            {stat.value}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Speed comparison -->
  <div class="p-3 border-t border-border">
    <h3 class="text-[10px] text-text-dim uppercase tracking-wider mb-2">Confirmation Speed</h3>
    <div class="space-y-1.5">
      <div class="flex items-center gap-2">
        <div class="w-full bg-bg rounded-full h-2 overflow-hidden">
          <div class="h-full bg-accent rounded-full" style="width: 2%"></div>
        </div>
        <span class="text-[10px] text-accent font-mono whitespace-nowrap">HTN 0.2s</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-full bg-bg rounded-full h-2 overflow-hidden">
          <div class="h-full bg-purple-500/60 rounded-full" style="width: 12%"></div>
        </div>
        <span class="text-[10px] text-text-dim font-mono whitespace-nowrap">ETH 12s</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-full bg-bg rounded-full h-2 overflow-hidden">
          <div class="h-full bg-orange-500/60 rounded-full" style="width: 100%"></div>
        </div>
        <span class="text-[10px] text-text-dim font-mono whitespace-nowrap">BTC 10m</span>
      </div>
    </div>
  </div>
</div>
