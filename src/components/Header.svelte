<script lang="ts">
  import ConnectionStatus from './ConnectionStatus.svelte'

  let { isMobile = false, toggleStats = () => {}, showStats = true }: {
    isMobile?: boolean
    toggleStats?: () => void
    showStats?: boolean
  } = $props()
</script>

<header class="h-12 flex items-center justify-between px-4 bg-surface/80 backdrop-blur border-b border-border z-50 relative">
  <nav class="flex items-center gap-3" aria-label="Main navigation">
    {#if isMobile}
      <button
        onclick={toggleStats}
        aria-label={showStats ? 'Hide stats panel' : 'Show stats panel'}
        aria-expanded={showStats}
        class="text-text-dim hover:text-text transition-colors cursor-pointer bg-transparent border-none p-2"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/>
        </svg>
      </button>
    {/if}
    <div class="flex items-center gap-2">
      <div class="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center" aria-hidden="true">
        <div class="w-3 h-3 rounded-full bg-accent animate-glow"></div>
      </div>
      <h1 class="text-lg font-bold tracking-tight">
        <span class="text-accent">DAG</span><span class="text-text">Pulse</span>
      </h1>
    </div>
    <span class="text-xs text-text-dim hidden sm:inline">GHOSTDAG Consensus Visualizer for Hoosat (HTN)</span>
  </nav>

  <div class="flex items-center gap-4">
    <ConnectionStatus />
    <a
      href="https://github.com/MattF42/dagpulse"
      target="_blank"
      rel="noopener noreferrer"
      class="text-text-dim hover:text-text transition-colors text-xs flex items-center gap-1 p-1"
      aria-label="View source on GitHub"
    >
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
      <span class="hidden sm:inline">GitHub</span>
    </a>
  </div>
</header>
