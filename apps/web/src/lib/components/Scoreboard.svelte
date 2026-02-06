<script lang="ts">
  import type { Player, ScoreEntry } from '$lib/types'

  interface Props {
    scores: Record<string, ScoreEntry>
    players: Player[]
    currentDrawerId: string | null
    currentPlayerId: string
  }

  let { scores, players, currentDrawerId, currentPlayerId }: Props = $props()

  // Sort players by score (descending)
  const rankedPlayers = $derived(
    [...players]
      .map((p) => ({
        ...p,
        score: scores[p.id]?.score ?? 0,
        isDrawing: p.id === currentDrawerId,
        isYou: p.id === currentPlayerId,
      }))
      .sort((a, b) => b.score - a.score)
  )
</script>

<div class="scoreboard">
  <h3 class="title">🏆 Scoreboard</h3>

  <div class="scores">
    {#each rankedPlayers as player, index (player.id)}
      <div class="score-row" class:is-drawing={player.isDrawing} class:is-you={player.isYou}>
        <span class="rank">
          {#if index === 0}
            🥇
          {:else if index === 1}
            🥈
          {:else if index === 2}
            🥉
          {:else}
            {index + 1}
          {/if}
        </span>
        <span class="player-indicator" style="background-color: {player.color}"></span>
        <span class="player-name">
          {player.name}
          {#if player.isYou}
            <span class="you-tag">(you)</span>
          {/if}
          {#if player.isDrawing}
            <span class="drawing-tag">🎨</span>
          {/if}
        </span>
        <span class="score">{player.score}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .scoreboard {
    padding: 16px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 12px;
    backdrop-filter: blur(20px);
    border: 1px solid rgb(255 255 255 / 0.1);
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgb(255 255 255 / 0.5);
    margin: 0 0 12px;
  }

  .scores {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .score-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: rgb(255 255 255 / 0.05);
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .score-row.is-drawing {
    background: linear-gradient(135deg, rgb(78 205 196 / 0.15), rgb(69 183 209 / 0.15));
    border: 1px solid rgb(78 205 196 / 0.3);
  }

  .score-row.is-you {
    background: rgb(255 255 255 / 0.08);
  }

  .rank {
    min-width: 24px;
    text-align: center;
    font-size: 14px;
  }

  .player-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .player-name {
    flex: 1;
    font-size: 13px;
    color: rgb(255 255 255 / 0.9);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .you-tag {
    font-size: 11px;
    color: rgb(255 255 255 / 0.5);
  }

  .drawing-tag {
    font-size: 12px;
  }

  .score {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: 14px;
    color: #4ecdc4;
  }
</style>
