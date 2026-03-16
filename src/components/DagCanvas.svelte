<script lang="ts">
  import { onMount } from 'svelte'
  import { blocks, blockMap } from '../stores/dag'
  import { selectedBlock, selectBlock, autoFollow } from '../stores/ui'
  import { renderDAG, hitTestBlock, type RenderState } from '../lib/dag/renderer'
  import { layoutBlocks, animateBlocks, getAutoScrollX, type LayoutConfig } from '../lib/dag/layout'
  import {
    createPanZoomState,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    type PanZoomState
  } from '../lib/dag/interaction'

  let canvasEl: HTMLCanvasElement
  let containerEl: HTMLDivElement
  let ctx: CanvasRenderingContext2D
  let width = 800
  let height = 600
  let dpr = 1
  let panZoom: PanZoomState
  let hoveredHash: string | null = null
  let animFrameId: number
  let lastTime = 0

  onMount(() => {
    ctx = canvasEl.getContext('2d')!
    dpr = window.devicePixelRatio || 1
    panZoom = createPanZoomState(width)

    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      width = entry.contentRect.width
      height = entry.contentRect.height
      canvasEl.width = width * dpr
      canvasEl.height = height * dpr
      canvasEl.style.width = width + 'px'
      canvasEl.style.height = height + 'px'
    })
    ro.observe(containerEl)

    // Render loop
    function frame(ts: number) {
      const dt = lastTime ? ts - lastTime : 16
      lastTime = ts

      const currentBlocks = $blocks
      const currentBlockMap = $blockMap

      // Layout
      const config: LayoutConfig = { width, height, offsetX: panZoom.offsetX, offsetY: panZoom.offsetY, zoom: panZoom.zoom }
      layoutBlocks(currentBlocks, config)
      animateBlocks(currentBlocks, dt)

      // Auto-scroll to follow tip
      if ($autoFollow && currentBlocks.length > 0) {
        const targetX = getAutoScrollX(currentBlocks)
        const desiredOffsetX = -targetX * panZoom.zoom + width * 0.7
        panZoom.offsetX += (desiredOffsetX - panZoom.offsetX) * 0.05
      }

      // Render
      ctx.save()
      ctx.scale(dpr, dpr)

      const renderState: RenderState = {
        offsetX: panZoom.offsetX,
        offsetY: panZoom.offsetY,
        zoom: panZoom.zoom,
        selectedHash: $selectedBlock?.hash ?? null,
        hoveredHash,
      }

      renderDAG(ctx, currentBlocks, currentBlockMap, renderState, width, height)
      ctx.restore()

      animFrameId = requestAnimationFrame(frame)
    }

    animFrameId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(animFrameId)
      ro.disconnect()
    }
  })

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    panZoom = handleWheel(panZoom, e)
    autoFollow.set(false)
  }

  function onMouseDown(e: MouseEvent) {
    panZoom = handleMouseDown(panZoom, e)
    autoFollow.set(false)
  }

  function onMouseMoveHandler(e: MouseEvent) {
    if (panZoom.isDragging) {
      panZoom = handleMouseMove(panZoom, e)
    } else {
      // Hit test for hover
      const rect = canvasEl.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = hitTestBlock($blocks, x, y, {
        offsetX: panZoom.offsetX,
        offsetY: panZoom.offsetY,
        zoom: panZoom.zoom,
        selectedHash: null,
        hoveredHash: null,
      })
      hoveredHash = hit?.hash ?? null
      canvasEl.style.cursor = hit ? 'pointer' : (panZoom.isDragging ? 'grabbing' : 'grab')
    }
  }

  function onMouseUp(e: MouseEvent) {
    // Only count as click if we didn't drag
    if (panZoom.isDragging && Math.abs(e.clientX - panZoom.lastMouseX) < 3 && Math.abs(e.clientY - panZoom.lastMouseY) < 3) {
      // This was a click, not a drag
      const rect = canvasEl.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = hitTestBlock($blocks, x, y, {
        offsetX: panZoom.offsetX,
        offsetY: panZoom.offsetY,
        zoom: panZoom.zoom,
        selectedHash: null,
        hoveredHash: null,
      })
      selectBlock(hit)
    }
    panZoom = handleMouseUp(panZoom)
  }

  function onClick(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = hitTestBlock($blocks, x, y, {
      offsetX: panZoom.offsetX,
      offsetY: panZoom.offsetY,
      zoom: panZoom.zoom,
      selectedHash: null,
      hoveredHash: null,
    })
    selectBlock(hit)
  }

  // Touch support
  let touchStartTime = 0
  let touchStartX = 0
  let touchStartY = 0
  let lastPinchDist = 0
  let isTouchDragging = false

  function getTouchDist(e: TouchEvent): number {
    const t0 = e.touches[0]
    const t1 = e.touches[1]
    const dx = t1.clientX - t0.clientX
    const dy = t1.clientY - t0.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  function getTouchCenter(e: TouchEvent): { x: number; y: number } {
    if (e.touches.length >= 2) {
      return {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      }
    }
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  function onTouchStart(e: TouchEvent) {
    e.preventDefault()
    if (e.touches.length === 1) {
      touchStartTime = Date.now()
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
      isTouchDragging = false
      panZoom = {
        ...panZoom,
        isDragging: true,
        lastMouseX: e.touches[0].clientX,
        lastMouseY: e.touches[0].clientY,
      }
      autoFollow.set(false)
    } else if (e.touches.length === 2) {
      lastPinchDist = getTouchDist(e)
      isTouchDragging = true
    }
  }

  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
    if (e.touches.length === 1 && panZoom.isDragging) {
      const dx = e.touches[0].clientX - panZoom.lastMouseX
      const dy = e.touches[0].clientY - panZoom.lastMouseY
      if (Math.abs(e.touches[0].clientX - touchStartX) > 5 || Math.abs(e.touches[0].clientY - touchStartY) > 5) {
        isTouchDragging = true
      }
      panZoom = {
        ...panZoom,
        offsetX: panZoom.offsetX + dx,
        offsetY: panZoom.offsetY + dy,
        lastMouseX: e.touches[0].clientX,
        lastMouseY: e.touches[0].clientY,
      }
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const dist = getTouchDist(e)
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist
        const newZoom = Math.max(0.3, Math.min(3, panZoom.zoom * scale))

        const center = getTouchCenter(e)
        const rect = canvasEl.getBoundingClientRect()
        const cx = center.x - rect.left
        const cy = center.y - rect.top

        const zoomRatio = newZoom / panZoom.zoom
        panZoom = {
          ...panZoom,
          zoom: newZoom,
          offsetX: cx - (cx - panZoom.offsetX) * zoomRatio,
          offsetY: cy - (cy - panZoom.offsetY) * zoomRatio,
        }
      }
      lastPinchDist = dist
      isTouchDragging = true
    }
  }

  function onTouchEnd(e: TouchEvent) {
    e.preventDefault()
    // Tap detection: short duration + minimal movement
    if (!isTouchDragging && Date.now() - touchStartTime < 300) {
      const rect = canvasEl.getBoundingClientRect()
      const x = touchStartX - rect.left
      const y = touchStartY - rect.top
      const hit = hitTestBlock($blocks, x, y, {
        offsetX: panZoom.offsetX,
        offsetY: panZoom.offsetY,
        zoom: panZoom.zoom,
        selectedHash: null,
        hoveredHash: null,
      })
      selectBlock(hit)
    }
    panZoom = { ...panZoom, isDragging: false }
    lastPinchDist = 0
  }

  function resetView() {
    autoFollow.set(true)
    panZoom.zoom = 1
    panZoom.offsetY = 0
  }
</script>

<div class="relative flex-1 min-h-0 overflow-hidden" bind:this={containerEl}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <canvas
    bind:this={canvasEl}
    class="block w-full h-full touch-none"
    style="cursor: grab;"
    aria-label="Hoosat BlockDAG visualization. Pan to scroll, scroll to zoom, click blocks to inspect."
    onwheel={onWheel}
    onmousedown={onMouseDown}
    onmousemove={onMouseMoveHandler}
    onmouseup={onMouseUp}
    onclick={onClick}
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  ></canvas>

  <!-- Controls overlay -->
  <div class="absolute top-3 right-3 flex gap-2">
    <button
      onclick={resetView}
      class="px-3 py-1.5 text-[11px] rounded bg-surface/80 backdrop-blur border border-border text-text-dim hover:text-text transition-colors cursor-pointer"
      aria-label={$autoFollow ? 'Currently following new blocks' : 'Click to auto-follow new blocks'}
    >
      {$autoFollow ? 'Following' : 'Auto-follow'}
    </button>
  </div>

  <!-- Block count -->
  <div class="absolute bottom-3 left-3 text-[10px] text-text-dim font-mono bg-surface/60 backdrop-blur px-2 py-1 rounded">
    {$blocks.length} blocks visible
  </div>
</div>
