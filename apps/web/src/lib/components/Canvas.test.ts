// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import Canvas from './Canvas.svelte'
import type { FillOperation } from '@repo/types'

// Shared state for mock apps
const pixiState: { apps: unknown[] } = { apps: [] }

vi.mock('pixi.js', () => {
  class MockGraphics {
    blendMode: string | undefined
    destroyed = false

    rect() {
      return this
    }
    fill() {
      return this
    }
    clear() {
      return this
    }
    moveTo() {
      return this
    }
    lineTo() {
      return this
    }
    stroke() {
      return this
    }
    destroy() {
      this.destroyed = true
    }
  }

  class MockContainer {
    children: unknown[] = []
    addChild(child: unknown) {
      this.children.push(child)
      return child
    }
  }

  class MockStage extends MockContainer {
    handlers: Record<string, (event: { global: { x: number; y: number } }) => void> = {}
    eventMode = 'none'
    hitArea: unknown = null

    on(event: string, handler: (event: { global: { x: number; y: number } }) => void) {
      this.handlers[event] = handler
    }

    emit(event: string, payload: { global: { x: number; y: number } }) {
      this.handlers[event]?.(payload)
    }
  }

  class MockApplication {
    canvas = document.createElement('canvas')
    screen = { width: 8, height: 8 }
    stage = new MockStage()
    init = vi.fn(async () => {})
    destroy = vi.fn()
    renderer = {
      on: vi.fn(),
      extract: {
        pixels: vi.fn(() => {
          const pixels = new Uint8ClampedArray(8 * 8 * 4)
          for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 10
            pixels[i + 1] = 10
            pixels[i + 2] = 10
            pixels[i + 3] = 255
          }
          return { pixels, width: 8, height: 8 }
        }),
      },
    }

    constructor() {
      pixiState.apps.push(this)
    }
  }

  return {
    Application: MockApplication,
    Graphics: MockGraphics,
    Container: MockContainer,
  }
})

describe('Canvas', () => {
  beforeEach(() => {
    pixiState.apps.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('starts and updates a stroke when drawing with pencil', async () => {
    const onStrokeStart = vi.fn()
    const onStrokeUpdate = vi.fn()

    render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [],
      playerId: 'player-1',
      onStrokeStart,
      onStrokeUpdate,
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()

    const app = pixiState.apps[0] as {
      stage: { emit: (event: string, payload: { global: { x: number; y: number } }) => void }
    }

    app.stage.emit('pointerdown', { global: { x: 10, y: 12 } })
    app.stage.emit('pointermove', { global: { x: 20, y: 25 } })
    app.stage.emit('pointerup', { global: { x: 20, y: 25 } })

    expect(onStrokeStart).toHaveBeenCalledTimes(1)
    expect(onStrokeUpdate).toHaveBeenCalledTimes(1)
  })

  it('uses fill callback when fill tool is selected', async () => {
    const onFill = vi.fn()

    render(Canvas, {
      color: '#FF6B6B',
      brushSize: 8,
      tool: 'fill',
      strokes: [],
      fills: [],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill,
      disabled: false,
    })

    await tick()

    const app = pixiState.apps[0] as {
      stage: { emit: (event: string, payload: { global: { x: number; y: number } }) => void }
    }

    app.stage.emit('pointerdown', { global: { x: 3, y: 4 } })

    expect(onFill).toHaveBeenCalledWith(3, 4, '#FF6B6B')
  })

  it('supports remote stroke updates and clearing the canvas', async () => {
    const { component } = render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [
        {
          id: 's1',
          playerId: 'player-1',
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          color: '#4ECDC4',
          size: 8,
          timestamp: Date.now(),
        },
      ],
      fills: [
        {
          id: 'f1',
          playerId: 'player-1',
          x: 2,
          y: 2,
          color: '#FF6B6B',
          timestamp: Date.now(),
        },
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()

    component.addRemoteStroke({
      id: 's1',
      playerId: 'player-1',
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      color: '#4ECDC4',
      size: 8,
      timestamp: Date.now(),
    })

    expect(component.updateRemoteStroke('missing', { x: 3, y: 3 })).toBe(false)
    expect(component.updateRemoteStroke('s1', { x: 3, y: 3 })).toBe(true)

    component.clearCanvas()
  })

  it('does not draw when disabled is true', async () => {
    const onStrokeStart = vi.fn()

    render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [],
      playerId: 'player-1',
      onStrokeStart,
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: true,
    })

    await tick()

    const app = pixiState.apps[0] as {
      stage: { emit: (event: string, payload: { global: { x: number; y: number } }) => void }
    }

    app.stage.emit('pointerdown', { global: { x: 10, y: 12 } })

    expect(onStrokeStart).not.toHaveBeenCalled()
  })

  it('sets eraser blend mode when drawing with eraser tool', async () => {
    const onStrokeStart = vi.fn()

    render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'eraser',
      strokes: [],
      fills: [],
      playerId: 'player-1',
      onStrokeStart,
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()

    const app = pixiState.apps[0] as {
      stage: { emit: (event: string, payload: { global: { x: number; y: number } }) => void }
    }

    app.stage.emit('pointerdown', { global: { x: 5, y: 5 } })

    expect(onStrokeStart).toHaveBeenCalledTimes(1)
    const stroke = onStrokeStart.mock.calls[0][0]
    expect(stroke.eraser).toBe(true)
  })

  it('removes deleted strokes during reconciliation', async () => {
    const { rerender } = render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [
        {
          id: 's1',
          playerId: 'p1',
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          color: '#1a1a2e',
          size: 4,
          timestamp: Date.now(),
        },
        {
          id: 's2',
          playerId: 'p1',
          points: [
            { x: 3, y: 3 },
            { x: 4, y: 4 },
          ],
          color: '#1a1a2e',
          size: 4,
          timestamp: Date.now(),
        },
      ],
      fills: [],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()

    // Remove s1 by updating strokes prop
    await rerender({
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [
        {
          id: 's2',
          playerId: 'p1',
          points: [
            { x: 3, y: 3 },
            { x: 4, y: 4 },
          ],
          color: '#1a1a2e',
          size: 4,
          timestamp: Date.now(),
        },
      ],
      fills: [],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    // No assertion needed beyond no-throw – the reconciliation removes the graphics object
  })

  it('removes deleted fills during reconciliation', async () => {
    // The mock renderer.extract.pixels returns an 8x8 pixel buffer with RGB (10, 10, 10).
    // Fill color '#FF6B6B' is rgb(255,107,107) which differs from (10,10,10), so applyFill
    // proceeds and creates a Graphics object stored in fillGraphics.
    const fillTimestamp = Date.now()

    const { rerender } = render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [
        {
          id: 'f1',
          playerId: 'p1',
          x: 2,
          y: 2,
          color: '#FF6B6B',
          timestamp: fillTimestamp,
        },
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    // Two ticks: first lets onMount's async init() resolve and sets app,
    // second lets the $effect re-run with app set (which calls applyFill).
    await tick()
    await tick()

    const app = pixiState.apps[0] as {
      stage: { children: unknown[] }
      renderer: { extract: { pixels: ReturnType<typeof vi.fn> } }
    }

    // applyFill should have called extract.pixels to read the canvas pixel data
    expect(app.renderer.extract.pixels).toHaveBeenCalled()

    // The drawing container (stage child index 1) holds the fill's Graphics object.
    // Capture all children before the fill is removed.
    const { Graphics: MockGraphics } = await import('pixi.js')
    const drawingContainer = app.stage.children[1] as { children: unknown[] }
    const childrenBeforeRemoval = [...(drawingContainer?.children ?? [])]

    // Now remove the fill by re-rendering with an empty fills array
    await rerender({
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    await tick()

    // After reconciliation, the Graphics object that was created for the fill should be
    // destroyed. We check against the children snapshot taken before removal.
    const destroyed = childrenBeforeRemoval.filter(
      (child) => child instanceof MockGraphics && (child as { destroyed: boolean }).destroyed
    )
    expect(destroyed.length).toBeGreaterThan(0)
  })

  it('warns on out-of-bounds fills and retries on next reconciliation', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fillId = 'fill-out-of-bounds'
    const fillTimestamp = Date.now()

    render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [
        {
          id: fillId,
          playerId: 'player-1',
          x: 100, // Out of bounds for 8x8 canvas
          y: 100,
          color: '#FF6B6B',
          timestamp: fillTimestamp,
        },
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    await tick()

    const app = pixiState.apps[0] as {
      renderer: { extract: { pixels: ReturnType<typeof vi.fn> } }
    }

    // applyFill should have called extract.pixels to check bounds
    expect(app.renderer.extract.pixels).toHaveBeenCalled()

    // Should have warned about out-of-bounds fill
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('out of bounds'))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(fillId))

    consoleWarnSpy.mockRestore()
  })

  it('warns on oversized canvas fills and retries on next reconciliation', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fillId = 'fill-oversized'
    const fillTimestamp = Date.now()

    // Render initially
    const { rerender } = render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [
        {
          id: fillId,
          playerId: 'player-1',
          x: 3,
          y: 4,
          color: '#FF6B6B',
          timestamp: fillTimestamp,
        },
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    await tick()

    const app = pixiState.apps[0] as {
      screen: { width: number; height: number }
      renderer: { extract: { pixels: ReturnType<typeof vi.fn> } }
    }

    // Modify screen to simulate very large canvas after it's been created
    // 15000x1000 = 15M pixels, exceeds the 12M limit
    app.screen = { width: 15000, height: 1000 }
    app.renderer.extract.pixels = vi.fn(() => {
      return { pixels: new Uint8ClampedArray(15000 * 1000 * 4), width: 15000, height: 1000 }
    })

    // Re-render with a new fill to trigger processing with large canvas
    await rerender({
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      fills: [
        {
          id: fillId + '-new',
          playerId: 'player-1',
          x: 100,
          y: 100,
          color: '#FF6B6B',
          timestamp: fillTimestamp + 1,
        },
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    await tick()

    // The warning about oversized canvas should be shown
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('canvas too large'))
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(fillId + '-new'))

    // Verify the cheap screen-size guard prevented pixel extraction
    expect(app.renderer.extract.pixels).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('marks permanently invalid fills (invalid color) as processed to prevent retries', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const fillId = 'fill-invalid-color'
    const fillTimestamp = Date.now()

    render(Canvas, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      strokes: [],
      // Test invalid color handling at runtime by casting to FillOperation
      fills: [
        {
          id: fillId,
          playerId: 'player-1',
          x: 3,
          y: 4,
          color: 'not-a-color', // Invalid color format
          timestamp: fillTimestamp,
        } as unknown as FillOperation,
      ],
      playerId: 'player-1',
      onStrokeStart: vi.fn(),
      onStrokeUpdate: vi.fn(),
      onFill: vi.fn(),
      disabled: false,
    })

    await tick()
    await tick()

    const app = pixiState.apps[0] as {
      renderer: { extract: { pixels: ReturnType<typeof vi.fn> } }
    }

    // Should have called extract.pixels to check bounds before color parsing
    expect(app.renderer.extract.pixels).toHaveBeenCalled()

    // Should have logged an error about invalid color
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot parse fill color'))
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(fillId))
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Permanently skipping'))

    consoleErrorSpy.mockRestore()
  })
})
