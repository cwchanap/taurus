<script lang="ts">
  interface Props {
    color: string
    brushSize: number
    onColorChange: (color: string) => void
    onBrushSizeChange: (size: number) => void
    onClear: () => void
    disabled?: boolean
  }

  let {
    color,
    brushSize,
    onColorChange,
    onBrushSizeChange,
    onClear,
    disabled = false,
  }: Props = $props()

  const colors = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#96CEB4',
    '#FFEAA7',
    '#DDA0DD',
    '#FFFFFF',
    '#1a1a2e',
  ]

  const sizes = [4, 8, 16]
</script>

<div class="toolbar" class:disabled>
  <div class="section">
    <span class="label">Colors</span>
    <div class="color-grid">
      {#each colors as c}
        <button
          class="color-btn"
          class:active={color === c}
          style="background-color: {c}"
          onclick={() => onColorChange(c)}
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
    <button class="clear-btn" onclick={onClear} {disabled}>
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

  /* Disabled state */
  .toolbar.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .color-btn:disabled,
  .size-btn:disabled,
  .clear-btn:disabled {
    cursor: not-allowed;
  }
</style>
