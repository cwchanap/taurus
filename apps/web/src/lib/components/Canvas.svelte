<script lang="ts">
  import 'pixi.js/advanced-blend-modes'
  import { Application, Graphics, Container } from 'pixi.js'
  import { onMount, onDestroy } from 'svelte'
  import type { Point, Stroke, FillOperation, PaletteColor, Tool } from '@repo/types'

  interface Props {
    color: PaletteColor
    brushSize: number
    tool: Tool
    strokes: Stroke[]
    fills: FillOperation[]
    playerId: string
    disabled?: boolean
    onStrokeStart: (stroke: Stroke) => boolean
    onStrokeUpdate: (strokeId: string, point: Point) => void
    onFill: (x: number, y: number, color: PaletteColor) => void
  }

  let {
    color,
    brushSize,
    tool,
    strokes,
    fills,
    playerId,
    disabled = false,
    onStrokeStart,
    onStrokeUpdate,
    onFill,
  }: Props = $props()

  const CANVAS_BG = '#1a1a2e'
  const MAX_FILL_PIXELS = 12_000_000

  let container: HTMLDivElement
  let mounted = false
  let app = $state.raw<Application | null>(null)
  let drawingContainer: Container | null = null
  let backgroundGraphics: Graphics | null = null
  let currentGraphics: Graphics | null = null
  let currentStrokeId: string | null = null
  let isDrawing = false
  let lastPoint: Point | null = null
  let strokeGraphics: Map<string, Graphics> = new Map()
  let fillGraphics: Map<string, Graphics | null> = new Map()
  let oobFills: Set<string> = new Set() // Track out-of-bounds fills to avoid repeated expensive pixel extraction
  let strokeColor: PaletteColor = '#1a1a2e'
  let strokeSize = 0
  let currentIsEraser = false
  let initError = $state<string | null>(null)
  let lastOperationsSig = ''
  let resizeTrigger = $state(0) // Increment to trigger fill reconciliation after resize
  let prevOperationSignatures: Map<string, string> | null = null
  let prevOperationTimestamps: Map<string, number> | null = null

  // Combined reconciliation of strokes and fills in timestamp order
  // This ensures correct z-ordering regardless of operation type
  $effect(() => {
    if (!app || !drawingContainer) return
    // Track resizeTrigger to reprocess fills after canvas resize
    resizeTrigger //eslint-disable-line
    try {
      const currentStrokeIds = new Set(strokes.map((s) => s.id))
      const currentFillIds = new Set(fills.map((f) => f.id))

      if (import.meta.env.DEV && currentStrokeIds.size !== strokes.length) {
        console.error('Canvas: Duplicate stroke IDs detected!')
      }

      // Build current operation signatures map (timestamp + seq) for invalidation detection.
      // Including seq ensures that same-millisecond operations whose server-assigned order
      // changes also trigger fill recomputation, not just a z-order swap.
      const currentSignatures = new Map<string, string>()
      for (const s of strokes) currentSignatures.set(s.id, `${s.timestamp}:${s.seq ?? ''}`)
      for (const f of fills) currentSignatures.set(f.id, `${f.timestamp}:${f.seq ?? ''}`)
      // Keep a parallel timestamp-only map used to find the earliest affected timestamp below.
      const currentTimestamps = new Map<string, number>()
      for (const s of strokes) currentTimestamps.set(s.id, s.timestamp)
      for (const f of fills) currentTimestamps.set(f.id, f.timestamp)

      // Find the earliest timestamp affected by removed, inserted, or reordered operations.
      // Any of those changes require fills at/after that point to be recomputed, because
      // flood-fill results depend on the raster state at the time they run — not just z-order.
      let minInvalidationTimestamp = Infinity
      if (prevOperationSignatures) {
        for (const [id, sig] of prevOperationSignatures.entries()) {
          if (!currentSignatures.has(id)) {
            // Operation removed — use its old timestamp for invalidation
            const oldTs = Number(sig.split(':')[0])
            minInvalidationTimestamp = Math.min(minInvalidationTimestamp, oldTs)
          }
        }
        for (const [id, ts] of currentTimestamps.entries()) {
          if (!prevOperationSignatures.has(id)) {
            minInvalidationTimestamp = Math.min(minInvalidationTimestamp, ts)
          }
        }
        for (const [id, sig] of currentSignatures.entries()) {
          const prevSig = prevOperationSignatures.get(id)
          if (prevSig !== undefined && prevSig !== sig) {
            const prevTs = prevOperationTimestamps?.get(id)
            const currentTs = currentTimestamps.get(id)!
            minInvalidationTimestamp = Math.min(
              minInvalidationTimestamp,
              prevTs ?? currentTs,
              currentTs
            )
          }
        }
      }

      // Remove deleted strokes
      for (const [id, graphics] of strokeGraphics.entries()) {
        if (!currentStrokeIds.has(id)) {
          graphics.destroy()
          strokeGraphics.delete(id)
        }
      }

      // Remove deleted fills
      for (const [id, graphics] of fillGraphics.entries()) {
        if (!currentFillIds.has(id)) {
          graphics?.destroy()
          fillGraphics.delete(id)
          oobFills.delete(id)
        }
      }

      // Clear operations that need recomputation (came at/after a removed or newly inserted operation)
      if (minInvalidationTimestamp < Infinity) {
        for (const [id, graphics] of strokeGraphics.entries()) {
          const strokeTs = currentTimestamps.get(id)
          if (strokeTs !== undefined && strokeTs >= minInvalidationTimestamp) {
            // Preserve the active stroke: onPointerDown already stored it in strokeGraphics
            // and currentGraphics holds the live reference. Destroying it here would leave
            // currentGraphics pointing at a dead Pixi object, breaking live drawing.
            if (id === currentStrokeId) continue
            graphics.destroy()
            strokeGraphics.delete(id)
          }
        }

        for (const [id, graphics] of fillGraphics.entries()) {
          const fillTs = currentTimestamps.get(id)
          if (fillTs !== undefined && fillTs >= minInvalidationTimestamp) {
            // Preserve null sentinels (no-op fills: same color, invalid coords, invalid color).
            // They must never be re-evaluated against a different raster, as doing so could
            // paint pixels that were never part of the original history.
            if (graphics === null) continue
            graphics.destroy()
            fillGraphics.delete(id)
            oobFills.delete(id)
          }
        }
      }

      prevOperationSignatures = new Map(currentSignatures)
      prevOperationTimestamps = new Map(currentTimestamps)

      // Build a combined list of operations sorted by timestamp, using seq as a tiebreaker
      // when both operations have a server-assigned seq to avoid same-millisecond reordering
      const operations = [
        ...strokes.map((s) => ({ type: 'stroke' as const, data: s, timestamp: s.timestamp })),
        ...fills.map((f) => ({ type: 'fill' as const, data: f, timestamp: f.timestamp })),
      ].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
        if (a.data.seq !== undefined && b.data.seq !== undefined) return a.data.seq - b.data.seq
        return 0
      })

      // Process operations in order, adding new ones at the correct position
      for (const op of operations) {
        if (op.type === 'stroke') {
          if (!strokeGraphics.has(op.data.id)) {
            drawStroke(op.data)
          }
        } else {
          if (!fillGraphics.has(op.data.id)) {
            applyFill(op.data)
          }
        }
      }

      // Reorder graphics only when operations are added/removed or timestamps change (signature changes)
      // Avoids O(n) reordering on every stroke point update which causes frame drops
      const operationsSig = operations
        .map((op) => `${op.data.id}:${op.timestamp}:${op.data.seq ?? ''}`)
        .join(',')
      if (operationsSig !== lastOperationsSig) {
        lastOperationsSig = operationsSig
        reorderGraphicsByTimestamp(operations)
      }
    } catch (e) {
      console.error('Canvas: Operation reconciliation failed:', e)
      initError = 'Canvas rendering error. Try refreshing the page.'
    }
  })

  // Reorder graphics in drawingContainer to match the sorted operations
  function reorderGraphicsByTimestamp(
    operations: Array<{ type: 'stroke' | 'fill'; data: { id: string }; timestamp: number }>
  ) {
    if (!drawingContainer) return

    for (const op of operations) {
      const graphics =
        op.type === 'stroke' ? strokeGraphics.get(op.data.id) : fillGraphics.get(op.data.id)
      if (graphics) {
        // Move to end (top of z-order) in the correct sequence
        drawingContainer.addChild(graphics)
      }
    }
  }

  onMount(async () => {
    mounted = true
    try {
      const pixiApp = new Application()
      await pixiApp.init({
        background: CANVAS_BG,
        resizeTo: container,
        antialias: true,
      })
      container.appendChild(pixiApp.canvas)

      // Create background layer (needed so erased areas reveal canvas bg color, not transparency)
      const bg = new Graphics()
      bg.rect(0, 0, pixiApp.screen.width, pixiApp.screen.height)
      bg.fill(CANVAS_BG)
      pixiApp.stage.addChild(bg)
      backgroundGraphics = bg

      // All strokes/fills go into this container so they render above the background
      const dc = new Container()
      pixiApp.stage.addChild(dc)
      drawingContainer = dc

      pixiApp.stage.eventMode = 'static'
      pixiApp.stage.hitArea = pixiApp.screen

      pixiApp.stage.on('pointerdown', onPointerDown)
      pixiApp.stage.on('pointermove', onPointerMove)
      pixiApp.stage.on('pointerup', onPointerUp)
      pixiApp.stage.on('pointerupoutside', onPointerUp)

      // Resize background when canvas resizes
      pixiApp.renderer.on('resize', (width: number, height: number) => {
        bg.clear()
        bg.rect(0, 0, width, height)
        bg.fill(CANVAS_BG)
        // Clear OOB fill cache when canvas resizes - fills that were OOB may now be valid
        oobFills.clear()
        // Destroy existing fill graphics so they recompute at the new pixel dimensions.
        // Without this, fills already in fillGraphics are skipped by the reconciliation
        // effect and remain rendered at their old geometry.
        for (const graphics of fillGraphics.values()) {
          graphics?.destroy()
        }
        fillGraphics.clear()
        // Reset ordering cache so the reconciliation effect is forced to reorder
        // recreated fill graphics against existing stroke graphics
        lastOperationsSig = ''
        // Increment trigger to force fill reconciliation
        resizeTrigger++
      })

      if (!mounted) {
        pixiApp.destroy(true)
        return
      }
      app = pixiApp
    } catch (e) {
      console.error('Canvas: Failed to initialize pixi.js renderer:', e)
      initError = 'Canvas failed to initialize. Try refreshing the page.'
    }
  })

  onDestroy(() => {
    mounted = false
    app?.destroy(true)
  })

  function onPointerDown(event: { global: { x: number; y: number } }) {
    if (!app || !drawingContainer || disabled) return

    const point = { x: event.global.x, y: event.global.y }

    if (tool === 'fill') {
      const screenWidth = app.screen.width
      const screenHeight = app.screen.height
      if (screenWidth * screenHeight > MAX_FILL_PIXELS) {
        console.warn(
          `Canvas: Fill rejected — canvas too large (${screenWidth * screenHeight} pixels > ${MAX_FILL_PIXELS} limit). Resize the window to use the fill tool.`
        )
        return
      }
      // Normalize coordinates to 0-1 range before sending over the wire
      // This ensures fills work correctly across different canvas sizes
      const normX = point.x / screenWidth
      const normY = point.y / screenHeight
      onFill(normX, normY, color)
      return
    }

    isDrawing = true
    currentStrokeId = crypto.randomUUID()
    lastPoint = point
    currentIsEraser = tool === 'eraser'

    currentGraphics = new Graphics()
    currentGraphics.blendMode = currentIsEraser ? 'erase' : 'normal'
    drawingContainer.addChild(currentGraphics)
    strokeGraphics.set(currentStrokeId, currentGraphics)

    strokeColor = color
    strokeSize = brushSize

    const stroke: Stroke = {
      id: currentStrokeId,
      playerId,
      points: [point],
      color: strokeColor,
      size: strokeSize,
      ...(currentIsEraser ? { eraser: true } : {}),
      timestamp: Date.now(),
    }

    const accepted = onStrokeStart(stroke)
    if (!accepted) {
      drawingContainer.removeChild(currentGraphics)
      strokeGraphics.delete(currentStrokeId)
      isDrawing = false
      currentStrokeId = null
      lastPoint = null
      currentGraphics = null
      currentIsEraser = false
    }
  }

  function onPointerMove(event: { global: { x: number; y: number } }) {
    if (!isDrawing || !currentGraphics || !currentStrokeId || !lastPoint) return

    const point = { x: event.global.x, y: event.global.y }

    currentGraphics.moveTo(lastPoint.x, lastPoint.y).lineTo(point.x, point.y).stroke({
      width: strokeSize,
      color: strokeColor,
      cap: 'round',
    })

    lastPoint = point
    onStrokeUpdate(currentStrokeId, point)
  }

  function onPointerUp() {
    isDrawing = false
    currentGraphics = null
    currentStrokeId = null
    lastPoint = null
  }

  function drawStroke(stroke: Stroke) {
    if (stroke.points.length < 1 || !app || !drawingContainer) return

    let graphics = strokeGraphics.get(stroke.id)
    if (!graphics) {
      graphics = new Graphics()
      drawingContainer.addChild(graphics)
      strokeGraphics.set(stroke.id, graphics)
    }

    graphics.blendMode = stroke.eraser ? 'erase' : 'normal'
    graphics.clear()
    for (let i = 1; i < stroke.points.length; i++) {
      graphics
        .moveTo(stroke.points[i - 1].x, stroke.points[i - 1].y)
        .lineTo(stroke.points[i].x, stroke.points[i].y)
        .stroke({
          width: stroke.size,
          color: stroke.color,
          cap: 'round',
        })
    }
  }

  function applyFill(fill: FillOperation) {
    if (!app || !drawingContainer) return

    const screenWidth = app.screen.width
    const screenHeight = app.screen.height

    if (screenWidth > 0 && screenHeight > 0 && screenWidth * screenHeight > MAX_FILL_PIXELS) {
      console.warn(
        `Canvas: Fill ${fill.id} skipped — canvas too large (${screenWidth * screenHeight} pixels > ${MAX_FILL_PIXELS} limit). Fill will not be applied until the canvas is resized or the operation is removed.`
      )
      oobFills.add(fill.id)
      return
    }

    // Check if this fill was previously marked as out-of-bounds to avoid repeated expensive extraction
    if (oobFills.has(fill.id)) {
      // Fill remains out-of-bounds, skip expensive pixel extraction
      return
    }

    // Extract from the full stage (includes background layer) so empty canvas areas
    // read as the background color rather than transparent, preventing runaway fills.
    let extracted: { pixels: Uint8ClampedArray; width: number; height: number }
    try {
      extracted = app.renderer.extract.pixels(app.stage)
    } catch (e) {
      console.error(`Canvas: Failed to extract pixels for fill ${fill.id}:`, e)
      return
    }

    const { pixels, width, height } = extracted

    if (!pixels || width <= 0 || height <= 0) {
      console.error(
        `Canvas: Pixel extraction returned invalid dimensions (${width}x${height}) for fill ${fill.id}`
      )
      return
    }

    // Denormalize coordinates from 0-1 range and clamp to valid pixel bounds
    const rawTargetX = Math.floor(fill.x * width)
    const rawTargetY = Math.floor(fill.y * height)
    if (!Number.isFinite(rawTargetX) || !Number.isFinite(rawTargetY)) {
      console.warn(
        `Canvas: Fill ${fill.id} has invalid normalized coordinates (${fill.x},${fill.y}), skipping`
      )
      fillGraphics.set(fill.id, null)
      return
    }
    const targetX = Math.min(Math.max(rawTargetX, 0), width - 1)
    const targetY = Math.min(Math.max(rawTargetY, 0), height - 1)

    // Parse fill color (hex string like '#FF6B6B') to RGB
    const fillColor = hexToRgb(fill.color)
    if (!fillColor) {
      console.error(
        `Canvas: Cannot parse fill color "${fill.color}" for fill ${fill.id}. Permanently skipping.`
      )
      // Mark as permanently failed - invalid color won't change
      fillGraphics.set(fill.id, null)
      return
    }

    // Get target color at click point
    const idx = (targetY * width + targetX) * 4
    const targetR = pixels[idx]
    const targetG = pixels[idx + 1]
    const targetB = pixels[idx + 2]

    // Don't fill if already the same color
    if (targetR === fillColor.r && targetG === fillColor.g && targetB === fillColor.b) {
      // Mark as processed with null to prevent repeated pixel extraction
      // No-op fills should not be re-evaluated even if the seed pixel changes later
      fillGraphics.set(fill.id, null)
      return
    }

    // BFS flood fill on pixel data
    const filled = floodFill(
      pixels,
      width,
      height,
      targetX,
      targetY,
      targetR,
      targetG,
      targetB,
      fillColor
    )

    // Draw filled pixels as 1x1 rectangles grouped by scanlines for efficiency
    const fillHex = parseInt(fill.color.replace('#', ''), 16)
    const graphics = new Graphics()
    for (let y = 0; y < height; y++) {
      let runStart = -1
      for (let x = 0; x <= width; x++) {
        const isFilled = x < width && filled[y * width + x]
        if (isFilled && runStart === -1) {
          runStart = x
        } else if (!isFilled && runStart !== -1) {
          graphics.rect(runStart, y, x - runStart, 1).fill({ color: fillHex })
          runStart = -1
        }
      }
    }

    drawingContainer.addChild(graphics)
    fillGraphics.set(fill.id, graphics)
  }

  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
      : null
  }

  function floodFill(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    startX: number,
    startY: number,
    targetR: number,
    targetG: number,
    targetB: number,
    fillColor: { r: number; g: number; b: number }
  ): Uint8Array {
    const filled = new Uint8Array(width * height)
    const visited = new Uint8Array(width * height)
    const stack: number[] = [startY * width + startX]

    while (stack.length > 0) {
      const pos = stack.pop()!
      if (visited[pos]) continue
      visited[pos] = 1

      const x = pos % width
      const y = Math.floor(pos / width)
      const pixelIdx = pos * 4

      if (
        pixels[pixelIdx] !== targetR ||
        pixels[pixelIdx + 1] !== targetG ||
        pixels[pixelIdx + 2] !== targetB
      ) {
        continue
      }

      filled[pos] = 1

      if (x > 0) stack.push(pos - 1)
      if (x < width - 1) stack.push(pos + 1)
      if (y > 0) stack.push(pos - width)
      if (y < height - 1) stack.push(pos + width)
    }

    return filled
  }

  export function addRemoteStroke(stroke: Stroke) {
    drawStroke(stroke)
  }

  export function updateRemoteStroke(strokeId: string, point: Point) {
    const graphics = strokeGraphics.get(strokeId)
    if (!graphics) {
      console.warn(`Graphics not found for stroke ${strokeId}`)
      return false
    }

    const existingStroke = strokes.find((s) => s.id === strokeId)
    if (!existingStroke) {
      console.warn(`Stroke not found for update ${strokeId}`)
      return false
    }

    const points = existingStroke.points || []

    if (points.length < 1) return true

    const lastPt = points[points.length - 1]

    if (lastPt.x === point.x && lastPt.y === point.y) return true

    graphics.blendMode = existingStroke.eraser ? 'erase' : 'normal'
    graphics.moveTo(lastPt.x, lastPt.y).lineTo(point.x, point.y).stroke({
      width: existingStroke.size,
      color: existingStroke.color,
      cap: 'round',
    })

    return true
  }

  export function clearCanvas() {
    // Reset active stroke state first to prevent pointer-move on destroyed objects
    isDrawing = false
    currentGraphics = null
    currentStrokeId = null
    lastPoint = null

    for (const graphics of strokeGraphics.values()) {
      graphics.destroy()
    }
    strokeGraphics.clear()
    for (const graphics of fillGraphics.values()) {
      graphics?.destroy()
    }
    fillGraphics.clear()
    prevOperationSignatures = null
    prevOperationTimestamps = null
  }
</script>

<div
  bind:this={container}
  class="canvas-container"
  class:cursor-crosshair={tool === 'fill'}
  class:cursor-cell={tool === 'eraser'}
>
  {#if !app}
    <div class="loading-overlay">
      {#if initError}
        <span class="px-4 text-center text-sm text-[#ff6b6b]">{initError}</span>
      {:else}
        <div class="spinner"></div>
        <span>Initializing Canvas...</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .canvas-container {
    width: 100%;
    height: 100%;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow:
      0 25px 50px -12px rgb(0 0 0 / 0.5),
      inset 0 0 0 1px rgb(255 255 255 / 0.1);
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #1a1a2e;
    color: white;
    gap: 16px;
    z-index: 10;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #4ecdc4;
    animation: spin 1s ease-in-out infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
