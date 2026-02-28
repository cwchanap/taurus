// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import Canvas from './Canvas.svelte'

const pixiState = vi.hoisted(() => {
  return {
    apps: [] as unknown[],
  }
})

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
    })

    expect(component.updateRemoteStroke('missing', { x: 3, y: 3 })).toBe(false)
    expect(component.updateRemoteStroke('s1', { x: 3, y: 3 })).toBe(true)

    component.clearCanvas()
  })
})
