<script lang="ts">
  import { blocksPerSecond } from '../stores/dag'

  let kaspaTime = $derived(Math.max(0.1, 1 / Math.max(1, $blocksPerSecond)).toFixed(2))
</script>

<div class="h-10 bg-surface/60 backdrop-blur border-t border-border flex items-center justify-center gap-6 px-4">
  <span class="text-[10px] text-text-dim uppercase tracking-wider">Confirmation Speed</span>

  <div class="flex items-center gap-1.5">
    <div class="w-2 h-2 rounded-full bg-accent"></div>
    <span class="text-xs font-bold text-accent tabular-nums">Hoosat: Under 1 second</span>
  </div>

</div>
