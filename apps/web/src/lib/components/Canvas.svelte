<script lang="ts">
  import { Application, Graphics } from 'pixi.js'
  import { onMount, onDestroy } from 'svelte'
  import type { Point, Stroke } from '$lib/types'

  interface Props {
    color: string
    brushSize: number
    strokes: Stroke[]
    playerId: string
    onStrokeStart: (stroke: Stroke) => void
    onStrokeUpdate: (strokeId: string, point: Point) => void
  }

  let { color, brushSize, strokes, playerId, onStrokeStart, onStrokeUpdate }: Props = $props()

  let container: HTMLDivElement
  let mounted = false
  let app = $state.raw<Application | null>(null)
  let currentGraphics: Graphics | null = null
  let currentStrokeId: string | null = null
  let isDrawing = false
  let lastPoint: Point | null = null
  let strokeGraphics: Map<string, Graphics> = new Map()
  let strokeColor = ''
  let strokeSize = 0

  $effect(() => {
    if (!app) return

    // ID-based reconciliation to ensure we don't leak Graphics or miss updates.
    // We compute the set of current IDs to detect removals and additions.
    const currentStrokeIds = new Set(strokes.map((s) => s.id))

    // Dev-mode check: Ensure no two strokes have the same ID
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

  onMount(async () => {
    mounted = true
    const pixiApp = new Application()
    await pixiApp.init({
      background: '#1a1a2e',
      resizeTo: container,
      antialias: true,
    })
    container.appendChild(pixiApp.canvas)

    pixiApp.stage.eventMode = 'static'
    pixiApp.stage.hitArea = pixiApp.screen

    pixiApp.stage.on('pointerdown', onPointerDown)
    pixiApp.stage.on('pointermove', onPointerMove)
    pixiApp.stage.on('pointerup', onPointerUp)
    pixiApp.stage.on('pointerupoutside', onPointerUp)

    // Assign to app state only after full initialization
    // This will trigger any effects that depend on app being ready
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
    if (!app) return
    isDrawing = true
    currentStrokeId = crypto.randomUUID()

    const point = { x: event.global.x, y: event.global.y }
    lastPoint = point

    currentGraphics = new Graphics()
    app.stage.addChild(currentGraphics)
    strokeGraphics.set(currentStrokeId, currentGraphics)

    strokeColor = color
    strokeSize = brushSize

    const stroke: Stroke = {
      id: currentStrokeId,
      playerId,
      points: [point],
      color: strokeColor,
      size: strokeSize,
    }

    onStrokeStart(stroke)
  }

  function onPointerMove(event: { global: { x: number; y: number } }) {
    if (!isDrawing || !currentGraphics || !currentStrokeId || !lastPoint) return

    const point = { x: event.global.x, y: event.global.y }

    currentGraphics
      .moveTo(lastPoint.x, lastPoint.y)
      .lineTo(point.x, point.y)
      .stroke({ width: strokeSize, color: strokeColor, cap: 'round' })

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
    if (stroke.points.length < 1 || !app) return

    let graphics = strokeGraphics.get(stroke.id)
    if (!graphics) {
      graphics = new Graphics()
      app.stage.addChild(graphics)
      strokeGraphics.set(stroke.id, graphics)
    }

    graphics.clear()
    for (let i = 1; i < stroke.points.length; i++) {
      graphics
        .moveTo(stroke.points[i - 1].x, stroke.points[i - 1].y)
        .lineTo(stroke.points[i].x, stroke.points[i].y)
        .stroke({ width: stroke.size, color: stroke.color, cap: 'round' })
    }
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

    // Need at least 2 points to draw a line
    if (points.length < 2) return true

    const lastPt = points[points.length - 1]

    // Skip if duplicate point
    if (lastPt.x === point.x && lastPt.y === point.y) return true

    graphics
      .moveTo(lastPt.x, lastPt.y)
      .lineTo(point.x, point.y)
      .stroke({ width: existingStroke.size, color: existingStroke.color, cap: 'round' })

    return true
  }

  export function clearCanvas() {
    for (const graphics of strokeGraphics.values()) {
      graphics.destroy()
    }
    strokeGraphics.clear()
  }
</script>

<div bind:this={container} class="canvas-container">
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
