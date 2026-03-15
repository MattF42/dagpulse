<script lang="ts">
  import { blocks } from '../stores/dag'
  import { selectedBlock } from '../stores/ui'

  let tick = $state(0)

  // Rotate facts every 8 seconds
  $effect(() => {
    const interval = setInterval(() => { tick++ }, 8000)
    return () => clearInterval(interval)
  })

  let message = $derived.by(() => {
    const sel = $selectedBlock
    if (sel) {
      const blueCount = sel.mergeSetBlues.length
      const redCount = sel.mergeSetReds.length
      const parentCount = sel.parentHashes.length
      if (sel.isVirtualChain) {
        return `Virtual chain block. Merged ${blueCount} blue + ${redCount} red blocks from ${parentCount} parents.`
      }
      return `${sel.isBlue ? 'Blue' : 'Red'} block with ${parentCount} parents. ${blueCount > 0 ? `Merged ${blueCount} blue blocks.` : ''}`
    }
    const facts = [
      "GHOSTDAG selects a 'blue' set of well-connected blocks, ordering them by DAA score.",
      "Unlike Bitcoin's longest chain, Hoosat keeps ALL blocks -- even 'red' ones contribute.",
      "The virtual chain (highlighted path) is the selected parent chain through the DAG.",
      "Blocks with the same DAA score were mined in parallel by different miners.",
    ]
    const idx = tick % facts.length
    return facts[idx]
  })
</script>

<div class="px-4 py-2 bg-surface/40 border-t border-border text-xs text-text-dim">
  <span class="text-accent font-semibold mr-1">GHOSTDAG:</span>
  {message}
</div>
