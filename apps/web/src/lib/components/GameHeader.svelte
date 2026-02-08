<script lang="ts">
  interface Props {
    status: 'lobby' | 'playing' | 'round-end' | 'game-over'
    currentWord: string | undefined
    wordLength: number
    timeRemaining: number
    currentDrawerName: string
    isCurrentDrawer: boolean
    roundNumber: number
    totalRounds: number
  }

  let {
    status,
    currentWord,
    wordLength,
    timeRemaining,
    currentDrawerName,
    isCurrentDrawer,
    roundNumber,
    totalRounds,
  }: Props = $props()

  // Generate masked word (underscores with spaces) - always mask, never reveal
  const maskedWord = $derived(wordLength > 0 ? Array(wordLength).fill('_').join(' ') : '')

  // Format time as MM:SS
  const formattedTime = $derived.by(() => {
    const totalSeconds = Math.floor(Math.max(timeRemaining, 0))
    const mins = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  })

  // Determine timer color based on time remaining
  const timerClass = $derived(timeRemaining <= 10 ? 'urgent' : timeRemaining <= 30 ? 'warning' : '')
</script>

{#if status === 'playing' || status === 'round-end'}
  <div class="game-header">
    <div class="round-info">
      <span class="round-badge">Round {roundNumber}/{totalRounds}</span>
    </div>

    <div class="word-display">
      {#if isCurrentDrawer}
        <span class="word-label">Draw:</span>
        <span class="word">{currentWord || '—'}</span>
      {:else}
        <span class="word-label">Guess:</span>
        {#if wordLength > 0}
          <span class="word masked">{maskedWord}</span>
          <span class="word-hint">({wordLength} letters)</span>
        {/if}
      {/if}
    </div>

    <div class="timer-display {timerClass}">
      <svg
        class="timer-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      <span class="time">{formattedTime}</span>
    </div>

    <div class="drawer-info">
      {#if isCurrentDrawer}
        <span class="drawer-badge you">🎨 You're drawing!</span>
      {:else}
        <span class="drawer-badge">🎨 {currentDrawerName || 'Someone'} is drawing</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .game-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    padding: 12px 24px;
    background: linear-gradient(135deg, rgb(78 205 196 / 0.15), rgb(69 183 209 / 0.15));
    border-radius: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .round-info {
    display: flex;
    align-items: center;
  }

  .round-badge {
    background: rgb(255 255 255 / 0.1);
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: rgb(255 255 255 / 0.8);
  }

  .word-display {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .word-label {
    font-size: 14px;
    color: rgb(255 255 255 / 0.6);
  }

  .word {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #4ecdc4;
  }

  .word.masked {
    font-family: 'JetBrains Mono', monospace;
    letter-spacing: 4px;
    color: #ffeaa7;
  }

  .word-hint {
    font-size: 12px;
    color: rgb(255 255 255 / 0.5);
  }

  .timer-display {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: rgb(255 255 255 / 0.1);
    border-radius: 10px;
    transition: all 0.3s ease;
  }

  .timer-display.warning {
    background: rgb(255 234 167 / 0.2);
    color: #ffeaa7;
  }

  .timer-display.urgent {
    background: rgb(255 107 107 / 0.2);
    color: #ff6b6b;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.05);
    }
  }

  .timer-icon {
    width: 20px;
    height: 20px;
  }

  .time {
    font-family: 'JetBrains Mono', monospace;
    font-size: 20px;
    font-weight: 700;
  }

  .drawer-info {
    display: flex;
    align-items: center;
  }

  .drawer-badge {
    padding: 6px 12px;
    background: rgb(255 255 255 / 0.1);
    border-radius: 8px;
    font-size: 13px;
    color: rgb(255 255 255 / 0.8);
  }

  .drawer-badge.you {
    background: linear-gradient(135deg, rgb(78 205 196 / 0.3), rgb(69 183 209 / 0.3));
    color: #4ecdc4;
    font-weight: 600;
  }
</style>
