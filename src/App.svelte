<script lang="ts">
  import { onMount } from 'svelte'
  import Header from './components/Header.svelte'
  import StatsPanel from './components/StatsPanel.svelte'
  import DagCanvas from './components/DagCanvas.svelte'
  import BlockInspector from './components/BlockInspector.svelte'
  import ConsensusInfo from './components/ConsensusInfo.svelte'
  import SpeedBenchmark from './components/SpeedBenchmark.svelte'
  import { kaspaClient } from './lib/kaspa/client'
  import { addBlock, blocks } from './stores/dag'
  import { updateStats } from './stores/stats'
  import { connectionState } from './stores/ui'
  import { blocksPerSecond, txPerSecond } from './stores/dag'

  let showStats = $state(true)
  let isMobile = $state(false)
  let isPortrait = $state(false)
  let dismissedPortraitOverlay = $state(false)

  function checkMobile() {
    isMobile = window.innerWidth < 768
    isPortrait = window.innerHeight > window.innerWidth

    // Reset dismissal when user rotates back to landscape
    if (!isPortrait) {
      dismissedPortraitOverlay = false
    }

    if (isMobile) showStats = false
  }

  onMount(() => {
    checkMobile()
    window.addEventListener('resize', checkMobile)

    kaspaClient.onBlock(block => {
      addBlock(block)
    })

    kaspaClient.onStats(stats => {
      updateStats(stats)
    })

    kaspaClient.onStateChange(state => {
      connectionState.set(state)
    })

    const unsubBps = blocksPerSecond.subscribe(v => updateStats({ blocksPerSecond: v }))
    const unsubTps = txPerSecond.subscribe(v => updateStats({ txPerSecond: v }))

    kaspaClient.connect()

    return () => {
      kaspaClient.disconnect()
      unsubBps()
      unsubTps()
      window.removeEventListener('resize', checkMobile)
    }
  })

  function toggleStats() {
    showStats = !showStats
  }

  let isConnecting = $derived($connectionState === 'connecting' || $connectionState === 'disconnected')
  let hasBlocks = $derived($blocks.length > 0)
</script>

<div class="w-full h-full flex flex-col bg-bg overflow-hidden">
  <Header {isMobile} {toggleStats} {showStats} />
  <div class="flex-1 flex min-h-0 overflow-hidden relative">
    {#if showStats}
      <aside aria-label="Network statistics">
        <StatsPanel />
      </aside>
    {/if}
    <main class="flex-1 min-h-0 min-w-0 overflow-hidden">
      <DagCanvas />
    </main>

    <!-- Loading overlay -->
    {#if isConnecting && !hasBlocks}
      <div class="absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-sm z-10" role="status" aria-live="polite">
        <div class="text-center animate-fade-in">
          <div class="w-12 h-12 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto mb-4" aria-hidden="true"></div>
          <div class="text-text text-lg font-semibold">Connecting to Hoosat Network</div>
          <div class="text-text-dim text-sm mt-1">Fetching live BlockDAG data...</div>
        </div>
      </div>
    {/if}

    <!-- Portrait orientation overlay -->
    {#if isMobile && isPortrait && !dismissedPortraitOverlay}
      <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-bg/95 backdrop-blur-sm px-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" class="text-accent" aria-hidden="true">
          <!-- Phone outline (portrait) -->
          <rect x="20" y="8" width="24" height="40" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <!-- Phone screen -->
          <rect x="23" y="13" width="18" height="28" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.5"/>
          <!-- Rotation arrow -->
          <path d="M48 18 C54 18 58 24 58 32 C58 40 54 46 48 46" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <polyline points="44,14 48,18 44,22" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h2 class="text-text text-xl font-bold mt-6 mb-2">Rotate for best experience</h2>
        <p class="text-text-dim text-sm mb-8">DAGPulse is a live blockchain visualiser designed for landscape viewing. Rotate your device for the full experience.</p>
        <button
          onclick={() => dismissedPortraitOverlay = true}
          class="px-4 py-2 rounded border border-border text-text-dim text-sm hover:text-text hover:border-accent transition-colors cursor-pointer bg-transparent"
        >
          Continue in portrait anyway
        </button>
      </div>
    {/if}
  </div>
  <BlockInspector />
  <ConsensusInfo />
  <SpeedBenchmark />
</div>
