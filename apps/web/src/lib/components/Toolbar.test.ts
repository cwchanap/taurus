// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import Toolbar from './Toolbar.svelte'

afterEach(() => {
  cleanup()
})

describe('Toolbar', () => {
  it('switches eraser to pencil when selecting a color', async () => {
    const onColorChange = vi.fn()
    const onToolChange = vi.fn()

    render(Toolbar, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'eraser',
      canUndo: false,
      canRedo: false,
      onColorChange,
      onBrushSizeChange: vi.fn(),
      onToolChange,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onClear: vi.fn(),
      disabled: false,
      clearDisabled: false,
    })

    const colorButtons = screen.getAllByRole('button', { name: /select color/i })
    await fireEvent.click(colorButtons[0])

    expect(onToolChange).toHaveBeenCalledWith('pencil')
    expect(onColorChange).toHaveBeenCalled()
  })

  it('triggers brush/action callbacks', async () => {
    const onBrushSizeChange = vi.fn()
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const onClear = vi.fn()

    render(Toolbar, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      canUndo: true,
      canRedo: true,
      onColorChange: vi.fn(),
      onBrushSizeChange,
      onToolChange: vi.fn(),
      onUndo,
      onRedo,
      onClear,
      disabled: false,
      clearDisabled: false,
    })

    await fireEvent.click(screen.getAllByRole('button', { name: /brush size 16px/i })[0])
    await fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    await fireEvent.click(screen.getByRole('button', { name: /redo/i }))
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(onBrushSizeChange).toHaveBeenCalledWith(16)
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(1)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('does not switch tool when selecting color with pencil active', async () => {
    const onColorChange = vi.fn()
    const onToolChange = vi.fn()

    render(Toolbar, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      canUndo: false,
      canRedo: false,
      onColorChange,
      onBrushSizeChange: vi.fn(),
      onToolChange,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onClear: vi.fn(),
      disabled: false,
      clearDisabled: false,
    })

    const colorButtons = screen.getAllByRole('button', { name: /select color/i })
    await fireEvent.click(colorButtons[0])

    expect(onToolChange).not.toHaveBeenCalled()
    expect(onColorChange).toHaveBeenCalled()
  })

  it('calls onToolChange when tool buttons are clicked', async () => {
    const onToolChange = vi.fn()

    render(Toolbar, {
      color: '#4ECDC4',
      brushSize: 8,
      tool: 'pencil',
      canUndo: false,
      canRedo: false,
      onColorChange: vi.fn(),
      onBrushSizeChange: vi.fn(),
      onToolChange,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onClear: vi.fn(),
      disabled: false,
      clearDisabled: false,
    })

    await fireEvent.click(screen.getByRole('button', { name: /eraser tool/i }))
    expect(onToolChange).toHaveBeenCalledWith('eraser')

    await fireEvent.click(screen.getByRole('button', { name: /fill tool/i }))
    expect(onToolChange).toHaveBeenCalledWith('fill')

    await fireEvent.click(screen.getByRole('button', { name: /pencil tool/i }))
    expect(onToolChange).toHaveBeenCalledWith('pencil')
  })
})
