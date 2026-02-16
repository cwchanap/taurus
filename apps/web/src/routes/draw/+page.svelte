<script lang="ts">
  import { browser } from '$app/environment'
  import Canvas from '$lib/components/Canvas.svelte'
  import Toolbar from '$lib/components/Toolbar.svelte'
  import PlayerList from '$lib/components/PlayerList.svelte'
  import ChatBox from '$lib/components/ChatBox.svelte'
  import Lobby from '$lib/components/Lobby.svelte'
  import GameHeader from '$lib/components/GameHeader.svelte'
  import Scoreboard from '$lib/components/Scoreboard.svelte'
  import { GameWebSocket } from '$lib/websocket'
  import { deriveGameWinners } from '$lib/game-winners'
  import { onDestroy } from 'svelte'
  import type {
    Player,
    Stroke,
    Point,
    ChatMessage,
    GameStatus,
    RoundResult,
    Winner,
    ScoreEntry,
  } from '$lib/types'

  // API URL - configurable via VITE_API_URL environment variable
  const API_URL =
    import.meta.env.VITE_API_URL ||
    (browser ? (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin) : '')

  let pageState = $state<'lobby' | 'game'>('lobby')
  let roomId = $state('')
  let playerName = $state('')
  let playerId = $state('')
  let players = $state<Player[]>([])
  let strokes = $state<Stroke[]>([])
  let chatMessages = $state<ChatMessage[]>([])
  let isLoading = $state(false)
  let isConnected = $state(false)
  let errorMessage = $state('')
  let isHost = $state(false)

  // Game state
  let gameStatus = $state<GameStatus>('lobby')
  let currentDrawerId = $state<string | null>(null)
  let currentDrawerName = $state('')
  let currentWord = $state<string | undefined>()
  let wordLength = $state(0)
  let roundNumber = $state(0)
  let totalRounds = $state(0)
  let timeRemaining = $state(0)
  let scores = $state<Record<string, ScoreEntry>>({})
  let lastRevealedWord = $state('')
  let lastRoundResult = $state<RoundResult | null>(null)
  let gameWinners = $state<Winner[]>([])
  let correctGuessNotification = $state<{ playerName: string; score: number } | null>(null)
  let systemNotification = $state<string | null>(null)
  let systemNotificationTimeoutId: ReturnType<typeof setTimeout> | null = null

  let color = $state('#4ECDC4')
  let brushSize = $state(8)

  let ws: GameWebSocket | null = null
  let canvasComponent = $state<Canvas>()
  let correctGuessTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Derived state
  const isCurrentDrawer = $derived(playerId === currentDrawerId)
  const canDraw = $derived(gameStatus === 'playing' && isCurrentDrawer)
  const canStartGame = $derived(isHost && gameStatus === 'lobby' && players.length >= 2)

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
      onInit: (id, player, playerList, strokeList, chatHistory, hostFlag, initialGameState) => {
        playerId = id
        players = playerList
        isHost = hostFlag
        // Clear canvas before applying new state to avoid desync
        canvasComponent?.clearCanvas()
        strokes = strokeList
        chatMessages = chatHistory
        // Initialize game state from server
        gameStatus = initialGameState.status
        currentDrawerId = initialGameState.currentDrawerId
        roundNumber = initialGameState.currentRound
        totalRounds = initialGameState.totalRounds
        scores = initialGameState.scores
        if (initialGameState.status === 'game-over') {
          gameWinners = deriveGameWinners(initialGameState.scores)
        } else {
          gameWinners = []
        }
        if (initialGameState.roundEndTime) {
          timeRemaining = Math.max(
            0,
            Math.ceil((initialGameState.roundEndTime - Date.now()) / 1000)
          )
        }

        // Restore drawer info and word length if game is in progress
        if (currentDrawerId) {
          const drawer = players.find((p) => p.id === currentDrawerId)
          if (drawer) {
            currentDrawerName = drawer.name
          } else {
            currentDrawerName = scores[currentDrawerId]?.name || 'Unknown'
          }
        }

        wordLength = initialGameState.wordLength ?? 0
        currentWord =
          initialGameState.currentWord !== undefined ? initialGameState.currentWord : undefined

        pageState = 'game'
        isLoading = false
      },
      onHostChange: (newHostId) => {
        isHost = newHostId === playerId
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
          canvasComponent?.updateRemoteStroke(strokeId, point)
          strokes[index].points.push(point)
        }
      },
      onClear: () => {
        strokes = []
        canvasComponent?.clearCanvas()
      },
      onChat: (message) => {
        chatMessages = [...chatMessages, message]
      },
      onSystemMessage: (content) => {
        systemNotification = content
        if (systemNotificationTimeoutId) {
          clearTimeout(systemNotificationTimeoutId)
        }
        // Clear notification after a few seconds
        systemNotificationTimeoutId = setTimeout(() => {
          systemNotification = null
          systemNotificationTimeoutId = null
        }, 4000)
      },
      // Game event handlers
      onGameStarted: (rounds, drawerOrder, initialScores) => {
        totalRounds = rounds
        scores = initialScores
        gameStatus = 'starting'
      },
      onRoundStart: (round, rounds, drawerId, drawerNameVal, word, wordLen, endTime) => {
        roundNumber = round
        totalRounds = rounds
        currentDrawerId = drawerId
        currentDrawerName = drawerNameVal
        currentWord = word
        wordLength = wordLen
        timeRemaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000))
        gameStatus = 'playing'
        lastRoundResult = null
        // Clear any pending correct-guess timeout before resetting notification
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
          correctGuessTimeoutId = null
        }
        correctGuessNotification = null
      },
      onRoundEnd: (word, result, newScores) => {
        lastRevealedWord = word
        lastRoundResult = result
        scores = newScores
        gameStatus = 'round-end'
        currentWord = undefined
        currentDrawerId = null
        currentDrawerName = ''
        wordLength = 0 // Reset to avoid showing stale masked word
      },
      onGameOver: (finalScores, winners) => {
        scores = finalScores
        gameWinners = winners
        gameStatus = 'game-over'
        currentDrawerId = null
        currentWord = undefined
      },
      onCorrectGuess: (guesserId, guesserName, score, remaining) => {
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
        }
        correctGuessNotification = { playerName: guesserName, score }
        // Clear notification after a few seconds
        correctGuessTimeoutId = setTimeout(() => {
          correctGuessNotification = null
          correctGuessTimeoutId = null
        }, 3000)
      },
      onTick: (remaining) => {
        timeRemaining = remaining
      },
      onGameReset: () => {
        // Clear correct-guess notification and timeout
        correctGuessNotification = null
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
          correctGuessTimeoutId = null
        }
        // Clear system notification and timeout
        systemNotification = null
        if (systemNotificationTimeoutId) {
          clearTimeout(systemNotificationTimeoutId)
          systemNotificationTimeoutId = null
        }

        // Reset local game state to lobby
        gameStatus = 'lobby'
        gameWinners = []
        lastRoundResult = null
        scores = {}
        currentDrawerId = null
        currentWord = undefined
        lastRevealedWord = ''
        roundNumber = 0
        totalRounds = 0
        strokes = []
        canvasComponent?.clearCanvas()
      },
    })

    ws.connect()
  }

  onDestroy(() => {
    ws?.disconnect()
    if (correctGuessTimeoutId) {
      clearTimeout(correctGuessTimeoutId)
    }
    if (systemNotificationTimeoutId) {
      clearTimeout(systemNotificationTimeoutId)
    }
  })

  function handleStrokeStart(stroke: Stroke) {
    strokes = [...strokes, stroke]
    ws?.sendStroke(stroke)
  }

  function handleStrokeUpdate(strokeId: string, point: Point) {
    const index = strokes.findIndex((s) => s.id === strokeId)
    if (index !== -1) {
      strokes[index].points.push(point)
    }
    ws?.sendStrokeUpdate(strokeId, point)
  }

  function handleClear() {
    strokes = []
    canvasComponent?.clearCanvas()
    ws?.sendClear()
  }

  function handleSendMessage(content: string) {
    ws?.sendChat(content)
  }

  function handleStartGame() {
    ws?.sendStartGame()
  }

  function handlePlayAgain() {
    // Inform server to reset the game - server will broadcast game-reset
    ws?.sendResetGame()

    // Clear local strokes immediately for better UX
    strokes = []
    canvasComponent?.clearCanvas()
  }
</script>

<svelte:head>
  <title>Draw Together</title>
  <meta
    name="description"
    content="A multiplayer drawing game - draw together with friends in real-time!"
  />
</svelte:head>

{#if pageState === 'lobby'}
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
    <header class="page-header">
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

    <!-- Game Header for active game -->
    {#if gameStatus === 'playing' || gameStatus === 'round-end'}
      <GameHeader
        status={gameStatus}
        {currentWord}
        {wordLength}
        {timeRemaining}
        {currentDrawerName}
        {isCurrentDrawer}
        {roundNumber}
        {totalRounds}
      />
    {/if}

    <!-- Correct guess notification -->
    {#if correctGuessNotification}
      <div class="correct-guess-notification">
        ✅ {correctGuessNotification.playerName} guessed correctly! +{correctGuessNotification.score}
        pts
      </div>
    {/if}

    <!-- System notification -->
    {#if systemNotification}
      <div class="system-notification">{systemNotification}</div>
    {/if}

    <!-- Round end overlay -->
    {#if gameStatus === 'round-end' && lastRoundResult}
      <div class="round-overlay">
        <div class="round-result">
          <h2>Round Over!</h2>
          <p class="revealed-word">The word was: <strong>{lastRevealedWord}</strong></p>
          <p>Next round starting soon...</p>
        </div>
      </div>
    {/if}

    <!-- Game over overlay -->
    {#if gameStatus === 'game-over'}
      <div class="game-over-overlay">
        <div class="game-over-content">
          <h2>🎉 Game Over!</h2>
          {#if gameWinners.length > 0}
            <div class="winners-list">
              <h3>{gameWinners.length > 1 ? 'Winners' : 'Winner'}</h3>
              {#each gameWinners as winner}
                <p class="winner">
                  <strong>{winner.playerName}</strong> with {winner.score} points!
                </p>
              {/each}
            </div>
          {:else}
            <p>No winner this time.</p>
          {/if}
          {#if isHost}
            <button class="play-again-btn" onclick={handlePlayAgain}>Play Again</button>
          {:else}
            <p class="waiting">Waiting for host to start a new game...</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="game-layout">
      <aside class="sidebar left">
        <Toolbar
          {color}
          {brushSize}
          onColorChange={(c) => (color = c)}
          onBrushSizeChange={(s) => (brushSize = s)}
          onClear={handleClear}
          disabled={!canDraw}
          clearDisabled={!(isHost || (gameStatus === 'playing' && isCurrentDrawer))}
        />

        <!-- Start Game button for host -->
        {#if gameStatus === 'lobby'}
          <div class="start-game-section">
            {#if canStartGame}
              <button class="start-game-btn" onclick={handleStartGame}> 🚀 Start Game </button>
            {:else if isHost}
              <p class="waiting-text">Need at least 2 players to start</p>
            {:else}
              <p class="waiting-text">Waiting for host to start...</p>
            {/if}
          </div>
        {/if}
      </aside>

      <main class="canvas-area">
        <Canvas
          bind:this={canvasComponent}
          {color}
          {brushSize}
          {strokes}
          {playerId}
          disabled={!canDraw}
          onStrokeStart={handleStrokeStart}
          onStrokeUpdate={handleStrokeUpdate}
        />
        <!-- Cannot draw indicator -->
        {#if gameStatus === 'playing' && !isCurrentDrawer}
          <div class="cannot-draw-indicator">👀 You're guessing! Type your answer in chat.</div>
        {/if}
      </main>

      <aside class="sidebar right">
        {#if gameStatus !== 'lobby'}
          <Scoreboard {scores} {players} {currentDrawerId} currentPlayerId={playerId} />
        {:else}
          <PlayerList {players} currentPlayerId={playerId} />
        {/if}
        <ChatBox
          messages={chatMessages}
          currentPlayerId={playerId}
          onSendMessage={handleSendMessage}
        />
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

  .page-header {
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
    flex-direction: column;
    position: relative;
  }

  .start-game-section {
    margin-top: 16px;
    padding: 16px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 12px;
    text-align: center;
  }

  .start-game-btn {
    width: 100%;
    padding: 14px 20px;
    font-size: 16px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .start-game-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgb(78 205 196 / 0.4);
  }

  .waiting-text {
    font-size: 13px;
    color: rgb(255 255 255 / 0.5);
    margin: 0;
  }

  .correct-guess-notification {
    position: fixed;
    top: 100px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: linear-gradient(135deg, rgb(78 205 196 / 0.9), rgb(69 183 209 / 0.9));
    border-radius: 12px;
    font-weight: 600;
    z-index: 100;
    animation: slideDown 0.3s ease;
  }

  .system-notification {
    position: fixed;
    top: 160px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: linear-gradient(135deg, rgb(255 193 7 / 0.9), rgb(255 152 0 / 0.9));
    border-radius: 12px;
    font-weight: 600;
    z-index: 100;
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .round-overlay,
  .game-over-overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .round-result,
  .game-over-content {
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    padding: 40px 60px;
    border-radius: 20px;
    text-align: center;
    border: 1px solid rgb(255 255 255 / 0.1);
  }

  .round-result h2,
  .game-over-content h2 {
    margin: 0 0 16px;
    font-size: 28px;
  }

  .revealed-word {
    font-size: 20px;
    color: #4ecdc4;
  }

  .winner {
    font-size: 20px;
    color: #ffeaa7;
  }

  .play-again-btn {
    margin-top: 20px;
    padding: 14px 32px;
    font-size: 16px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .play-again-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgb(78 205 196 / 0.4);
  }

  .waiting {
    color: rgb(255 255 255 / 0.5);
    font-size: 14px;
  }

  .cannot-draw-indicator {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: rgb(0 0 0 / 0.6);
    border-radius: 10px;
    font-size: 14px;
    color: rgb(255 255 255 / 0.8);
  }
</style>
