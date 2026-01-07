<script lang="ts">
  import { Application, Graphics } from 'pixi.js'
  import { onMount, onDestroy } from 'svelte'
  import type { Point, Stroke } from '$lib/types'

  interface Props {
    color: string
    brushSize: number
    strokes: Stroke[]
    onStrokeStart: (stroke: Stroke) => void
    onStrokeUpdate: (strokeId: string, point: Point) => void
  }

  let { color, brushSize, strokes, onStrokeStart, onStrokeUpdate }: Props = $props()

  let container: HTMLDivElement
  let mounted = false
  let app = $state.raw<Application | null>(null)
  let currentGraphics: Graphics | null = null
  let currentStrokeId: string | null = null
  let isDrawing = false
  let lastPoint: Point | null = null
  let strokeGraphics: Map<string, Graphics> = new Map()

  $effect(() => {
    if (!app) return

    // Remove graphics for strokes that no longer exist
    const currentStrokeIds = new Set(strokes.map((s) => s.id))
    for (const [id, graphics] of strokeGraphics) {
      if (!currentStrokeIds.has(id)) {
        graphics.destroy()
        strokeGraphics.delete(id)
      }
    }

    // Draw initial strokes and stay reactive to new ones
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

    const stroke: Stroke = {
      id: currentStrokeId,
      playerId: '',
      points: [point],
      color: color,
      size: brushSize,
    }

    onStrokeStart(stroke)
  }

  function onPointerMove(event: { global: { x: number; y: number } }) {
    if (!isDrawing || !currentGraphics || !currentStrokeId || !lastPoint) return

    const point = { x: event.global.x, y: event.global.y }

    currentGraphics
      .moveTo(lastPoint.x, lastPoint.y)
      .lineTo(point.x, point.y)
      .stroke({ width: brushSize, color: color, cap: 'round' })

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
      console.warn(`Stroke not found needed for update ${strokeId}`)
      return false
    }

    // Ensure points array exists
    if (!existingStroke.points) existingStroke.points = []

    // Append point if it's new (check against last point to avoid dupes/re-adding)
    const points = existingStroke.points
    const lastStored = points[points.length - 1]

    if (!lastStored || lastStored.x !== point.x || lastStored.y !== point.y) {
      points.push(point)
    }

    // Need at least 2 points to draw a line
    if (points.length < 2) return true

    const lastPt = points[points.length - 2]
    const newPt = points[points.length - 1]

    // Skip if no movement (redundant check but safe)
    if (lastPt.x === newPt.x && lastPt.y === newPt.y) return true

    graphics
      .moveTo(lastPt.x, lastPt.y)
      .lineTo(newPt.x, newPt.y)
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

<div bind:this={container} class="canvas-container"></div>

<style>
  .canvas-container {
    width: 100%;
    height: 100%;
    border-radius: 16px;
    overflow: hidden;
    box-shadow:
      0 25px 50px -12px rgb(0 0 0 / 0.5),
      inset 0 0 0 1px rgb(255 255 255 / 0.1);
  }
</style>
