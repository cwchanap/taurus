<script lang="ts">
  import { Application, Graphics, Container } from 'pixi.js'
  import { onMount, onDestroy } from 'svelte'
  import type { Point, Stroke, FillOperation } from '@repo/types'

  type Tool = 'pencil' | 'eraser' | 'fill'

  interface Props {
    color: string
    brushSize: number
    tool: Tool
    strokes: Stroke[]
    fills: FillOperation[]
    playerId: string
    disabled?: boolean
    onStrokeStart: (stroke: Stroke) => void
    onStrokeUpdate: (strokeId: string, point: Point) => void
    onFill: (x: number, y: number, color: string) => void
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
  let fillGraphics: Map<string, Graphics> = new Map()
  let strokeColor = ''
  let strokeSize = 0
  let currentIsEraser = false

  // Reconcile strokes whenever strokes prop changes
  $effect(() => {
    if (!app || !drawingContainer) return

    const currentStrokeIds = new Set(strokes.map((s) => s.id))

    if (import.meta.env.DEV && currentStrokeIds.size !== strokes.length) {
      console.error('Canvas: Duplicate stroke IDs detected!')
    }

    // Remove deleted strokes
    for (const [id, graphics] of strokeGraphics.entries()) {
      if (!currentStrokeIds.has(id)) {
        graphics.destroy()
        strokeGraphics.delete(id)
      }
    }

    // Add new strokes
    for (const stroke of strokes) {
      if (!strokeGraphics.has(stroke.id)) {
        drawStroke(stroke)
      }
    }
  })

  // Reconcile fills whenever fills prop changes
  $effect(() => {
    if (!app || !drawingContainer) return

    const currentFillIds = new Set(fills.map((f) => f.id))

    // Remove deleted fills
    for (const [id, graphics] of fillGraphics.entries()) {
      if (!currentFillIds.has(id)) {
        graphics.destroy()
        fillGraphics.delete(id)
      }
    }

    // Add new fills
    for (const fill of fills) {
      if (!fillGraphics.has(fill.id)) {
        applyFill(fill)
      }
    }
  })

  onMount(async () => {
    mounted = true
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
    })

    if (!mounted) {
      pixiApp.destroy(true)
      return
    }
    app = pixiApp
  })

  onDestroy(() => {
    mounted = false
    app?.destroy(true)
  })

  function onPointerDown(event: { global: { x: number; y: number } }) {
    if (!app || !drawingContainer || disabled) return

    const point = { x: event.global.x, y: event.global.y }

    if (tool === 'fill') {
      onFill(point.x, point.y, color)
      return
    }

    isDrawing = true
    currentStrokeId = crypto.randomUUID()
    lastPoint = point
    currentIsEraser = tool === 'eraser'

    currentGraphics = new Graphics()
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
    }

    onStrokeStart(stroke)
  }

  function onPointerMove(event: { global: { x: number; y: number } }) {
    if (!isDrawing || !currentGraphics || !currentStrokeId || !lastPoint) return

    const point = { x: event.global.x, y: event.global.y }

    currentGraphics
      .moveTo(lastPoint.x, lastPoint.y)
      .lineTo(point.x, point.y)
      .stroke({
        width: strokeSize,
        color: currentIsEraser ? CANVAS_BG : strokeColor,
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

    graphics.clear()
    for (let i = 1; i < stroke.points.length; i++) {
      graphics
        .moveTo(stroke.points[i - 1].x, stroke.points[i - 1].y)
        .lineTo(stroke.points[i].x, stroke.points[i].y)
        .stroke({
          width: stroke.size,
          color: stroke.eraser ? CANVAS_BG : stroke.color,
          cap: 'round',
        })
    }
  }

  function applyFill(fill: FillOperation) {
    if (!app || !drawingContainer) return

    // Extract from the full stage (includes background layer) so empty canvas areas
    // read as the background color rather than transparent, preventing runaway fills.
    const extracted = app.renderer.extract.pixels(app.stage)
    const { pixels, width, height } = extracted

    const targetX = Math.round(fill.x)
    const targetY = Math.round(fill.y)

    if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) return

    // Parse fill color (hex string like '#FF6B6B') to RGB
    const fillColor = hexToRgb(fill.color)
    if (!fillColor) return

    // Get target color at click point
    const idx = (targetY * width + targetX) * 4
    const targetR = pixels[idx]
    const targetG = pixels[idx + 1]
    const targetB = pixels[idx + 2]

    // Don't fill if already the same color
    if (targetR === fillColor.r && targetG === fillColor.g && targetB === fillColor.b) return

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
    const stack: number[] = [startY * width + startX]

    while (stack.length > 0) {
      const pos = stack.pop()!
      if (filled[pos]) continue

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

    graphics
      .moveTo(lastPt.x, lastPt.y)
      .lineTo(point.x, point.y)
      .stroke({
        width: existingStroke.size,
        color: existingStroke.eraser ? CANVAS_BG : existingStroke.color,
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
      graphics.destroy()
    }
    fillGraphics.clear()
  }
</script>

<div
  bind:this={container}
  class="canvas-container"
  class:cursor-crosshair={tool === 'fill'}
  class:cursor-eraser={tool === 'eraser'}
>
  {#if !app}
    <div class="loading-overlay">
      <div class="spinner"></div>
      <span>Initializing Canvas...</span>
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

  .cursor-crosshair {
    cursor: crosshair;
  }

  .cursor-eraser {
    cursor: cell;
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
