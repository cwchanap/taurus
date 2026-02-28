<script lang="ts">
  import { PALETTE_COLORS } from '@repo/types'

  type Tool = 'pencil' | 'eraser' | 'fill'

  interface Props {
    color: string
    brushSize: number
    tool: Tool
    canUndo: boolean
    canRedo: boolean
    onColorChange: (color: string) => void
    onBrushSizeChange: (size: number) => void
    onToolChange: (tool: Tool) => void
    onUndo: () => void
    onRedo: () => void
    onClear: () => void
    disabled?: boolean
    clearDisabled?: boolean
  }

  let {
    color,
    brushSize,
    tool,
    canUndo,
    canRedo,
    onColorChange,
    onBrushSizeChange,
    onToolChange,
    onUndo,
    onRedo,
    onClear,
    disabled = false,
    clearDisabled = false,
  }: Props = $props()

  const colors = PALETTE_COLORS

  const sizes = [4, 8, 16]

  function handleColorChange(c: string) {
    // Selecting a color auto-switches back to pencil from eraser
    if (tool === 'eraser') {
      onToolChange('pencil')
    }
    onColorChange(c)
  }
</script>

<div class="toolbar" class:disabled>
  <div class="section">
    <span class="label">Tools</span>
    <div class="tool-grid">
      <button
        class="tool-btn"
        class:active={tool === 'pencil'}
        onclick={() => onToolChange('pencil')}
        aria-label="Pencil tool"
        aria-pressed={tool === 'pencil'}
        {disabled}
        title="Pencil"
      >
        <!-- Pencil icon -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      </button>
      <button
        class="tool-btn"
        class:active={tool === 'eraser'}
        onclick={() => onToolChange('eraser')}
        aria-label="Eraser tool"
        aria-pressed={tool === 'eraser'}
        {disabled}
        title="Eraser"
      >
        <!-- Eraser icon -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 20H7L3 16l11-11 6 6-1 2" />
          <path d="M6.0 11.0 L13.0 18.0" />
        </svg>
      </button>
      <button
        class="tool-btn"
        class:active={tool === 'fill'}
        onclick={() => onToolChange('fill')}
        aria-label="Fill tool"
        aria-pressed={tool === 'fill'}
        {disabled}
        title="Paint Bucket"
      >
        <!-- Paint bucket icon -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 11l-8-8-8.5 8.5a5.5 5.5 0 0 0 7.78 7.78L19 11z" />
          <path d="M20 16s0 3 1.5 4.5c1.5 1.5 3.5 0 3.5 0" stroke-width="1.5" />
          <line x1="2" y1="21" x2="22" y2="21" />
        </svg>
      </button>
    </div>
  </div>

  <div class="section">
    <span class="label">Colors</span>
    <div class="color-grid">
      {#each colors as c}
        <button
          class="color-btn"
          class:active={color === c}
          style="background-color: {c}"
          onclick={() => handleColorChange(c)}
          aria-label="Select color {c}"
          {disabled}
        ></button>
      {/each}
    </div>
  </div>

  <div class="section">
    <span class="label">Brush</span>
    <div class="size-grid">
      {#each sizes as size}
        <button
          class="size-btn"
          class:active={brushSize === size}
          onclick={() => onBrushSizeChange(size)}
          aria-label="Brush size {size}px"
          aria-pressed={brushSize === size}
          {disabled}
        >
          <span class="size-dot" style="width: {size}px; height: {size}px;"></span>
        </button>
      {/each}
    </div>
  </div>

  <div class="section">
    <div class="action-row">
      <button
        class="action-btn"
        onclick={onUndo}
        disabled={!canUndo || disabled}
        aria-label="Undo (Ctrl+Z)"
        title="Undo (Ctrl+Z)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
        Undo
      </button>
      <button
        class="action-btn"
        onclick={onRedo}
        disabled={!canRedo || disabled}
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo (Ctrl+Shift+Z)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 14 20 9 15 4" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
        Redo
      </button>
    </div>
    <button class="clear-btn" onclick={onClear} disabled={clearDisabled || disabled}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
      Clear
    </button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 20px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 16px;
    backdrop-filter: blur(20px);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgb(255 255 255 / 0.5);
  }

  .tool-grid {
    display: flex;
    gap: 8px;
  }

  .tool-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 2px solid transparent;
    background: rgb(255 255 255 / 0.1);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgb(255 255 255 / 0.7);
    padding: 10px;
  }

  .tool-btn svg {
    width: 20px;
    height: 20px;
  }

  .tool-btn:hover {
    background: rgb(255 255 255 / 0.15);
    color: white;
  }

  .tool-btn.active {
    border-color: #4ecdc4;
    background: rgb(78 205 196 / 0.2);
    color: #4ecdc4;
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .color-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 2px solid transparent;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
  }

  .color-btn:hover {
    transform: scale(1.1);
  }

  .color-btn.active {
    border-color: white;
    box-shadow:
      0 0 0 2px rgb(255 255 255 / 0.3),
      0 4px 6px -1px rgb(0 0 0 / 0.3);
  }

  .size-grid {
    display: flex;
    gap: 8px;
  }

  .size-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 2px solid transparent;
    background: rgb(255 255 255 / 0.1);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .size-btn:hover {
    background: rgb(255 255 255 / 0.15);
  }

  .size-btn.active {
    border-color: rgb(255 255 255 / 0.5);
    background: rgb(255 255 255 / 0.2);
  }

  .size-dot {
    background: white;
    border-radius: 50%;
  }

  .action-row {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 10px;
    background: rgb(255 255 255 / 0.1);
    border: none;
    border-radius: 10px;
    color: rgb(255 255 255 / 0.8);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .action-btn svg {
    width: 14px;
    height: 14px;
  }

  .action-btn:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.18);
    color: white;
  }

  .action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .clear-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: linear-gradient(135deg, #ff6b6b, #ee5a5a);
    border: none;
    border-radius: 12px;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 15px -3px rgb(238 90 90 / 0.5);
  }

  .clear-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px -3px rgb(238 90 90 / 0.6);
  }

  .clear-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Disabled state - only apply pointer-events: none to drawing controls,
     not the clear button which has its own disabled prop for host permissions */
  .toolbar.disabled {
    opacity: 0.5;
  }

  .toolbar.disabled .color-btn,
  .toolbar.disabled .size-btn,
  .toolbar.disabled .tool-btn {
    pointer-events: none;
  }

  .color-btn:disabled,
  .size-btn:disabled,
  .tool-btn:disabled,
  .clear-btn:disabled {
    cursor: not-allowed;
  }
</style>
