// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/svelte'
import Toolbar from './Toolbar.svelte'
import type { PaletteColor } from '@repo/types'

afterEach(() => {
  cleanup()
})

type Tool = 'pencil' | 'eraser' | 'fill'

interface ToolbarProps {
  color: PaletteColor
  brushSize: number
  tool: Tool
  canUndo: boolean
  canRedo: boolean
  onColorChange: (color: PaletteColor) => void
  onBrushSizeChange: (size: number) => void
  onToolChange: (tool: Tool) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  disabled?: boolean
  clearDisabled?: boolean
}

function makeToolbarProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    color: '#4ECDC4',
    brushSize: 8,
    tool: 'pencil',
    canUndo: false,
    canRedo: false,
    onColorChange: vi.fn(),
    onBrushSizeChange: vi.fn(),
    onToolChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onClear: vi.fn(),
    disabled: false,
    clearDisabled: false,
    ...overrides,
  }
}

describe('Toolbar', () => {
  it('switches eraser to pencil when selecting a color', async () => {
    const props = makeToolbarProps({ tool: 'eraser' })
    render(Toolbar, props)

    // Find a non-active color button (different from current color)
    const colorButtons = screen.getAllByRole('button', { name: /select color/i })
    const nonActiveButton =
      colorButtons.find((btn) => !btn.classList.contains('active')) || colorButtons[0]
    await fireEvent.click(nonActiveButton)

    expect(props.onToolChange).toHaveBeenCalledWith('pencil')
    expect(props.onColorChange).toHaveBeenCalled()
  })

  it('triggers brush/action callbacks', async () => {
    const props = makeToolbarProps({ canUndo: true, canRedo: true })
    render(Toolbar, props)

    await fireEvent.click(screen.getAllByRole('button', { name: /brush size 16px/i })[0])
    await fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    await fireEvent.click(screen.getByRole('button', { name: /redo/i }))
    await fireEvent.click(screen.getByRole('button', { name: /clear/i }))

    expect(props.onBrushSizeChange).toHaveBeenCalledWith(16)
    expect(props.onUndo).toHaveBeenCalledTimes(1)
    expect(props.onRedo).toHaveBeenCalledTimes(1)
    expect(props.onClear).toHaveBeenCalledTimes(1)
  })

  it('does not switch tool when selecting color with pencil active', async () => {
    const props = makeToolbarProps()
    render(Toolbar, props)

    // Find a non-active color button (different from current color)
    const colorButtons = screen.getAllByRole('button', { name: /select color/i })
    const nonActiveButton =
      colorButtons.find((btn) => !btn.classList.contains('active')) || colorButtons[0]
    await fireEvent.click(nonActiveButton)

    expect(props.onToolChange).not.toHaveBeenCalled()
    expect(props.onColorChange).toHaveBeenCalled()
  })

  it('calls onToolChange when tool buttons are clicked', async () => {
    const props = makeToolbarProps()
    render(Toolbar, props)

    await fireEvent.click(screen.getByRole('button', { name: /eraser tool/i }))
    await fireEvent.click(screen.getByRole('button', { name: /fill tool/i }))
    await fireEvent.click(screen.getByRole('button', { name: /pencil tool/i }))

    expect(props.onToolChange).toHaveBeenCalledTimes(3)
    expect(props.onToolChange).toHaveBeenNthCalledWith(1, 'eraser')
    expect(props.onToolChange).toHaveBeenNthCalledWith(2, 'fill')
    expect(props.onToolChange).toHaveBeenNthCalledWith(3, 'pencil')
  })
})
