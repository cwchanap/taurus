<script lang="ts">
  import type { Player } from '$lib/types'

  interface Props {
    players: Player[]
    currentPlayerId: string
  }

  let { players, currentPlayerId }: Props = $props()

  function isValidColor(color: string) {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)
  }
</script>

<div class="player-list">
  <h3 class="title">Players</h3>
  <div class="players">
    {#each players as player}
      <div class="player" class:current={player.id === currentPlayerId}>
        <div
          class="avatar"
          style="background-color: {isValidColor(player.color) ? player.color : '#4ECDC4'}"
        >
          {(player.name?.trim() || '?').charAt(0).toUpperCase()}
        </div>
        <span class="name">
          {player.name}
          {#if player.id === currentPlayerId}
            <span class="you">(you)</span>
          {/if}
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .player-list {
    padding: 20px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 16px;
    backdrop-filter: blur(20px);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5);
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgb(255 255 255 / 0.5);
    margin: 0 0 16px;
  }

  .players {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 10px;
    transition: background 0.2s ease;
  }

  .player.current {
    background: rgb(255 255 255 / 0.05);
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    color: white;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  }

  .name {
    font-weight: 500;
    color: rgb(255 255 255 / 0.9);
  }

  .you {
    color: rgb(255 255 255 / 0.4);
    font-weight: 400;
    font-size: 13px;
  }
</style>
