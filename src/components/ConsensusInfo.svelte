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
      "Every miners participation in the chain is useful; and thanks to our super energy efficient, ASIC resistant Hoohash V110 crypto everything from mobile phones to data centre class GPUs finds block and is rewarded every single day!",
      "The virtual chain (highlighted path) is the selected parent chain through the DAG.",
      "Blocks with the same DAA score were mined in parallel by different miners.",
      "Instead of a single line of blocks, GHOSTDAG creates a BlockDAG (Directed Acyclic Graph). Imagine a braided rope instead of a single thread—multiple blocks exist and reference several previous blocks rather than only one",
      "Despite being much faster, GHOSTDAG doesn't lose the security advantages of Proof-of-Work. It is a generalized version of the Nakamoto Consensus used by Bitcoin, ensuring that an attacker needs to control 51% of the network’s hash power to override the system. ",
      "The speed and low fees of GHOSTDAG make it ideal for things traditional blockchains struggle with, such as microtransactions, gaming, and point-of-sale systems that require immediate payment settlement.",
      "DAGKnight is coming to Hoosat real soon, it is already live on testnet! This will allow the network to automatically adjust every more spped and security parameters intelligently by itself",
      "This visualisation shows the DAG from the point of view of a single node, as conensus builds across the network.  If it's not showing properly at the moment, the node is probably being upgraded right now to our latest exciting development",
    ]
    const idx = tick % facts.length
    return facts[idx]
  })
</script>

<div class="px-4 py-2 bg-surface/40 border-t border-border text-xs text-text-dim">
  <span class="text-accent font-semibold mr-1">GHOSTDAG:</span>
  {message}
</div>
