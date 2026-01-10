<script lang="ts">
  import { browser } from '$app/environment'
  import Canvas from '$lib/components/Canvas.svelte'
  import Toolbar from '$lib/components/Toolbar.svelte'
  import PlayerList from '$lib/components/PlayerList.svelte'
  import Lobby from '$lib/components/Lobby.svelte'
  import { GameWebSocket } from '$lib/websocket'
  import { onDestroy } from 'svelte'
  import type { Player, Stroke, Point } from '$lib/types'

  // API URL - configurable via VITE_API_URL environment variable
  const API_URL =
    import.meta.env.VITE_API_URL ||
    (browser ? (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin) : '')

  let gameState = $state<'lobby' | 'game'>('lobby')
  let roomId = $state('')
  let playerName = $state('')
  let playerId = $state('')
  let players = $state<Player[]>([])
  let strokes = $state<Stroke[]>([])
  let isLoading = $state(false)
  let isConnected = $state(false)
  let errorMessage = $state('')

  let color = $state('#4ECDC4')
  let brushSize = $state(8)

  let ws: GameWebSocket | null = null
  let canvasComponent = $state<Canvas>()

  async function createRoom() {
    isLoading = true
    errorMessage = ''

    try {
      const res = await fetch(`${API_URL}/api/rooms`, { method: 'POST' })

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error')
        throw new Error(`Server error (${res.status}): ${errorText}`)
      }

      let data
      try {
        data = await res.json()
      } catch {
        throw new Error('Invalid response from server')
      }

      if (!data.roomId) {
        throw new Error('Server did not return a room ID')
      }

      roomId = data.roomId
      connectToRoom()
    } catch (e) {
      console.error('Failed to create room:', e)
      errorMessage = e instanceof Error ? e.message : 'Failed to create room. Please try again.'
      isLoading = false
    }
  }

  function joinRoom(code: string) {
    roomId = code
    isLoading = true
    errorMessage = ''
    connectToRoom()
  }

  function connectToRoom() {
    if (ws) ws.disconnect()
    ws = new GameWebSocket(API_URL, roomId, playerName)

    ws.on({
      onConnectionChange: (connected) => {
        isConnected = connected
      },
      onConnectionFailed: (reason) => {
        errorMessage = reason
      },
      onInit: (id, player, playerList, strokeList) => {
        playerId = id
        players = playerList
        // Clear canvas before applying new state to avoid desync
        canvasComponent?.clearCanvas()
        strokes = strokeList
        gameState = 'game'
        isLoading = false
      },
      onPlayerJoined: (player) => {
        players = [...players, player]
      },
      onPlayerLeft: (id) => {
        players = players.filter((p) => p.id !== id)
      },
      onStroke: (stroke) => {
        strokes = [...strokes, stroke]
        canvasComponent?.addRemoteStroke(stroke)
      },
      onStrokeUpdate: (strokeId, point) => {
        const index = strokes.findIndex((s) => s.id === strokeId)
        if (index !== -1) {
          // Mutating stroke.points is efficient for drawing, but to satisfy
          // Svelte 5 state management we should ideally be immutable.
          // However, for high-frequency updates (drawing), creating new arrays
          // every 16ms might be costly.
          strokes[index].points = [...strokes[index].points, point]
        }
        canvasComponent?.updateRemoteStroke(strokeId, point)
      },
      onClear: () => {
        strokes = []
        canvasComponent?.clearCanvas()
      },
    })

    ws.connect()
  }

  onDestroy(() => {
    ws?.disconnect()
  })

  function handleStrokeStart(stroke: Stroke) {
    strokes = [...strokes, stroke]
    ws?.sendStroke(stroke)
  }

  function handleStrokeUpdate(strokeId: string, point: Point) {
    const index = strokes.findIndex((s) => s.id === strokeId)
    if (index !== -1) {
      strokes[index].points = [...strokes[index].points, point]
    }
    ws?.sendStrokeUpdate(strokeId, point)
  }

  function handleClear() {
    strokes = []
    canvasComponent?.clearCanvas()
    ws?.sendClear()
  }
</script>

<svelte:head>
  <title>Draw Together</title>
  <meta
    name="description"
    content="A multiplayer drawing game - draw together with friends in real-time!"
  />
</svelte:head>

{#if gameState === 'lobby'}
  <Lobby
    {playerName}
    onPlayerNameChange={(name) => (playerName = name)}
    onCreateRoom={createRoom}
    onJoinRoom={joinRoom}
    {isLoading}
    {errorMessage}
  />
{:else}
  <div class="game-container">
    <header class="game-header">
      <h1 class="game-title">🎨 Draw Together</h1>
      <div class="room-info">
        <span class="room-label">Room:</span>
        <span class="room-code">{roomId}</span>
        <span class="connection-status" class:connected={isConnected}></span>
        {#if errorMessage}
          <span class="error-badge">{errorMessage}</span>
        {/if}
      </div>
    </header>

    <div class="game-layout">
      <aside class="sidebar left">
        <Toolbar
          {color}
          {brushSize}
          onColorChange={(c) => (color = c)}
          onBrushSizeChange={(s) => (brushSize = s)}
          onClear={handleClear}
        />
      </aside>

      <main class="canvas-area">
        <Canvas
          bind:this={canvasComponent}
          {color}
          {brushSize}
          {strokes}
          onStrokeStart={handleStrokeStart}
          onStrokeUpdate={handleStrokeUpdate}
        />
      </main>

      <aside class="sidebar right">
        <PlayerList {players} currentPlayerId={playerId} />
      </aside>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family:
      'Inter',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: white;
    min-height: 100vh;
  }

  .game-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .game-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: rgb(0 0 0 / 0.2);
    border-bottom: 1px solid rgb(255 255 255 / 0.05);
  }

  .game-title {
    font-size: 24px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .room-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .room-label {
    color: rgb(255 255 255 / 0.5);
    font-size: 14px;
  }

  .room-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
    padding: 6px 12px;
    background: rgb(255 255 255 / 0.1);
    border-radius: 8px;
  }

  .connection-status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff6b6b;
    margin-left: 8px;
  }

  .connection-status.connected {
    background: #4ecdc4;
    box-shadow: 0 0 10px #4ecdc4;
  }

  .error-badge {
    padding: 4px 12px;
    background: rgb(255 107 107 / 0.15);
    border: 1px solid rgb(255 107 107 / 0.3);
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 12px;
    margin-left: 8px;
  }

  .game-layout {
    flex: 1;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 24px;
    padding: 24px;
  }

  .sidebar {
    width: 200px;
  }

  .canvas-area {
    min-height: 500px;
    display: flex;
  }
</style>
