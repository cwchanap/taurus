// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/svelte'

// Mock GameWebSocket to prevent real WebSocket connections
// Must use regular function (not arrow function) so `new GameWebSocket()` works as a constructor
vi.mock('$lib/websocket', () => ({
  GameWebSocket: vi.fn(function (this: Record<string, unknown>) {
    this.connect = vi.fn()
    this.disconnect = vi.fn()
    this.on = vi.fn()
    this.sendStroke = vi.fn(() => true)
    this.sendStrokeUpdate = vi.fn(() => true)
    this.sendFill = vi.fn(() => true)
    this.sendChat = vi.fn(() => true)
    this.sendUndoStroke = vi.fn(() => true)
    this.sendUndoFill = vi.fn(() => true)
    this.sendStartGame = vi.fn(() => true)
    this.sendResetGame = vi.fn(() => true)
    this.sendGuess = vi.fn(() => true)
    this.sendChooseWord = vi.fn(() => true)
  }),
}))

// Mock $app/environment — set browser: true so the conditional in +page.svelte
// evaluates the browser branch and API_URL becomes window.location.origin instead of ''
vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}))

import DrawPage from './+page.svelte'
import { GameWebSocket } from '$lib/websocket'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

/** Get the handlers registered by the most recently created GameWebSocket instance */
function getWsHandlers(): Record<string, (...args: unknown[]) => void> {
  const MockWS = vi.mocked(GameWebSocket)
  const instances = MockWS.mock.instances
  const instance = instances[instances.length - 1] as unknown as { on: ReturnType<typeof vi.fn> }
  if (!instance?.on?.mock?.calls?.length) return {}
  return instance.on.mock.calls[0][0] as Record<string, (...args: unknown[]) => void>
}

type DrawingState = { strokes: unknown[]; fills: unknown[] }
type DrawPageComponent = { getDrawingState: () => DrawingState }
const TEST_RECONNECT_TOKEN = 'reconnect-token-123'

/** Helper to simulate a player creating and joining a game room */
async function simulateJoinGame(playerName = 'Alice') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
      text: vi.fn().mockResolvedValue(''),
    })
  )

  const renderResult = render(DrawPage)
  const { component } = renderResult

  const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
  await fireEvent.input(nameInput, { target: { value: playerName } })

  const createButton = screen.getByRole('button', { name: 'Create Room' })
  await fireEvent.click(createButton)

  // Wait for WebSocket to be constructed with the correct roomId and playerName
  await waitFor(() => {
    expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
  })
  expect(vi.mocked(GameWebSocket)).toHaveBeenCalledWith(
    expect.any(String),
    'TEST-ROOM',
    playerName,
    undefined,
    undefined
  )

  const handlers = getWsHandlers()
  expect(handlers.onInit).toBeDefined()

  // Simulate server init event to transition to game state
  handlers.onInit(
    'player-123',
    { id: 'player-123', name: playerName, color: '#FF6B6B' },
    [{ id: 'player-123', name: playerName, color: '#FF6B6B' }],
    [], // strokes
    [], // fills
    [], // chatHistory
    true, // isHost
    {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      roundEndTime: null,
      scores: {},
      currentWord: undefined,
    },
    TEST_RECONNECT_TOKEN
  )

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
  })

  return { component: component as unknown as DrawPageComponent, unmount: renderResult.unmount }
}

describe('Draw page - lobby state', () => {
  it('renders the Lobby component on initial load', () => {
    render(DrawPage)

    expect(screen.getByRole('button', { name: 'Create Room' })).toBeTruthy()
    expect(screen.getByLabelText('Your Name')).toBeTruthy()
  })

  it('renders player name input and allows typing', async () => {
    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })
    expect(nameInput.value).toBe('Alice')
  })

  it('Create Room button is disabled when player name is empty', () => {
    render(DrawPage)

    const createButton = screen.getByRole('button', { name: 'Create Room' }) as HTMLButtonElement
    expect(createButton.disabled).toBe(true)
  })

  it('Join button is disabled when no room code entered', () => {
    render(DrawPage)

    const joinButton = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement
    expect(joinButton.disabled).toBe(true)
  })
})

describe('Draw page - room creation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a room and transitions to game state on successful fetch', async () => {
    await simulateJoinGame('Alice')

    // After onInit, we should be in game state (Lobby is gone)
    expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
    // Game title should be visible
    expect(screen.getByText('🎨 Draw Together')).toBeTruthy()
  })

  it('shows error message when room creation fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      })
    )

    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })

    const createButton = screen.getByRole('button', { name: 'Create Room' })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('handles join room directly by entering a room code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
        text: vi.fn().mockResolvedValue(''),
      })
    )

    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })

    const roomCodeInput = screen.getByLabelText('Room Code') as HTMLInputElement
    await fireEvent.input(roomCodeInput, { target: { value: 'ABC123' } })

    const joinButton = screen.getByRole('button', { name: 'Join' })
    await fireEvent.click(joinButton)

    // WebSocket should be created for the join flow with the entered room code and player name
    await waitFor(() => {
      expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
    })
    expect(vi.mocked(GameWebSocket)).toHaveBeenCalledWith(
      expect.any(String),
      'ABC123',
      'Alice',
      undefined,
      undefined
    )
  })
})

describe('Draw page - game state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders game layout with Canvas, Toolbar, and Chat after joining', async () => {
    await simulateJoinGame('Alice')

    // Toolbar tools should be rendered
    expect(screen.getAllByRole('button', { name: /pencil tool/i }).length).toBeGreaterThan(0)
    // Chat should be rendered
    expect(screen.getByRole('log')).toBeTruthy()
    // Player list should show in lobby game status
    expect(screen.getByText('Players')).toBeTruthy()
  })

  it('shows Scoreboard instead of PlayerList when a round starts', async () => {
    await simulateJoinGame('Alice')

    const handlers = getWsHandlers()

    handlers.onRoundStart?.(
      1, // roundNumber
      3, // totalRounds
      'player-123', // drawerId
      'Alice', // drawerName
      'elephant', // word (for drawer)
      8, // wordLength
      Date.now() + 60000 // endTime
    )

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })
  })

  it('handles player joined and player left events', async () => {
    await simulateJoinGame('Alice')

    const handlers = getWsHandlers()

    handlers.onPlayerJoined?.({ id: 'player-456', name: 'Bob', color: '#4ECDC4' })

    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeTruthy()
    })

    handlers.onPlayerLeft?.('player-456')

    await waitFor(() => {
      expect(screen.queryByText('Bob')).toBeNull()
    })
  })

  it('updates connection status when connection changes', async () => {
    await simulateJoinGame('Alice')

    const handlers = getWsHandlers()
    handlers.onConnectionChange?.(true)

    await waitFor(() => {
      const statusEl = document.querySelector('.connection-status')
      expect(statusEl?.classList.contains('connected')).toBe(true)
    })
  })
})

describe('Draw page - game event handlers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows round-over overlay with revealed word after onRoundEnd', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    const result = {
      drawerId: 'player-123',
      drawerName: 'Alice',
      word: 'elephant',
      correctGuessers: [],
      drawerScore: 0,
    }
    handlers.onRoundEnd?.('elephant', result, { 'player-123': { name: 'Alice', score: 0 } })

    await waitFor(() => {
      expect(screen.getByText('Round Over!')).toBeTruthy()
    })
    expect(screen.getByText(/The word was:/)).toBeTruthy()
  })

  it('shows game-over overlay with Play Again button after onGameOver', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onGameOver?.({ 'player-123': { name: 'Alice', score: 150 } }, [
      { playerId: 'player-123', playerName: 'Alice', score: 150 },
    ])

    await waitFor(() => {
      expect(screen.getByText('🎉 Game Over!')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Play Again' })).toBeTruthy()
    })
  })

  it('shows no-winner message in game-over overlay when winners is empty', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onGameOver?.({}, [])

    await waitFor(() => {
      expect(screen.getByText('🎉 Game Over!')).toBeTruthy()
      expect(screen.getByText('No winner this time.')).toBeTruthy()
    })
  })

  it('hides game-over overlay and resets state after onGameReset', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onGameOver?.({}, [])

    await waitFor(() => {
      expect(screen.getByText('🎉 Game Over!')).toBeTruthy()
    })

    handlers.onGameReset?.()

    await waitFor(() => {
      expect(screen.queryByText('🎉 Game Over!')).toBeNull()
    })
  })

  it('shows correct guess notification after onCorrectGuess', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onCorrectGuess?.('p2', 'Bob', 100, 45)

    await waitFor(() => {
      expect(screen.getByText(/Bob guessed correctly!/)).toBeTruthy()
    })
  })

  it('shows system notification after onSystemMessage', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onSystemMessage?.('Something happened in the room')

    await waitFor(() => {
      expect(screen.getByText('Something happened in the room')).toBeTruthy()
    })
  })

  it('shows error badge after onConnectionFailed', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onConnectionFailed?.('Failed to reconnect after 5 attempts. Please refresh.')

    await waitFor(() => {
      const errorBadge = document.querySelector('.error-badge')
      expect(errorBadge).toBeTruthy()
      expect(errorBadge?.textContent).toContain('Failed to reconnect')
    })
  })

  it('changes host status and updates UI after onHostChange', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Trigger game over - Alice is host so "Play Again" button should be visible
    handlers.onGameOver?.({}, [])

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play Again' })).toBeTruthy()
    })

    // Change host to another player
    handlers.onHostChange?.('other-player')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Play Again' })).toBeNull()
      expect(screen.getByText('Waiting for host to start a new game...')).toBeTruthy()
    })
  })

  it('hides start game section after onGameStarted changes status to starting', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // In lobby state as host with 1 player, "Need at least 2 players" should be visible
    await waitFor(() => {
      expect(screen.getByText('Need at least 2 players to start')).toBeTruthy()
    })

    handlers.onGameStarted?.(3, ['player-123'], {})

    await waitFor(() => {
      expect(screen.queryByText('Need at least 2 players to start')).toBeNull()
    })
  })

  it('shows round-end game header after onRoundEnd', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Start a round first
    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'cat', 3, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // End the round
    const result = {
      drawerId: 'player-123',
      drawerName: 'Alice',
      word: 'cat',
      correctGuessers: [],
      drawerScore: 0,
    }
    handlers.onRoundEnd?.('cat', result, {})

    await waitFor(() => {
      expect(screen.getByText('Round Over!')).toBeTruthy()
    })
  })

  it('shows the drawer word-choice UI and updates round context when word options arrive', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onGameStarted?.(3, ['player-123'], { 'player-123': { name: 'Alice', score: 0 } })
    handlers.onWordOptions?.(['apple', 'cat', 'dog'], 10, 1, 3, Date.now() + 10_000)

    await waitFor(() => {
      expect(screen.getByText('Choose a word to draw')).toBeTruthy()
      expect(screen.getByText('Round 1/3')).toBeTruthy()
      expect(screen.getByText("🎨 You're drawing!")).toBeTruthy()
    })
  })

  it('keeps word choices visible until round-start confirms the selection', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const wsInstance = vi.mocked(GameWebSocket).mock.instances.at(-1) as unknown as {
      sendChooseWord: ReturnType<typeof vi.fn>
    }

    handlers.onGameStarted?.(3, ['player-123'], { 'player-123': { name: 'Alice', score: 0 } })
    handlers.onWordOptions?.(['apple', 'cat', 'dog'], 10, 1, 3, Date.now() + 10_000)

    const chooseButton = await screen.findByRole('button', { name: 'apple' })
    await fireEvent.click(chooseButton)

    expect(wsInstance.sendChooseWord).toHaveBeenCalledWith('apple')
    expect(screen.getByRole('button', { name: 'apple' })).toBeTruthy()

    handlers.onRoundStart?.(1, 3, 'player-123', 'Alice', 'apple', 5, Date.now() + 60_000)

    await waitFor(() => {
      expect(screen.queryByText('Choose a word to draw')).toBeNull()
    })
  })

  it('clears the word-choice timer on component teardown', async () => {
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    const intervalIds = [101, 202]
    const clearIntervalSpy = vi.fn()
    globalThis.setInterval = (() =>
      intervalIds.shift() as unknown as ReturnType<
        typeof setInterval
      >) as unknown as typeof setInterval
    globalThis.clearInterval = clearIntervalSpy as unknown as typeof clearInterval

    try {
      const { unmount } = await simulateJoinGame('Alice')
      const handlers = getWsHandlers()

      handlers.onWordChoiceStart?.(1, 3, 'other-player', 'Bob', Date.now() + 10_000)
      unmount()

      expect(clearIntervalSpy).toHaveBeenCalledWith(101)
      expect(clearIntervalSpy).toHaveBeenCalledWith(202)
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  })

  it('handles server errors for drawing actions', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Trigger a server error for a stroke action
    handlers.onServerError?.('Stroke failed: rate limit exceeded', 'stroke', undefined)

    await waitFor(() => {
      const errorBadge = document.querySelector('.error-badge')
      expect(errorBadge).toBeTruthy()
      expect(errorBadge?.textContent).toContain('Stroke failed')
    })
  })

  it('handles server errors for fill actions with nonce', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onServerError?.('Fill failed: invalid data', 'fill', 'nonce-abc-123')

    await waitFor(() => {
      const errorBadge = document.querySelector('.error-badge')
      expect(errorBadge?.textContent).toContain('Fill failed')
    })
  })

  it('handles server errors for non-drawing actions', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onServerError?.('Chat rate limit exceeded', 'chat', undefined)

    await waitFor(() => {
      const errorBadge = document.querySelector('.error-badge')
      expect(errorBadge?.textContent).toContain('Chat rate limit')
    })
  })
})

describe('Draw page - keyboard shortcuts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
    vi.clearAllMocks()
  })

  // Helper: re-init as playing drawer with a stroke to populate undoStack/redoStack
  function initAsPlayingDrawerWithStroke(
    handlers: Record<string, (...args: unknown[]) => void>,
    strokeId: string
  ) {
    const stroke = {
      id: strokeId,
      playerId: 'player-123',
      color: '#FF6B6B' as const,
      size: 4,
      points: [{ x: 0.1, y: 0.2 }],
      timestamp: 1000,
      seq: 1,
    }
    handlers.onInit(
      'player-123',
      { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
      [{ id: 'player-123', name: 'Alice', color: '#FF6B6B' }],
      [stroke],
      [],
      [],
      true,
      {
        status: 'playing',
        currentRound: 1,
        totalRounds: 2,
        currentDrawerId: 'player-123',
        roundEndTime: Date.now() + 60000,
        scores: { 'player-123': { name: 'Alice', score: 0 } },
        currentWord: 'elephant',
        wordLength: 8,
      },
      TEST_RECONNECT_TOKEN
    )
    return stroke
  }

  it('Ctrl+Z triggers undo when player is the current drawer', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // Re-init with playing state + player's own stroke so undoStack is populated
    initAsPlayingDrawerWithStroke(handlers, 'stroke-ctrl-z')

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    const callsBefore = (wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length

    // Fire Ctrl+Z - handleUndo runs and calls sendUndoStroke since undoStack is non-empty
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false })

    expect(
      (wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length
    ).toBeGreaterThan(callsBefore)
  })

  it('Ctrl+Shift+Z triggers redo when player is the current drawer', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
      sendStroke: ReturnType<typeof vi.fn>
    }

    // Re-init with playing state + player's own stroke so undoStack is populated
    initAsPlayingDrawerWithStroke(handlers, 'stroke-ctrl-shift-z')

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // Undo the stroke (puts it in pendingUndoStrokes)
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false })

    // Simulate server confirming the undo — this moves the item to redoStack
    handlers.onStrokeRemoved?.('stroke-ctrl-shift-z')

    await waitFor(() => {
      // redoStack is now non-empty; the redo button reflects this if present
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    const callsBefore = (wsInstance.sendStroke as ReturnType<typeof vi.fn>).mock.calls.length

    // Fire Ctrl+Shift+Z - handleRedo runs and calls sendStroke with the redo stroke
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })

    expect((wsInstance.sendStroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsBefore
    )
  })

  it('ignores keyboard shortcuts when player is not the drawer', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // Start a round where a different player is the drawer
    handlers.onRoundStart?.(1, 2, 'player-456', 'Bob', undefined, 3, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    const callsBefore = (wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    // sendUndoStroke should NOT be called since Alice is not the drawer
    expect((wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore
    )
  })

  it('ignores keyboard shortcuts when target is an editable element', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // Re-init with playing state + stroke so canDraw is true and undoStack is populated
    initAsPlayingDrawerWithStroke(handlers, 'stroke-editable-target')

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // The chat input must exist for this test to be meaningful
    const chatInput = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(chatInput).toBeTruthy()

    const callsBefore = (wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length
    await fireEvent.keyDown(chatInput, { key: 'z', ctrlKey: true })
    // Should not trigger undo when target is an editable element
    expect((wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsBefore
    )
  })
})

describe('Draw page - game UI branches', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
    vi.clearAllMocks()
  })

  it('shows multiple winners display when game ends with a tie', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onGameOver?.(
      {
        'player-123': { name: 'Alice', score: 150 },
        'player-456': { name: 'Bob', score: 150 },
      },
      [
        { playerId: 'player-123', playerName: 'Alice', score: 150 },
        { playerId: 'player-456', playerName: 'Bob', score: 150 },
      ]
    )

    await waitFor(() => {
      expect(screen.getByText('🎉 Game Over!')).toBeTruthy()
      expect(screen.getByText('Winners')).toBeTruthy()
    })
  })

  it('shows cannot-draw indicator when player is guessing during playing state', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Start round where someone else is the drawer
    handlers.onRoundStart?.(1, 2, 'player-456', 'Bob', undefined, 3, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.getByText("👀 You're guessing! Type your answer in chat.")).toBeTruthy()
    })
  })

  it('shows Waiting for host to start when non-host player is in lobby', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
        text: vi.fn().mockResolvedValue(''),
      })
    )

    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Bob' } })

    const createButton = screen.getByRole('button', { name: 'Create Room' })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
    })

    const handlers = getWsHandlers()

    // Bob joins as non-host
    handlers.onInit(
      'player-456',
      { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      [
        { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      ],
      [],
      [],
      [],
      false, // not host
      {
        status: 'lobby',
        currentRound: 0,
        totalRounds: 0,
        currentDrawerId: null,
        roundEndTime: null,
        scores: {},
        currentWord: undefined,
      },
      TEST_RECONNECT_TOKEN
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
    })

    expect(screen.getByText('Waiting for host to start...')).toBeTruthy()
  })

  it('shows Start Game button when host has 2+ players in lobby', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
        text: vi.fn().mockResolvedValue(''),
      })
    )

    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })

    const createButton = screen.getByRole('button', { name: 'Create Room' })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
    })

    const handlers = getWsHandlers()

    // Alice is host with 2 players
    handlers.onInit(
      'player-123',
      { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
      [
        { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      ],
      [],
      [],
      [],
      true, // isHost
      {
        status: 'lobby',
        currentRound: 0,
        totalRounds: 0,
        currentDrawerId: null,
        roundEndTime: null,
        scores: {},
        currentWord: undefined,
      },
      TEST_RECONNECT_TOKEN
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
    })

    expect(screen.getByRole('button', { name: '🚀 Start Game' })).toBeTruthy()
  })

  it('shows Scoreboard component (not PlayerList) when game status is not lobby', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)

    await waitFor(() => {
      // Scoreboard should appear in the right sidebar
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
      // PlayerList should be gone
      expect(screen.queryByText('Players')).toBeNull()
    })
  })
})

describe('Draw page - WebSocket drawing event handlers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
    vi.clearAllMocks()
  })

  it('onStroke adds new strokes to the canvas state', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Start round where Alice is drawer
    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)

    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    const stroke = {
      id: 'stroke-abc',
      playerId: 'player-456',
      color: '#FF6B6B' as const,
      size: 4,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
      timestamp: Date.now(),
    }

    handlers.onStroke?.(stroke)

    // Verify the stroke was added to canvas state
    await waitFor(() => {
      const state = component.getDrawingState()
      expect(state.strokes.some((s) => (s as { id: string }).id === 'stroke-abc')).toBe(true)
    })
  })

  it('onStrokeUpdate updates existing strokes', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    // First add a stroke
    const stroke = {
      id: 'stroke-xyz',
      playerId: 'player-456',
      color: '#4ECDC4' as const,
      size: 8,
      points: [{ x: 0.2, y: 0.3 }],
      timestamp: Date.now(),
    }
    handlers.onStroke?.(stroke)

    // Then update it with a new point
    handlers.onStrokeUpdate?.('stroke-xyz', { x: 0.4, y: 0.5 })

    await waitFor(() => {
      const state = component.getDrawingState()
      const updated = state.strokes.find((s) => (s as { id: string }).id === 'stroke-xyz') as
        | { points: { x: number; y: number }[] }
        | undefined
      expect(updated).toBeDefined()
      expect(updated!.points).toHaveLength(2)
      expect(updated!.points[1]).toEqual({ x: 0.4, y: 0.5 })
    })
  })

  it('onStrokeRemoved removes strokes from canvas state', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    // Add a stroke then remove it
    const stroke = {
      id: 'stroke-del',
      playerId: 'player-456',
      color: '#FF6B6B' as const,
      size: 4,
      points: [{ x: 0.1, y: 0.2 }],
      timestamp: Date.now(),
    }
    handlers.onStroke?.(stroke)
    handlers.onStrokeRemoved?.('stroke-del')

    await waitFor(() => {
      const state = component.getDrawingState()
      expect(state.strokes.some((s) => (s as { id: string }).id === 'stroke-del')).toBe(false)
    })
  })

  it('onFill adds new fill operations', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-456', 'Bob', undefined, 3, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    const fill = {
      id: 'fill-abc',
      playerId: 'player-456',
      x: 0.5,
      y: 0.5,
      color: '#FF6B6B' as const,
      timestamp: Date.now(),
    }

    handlers.onFill?.(fill)

    await waitFor(() => {
      const state = component.getDrawingState()
      expect(state.fills.some((f) => (f as { id: string }).id === 'fill-abc')).toBe(true)
    })
  })

  it('onFillRemoved removes fill operations', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-456', 'Bob', undefined, 3, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    const fill = {
      id: 'fill-del',
      playerId: 'player-456',
      x: 0.3,
      y: 0.3,
      color: '#4ECDC4' as const,
      timestamp: Date.now(),
    }
    handlers.onFill?.(fill)
    handlers.onFillRemoved?.('fill-del')

    await waitFor(() => {
      const state = component.getDrawingState()
      expect(state.fills.some((f) => (f as { id: string }).id === 'fill-del')).toBe(false)
    })
  })

  it('onClear removes all strokes and fills', async () => {
    const { component } = await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    handlers.onStroke?.({
      id: 'stroke-clear-test',
      playerId: 'player-456',
      color: '#FF6B6B' as const,
      size: 4,
      points: [{ x: 0.1, y: 0.2 }],
      timestamp: Date.now(),
    })
    handlers.onClear?.()

    await waitFor(() => {
      const state = component.getDrawingState()
      expect(state.strokes).toHaveLength(0)
      expect(state.fills).toHaveLength(0)
    })
  })

  it('onTick updates time remaining display', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    handlers.onTick?.(45)

    // GameHeader renders the time as M:SS in the .time span
    await waitFor(() => {
      expect(screen.getByText('0:45')).toBeTruthy()
    })
  })

  it('onConnectionChange updates the connection status indicator', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // First connect (adds the `connected` CSS class)
    handlers.onConnectionChange?.(true)
    await waitFor(() => {
      const indicator = document.querySelector('.connection-status')
      expect(indicator?.classList.contains('connected')).toBe(true)
    })

    // Then disconnect — the `connected` class should be removed
    handlers.onConnectionChange?.(false)
    await waitFor(() => {
      const indicator = document.querySelector('.connection-status')
      expect(indicator?.classList.contains('connected')).toBe(false)
    })
  })

  it('onConnectionFailed triggers clearRedoLock and sets error', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onConnectionFailed?.('Max retries exceeded')
    await waitFor(() => {
      const badge = document.querySelector('.error-badge')
      expect(badge?.textContent).toContain('Max retries exceeded')
    })
  })

  it('onConnectionFailed clears stale sessionStorage credentials', async () => {
    await simulateJoinGame('Alice')

    // Verify credentials were stored during init
    expect(sessionStorage.getItem('taurus-player-TEST-ROOM')).toBe('player-123')
    expect(sessionStorage.getItem('taurus-token-TEST-ROOM')).toBe(TEST_RECONNECT_TOKEN)

    const handlers = getWsHandlers()
    handlers.onConnectionFailed?.('Failed to reconnect after 5 attempts')
    await waitFor(() => {
      // Credentials should be cleared after permanent connection failure
      expect(sessionStorage.getItem('taurus-player-TEST-ROOM')).toBeNull()
      expect(sessionStorage.getItem('taurus-token-TEST-ROOM')).toBeNull()
    })
  })
})

describe('Draw page - handleUndo and handleClear interactions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
    vi.clearAllMocks()
  })

  async function simulateJoinAsDrawer(playerName = 'Alice') {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
        text: vi.fn().mockResolvedValue(''),
      })
    )

    const { component } = render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: playerName } })

    const createButton = screen.getByRole('button', { name: 'Create Room' })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
    })

    const handlers = getWsHandlers()

    const stroke = {
      id: 'stroke-1',
      playerId: 'player-123',
      color: '#FF6B6B' as const,
      size: 4,
      points: [{ x: 0.1, y: 0.2 }],
      timestamp: 1000,
      seq: 1,
    }

    // Join as host with the player as the current drawer, with an existing stroke
    handlers.onInit(
      'player-123',
      { id: 'player-123', name: playerName, color: '#FF6B6B' },
      [{ id: 'player-123', name: playerName, color: '#FF6B6B' }],
      [stroke], // strokes
      [], // fills
      [], // chatHistory
      true, // isHost
      {
        status: 'playing',
        currentRound: 1,
        totalRounds: 2,
        currentDrawerId: 'player-123', // Alice is the drawer
        roundEndTime: Date.now() + 60000,
        scores: { 'player-123': { name: playerName, score: 0 } },
        currentWord: 'elephant',
        wordLength: 8,
      },
      TEST_RECONNECT_TOKEN
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
    })

    return { handlers, component: component as unknown as DrawPageComponent }
  }

  it('Undo button is enabled and triggers handleUndo when drawer has strokes', async () => {
    const { handlers } = await simulateJoinAsDrawer('Alice')
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // The undo button should be enabled (canUndo = canDraw && undoStack.length > 0)
    await waitFor(() => {
      const undoBtn = screen.getByRole('button', { name: /undo/i }) as HTMLButtonElement
      expect(undoBtn.disabled).toBe(false)
    })

    const undoBtn = screen.getByRole('button', { name: /undo/i })
    await fireEvent.click(undoBtn)

    // sendUndoStroke should have been called (handleUndo ran)
    expect(wsInstance.sendUndoStroke).toHaveBeenCalledWith('stroke-1')

    // Verify the handlers object for reference
    expect(handlers.onInit).toBeDefined()
  })

  it('Clear button is enabled for current drawer during playing state', async () => {
    await simulateJoinAsDrawer('Alice')

    // Verify the Clear button is enabled for the drawer (clearDisabled = !isCurrentDrawer = false)
    await waitFor(() => {
      const clearBtn = screen.getByRole('button', { name: /clear/i }) as HTMLButtonElement
      expect(clearBtn.disabled).toBe(false)
    })
  })

  it('onStroke updates existing stroke with server metadata when stroke already exists', async () => {
    const { handlers, component } = await simulateJoinAsDrawer('Alice')

    // Send an onStroke for the stroke already in the canvas (update metadata path)
    handlers.onStroke?.({
      id: 'stroke-1', // same id as existing stroke
      playerId: 'player-123',
      color: '#FF6B6B' as const,
      size: 4,
      points: [{ x: 0.1, y: 0.2 }],
      timestamp: 2000, // updated timestamp
      seq: 2, // server-assigned seq
    })

    await waitFor(() => {
      const state = component.getDrawingState()
      const updated = (state.strokes as { id: string; timestamp: number; seq: number }[]).find(
        (s) => s.id === 'stroke-1'
      )
      expect(updated?.timestamp).toBe(2000)
      expect(updated?.seq).toBe(2)
    })
  })

  it('onFill for current drawer handles isCurrentDrawer=true code path', async () => {
    const { handlers, component } = await simulateJoinAsDrawer('Alice')

    // Send a fill from Alice (the current drawer)
    handlers.onFill?.({
      id: 'fill-from-drawer',
      playerId: 'player-123',
      x: 0.5,
      y: 0.5,
      color: '#4ECDC4' as const,
      timestamp: Date.now(),
    })

    await waitFor(() => {
      const state = component.getDrawingState()
      expect((state.fills as { id: string }[]).some((f) => f.id === 'fill-from-drawer')).toBe(true)
    })
  })

  it('game state initializes correctly as drawer with playing status', async () => {
    await simulateJoinAsDrawer('Alice')

    // In playing state as drawer, should see the Scoreboard (not PlayerList)
    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
      expect(screen.queryByText('Players')).toBeNull()
    })

    // Should NOT see the cannot-draw indicator (Alice IS the drawer)
    expect(screen.queryByText("👀 You're guessing! Type your answer in chat.")).toBeNull()
  })

  it('hydrates revealedHint from init payload when reconnecting during playing state', async () => {
    await simulateJoinGame('Bob')
    const handlers = getWsHandlers()

    // Re-init mid-round as a guesser with a revealed hint
    handlers.onInit(
      'player-456',
      { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      [
        { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      ],
      [], // strokes
      [], // fills
      [], // chatHistory
      false, // not host
      {
        status: 'playing',
        currentRound: 1,
        totalRounds: 2,
        currentDrawerId: 'player-123',
        deadlineTime: Date.now() + 60000,
        scores: {
          'player-123': { name: 'Alice', score: 0 },
          'player-456': { name: 'Bob', score: 0 },
        },
        wordLength: 5,
        revealedHint: 'a _ _ l e',
      },
      TEST_RECONNECT_TOKEN
    )

    await waitFor(() => {
      // The revealed hint should be rendered (not blank underscores)
      expect(screen.queryByText('a _ _ l e')).toBeTruthy()
    })
  })

  it('starts word-choice countdown timer from init payload when reconnecting mid-word-choice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ roomId: 'TEST-ROOM' }),
        text: vi.fn().mockResolvedValue(''),
      })
    )

    render(DrawPage)

    const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
    await fireEvent.input(nameInput, { target: { value: 'Alice' } })

    const createButton = screen.getByRole('button', { name: 'Create Room' })
    await fireEvent.click(createButton)

    await waitFor(() => {
      expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
    })

    const handlers = getWsHandlers()

    // Simulate joining during word-choice phase (e.g., reconnect or late join)
    const futureDeadline = Date.now() + 15000
    handlers.onInit(
      'player-123',
      { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
      [
        { id: 'player-123', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-456', name: 'Bob', color: '#4ECDC4' },
      ],
      [], // strokes
      [], // fills
      [], // chatHistory
      true, // isHost
      {
        status: 'word-choice',
        currentRound: 1,
        totalRounds: 2,
        currentDrawerId: 'player-456',
        deadlineTime: futureDeadline,
        scores: {
          'player-123': { name: 'Alice', score: 0 },
          'player-456': { name: 'Bob', score: 0 },
        },
      },
      TEST_RECONNECT_TOKEN
    )

    await waitFor(() => {
      // The word-choice overlay should show a non-zero countdown
      // (timer started from deadlineTime in init payload)
      expect(screen.queryByText('0s')).toBeNull()
    })

    // The word-choice overlay should be visible
    expect(
      screen.queryByText(/Choosing word/i) || screen.queryByText(/Choose a word/i)
    ).toBeTruthy()
  })

  it('preserves undo stack when round-start fires for the same round during reconnection', async () => {
    await simulateJoinAsDrawer('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // Verify undo stack is populated from the init stroke
    await waitFor(() => {
      const undoBtn = screen.getByRole('button', { name: /undo/i }) as HTMLButtonElement
      expect(undoBtn.disabled).toBe(false)
    })

    // Simulate reconnect: server sends round-start-for-drawer for the same round
    handlers.onRoundStart?.(
      1, // same roundNumber
      2, // same totalRounds
      'player-123',
      'Alice',
      'elephant',
      8,
      Date.now() + 60000
    )

    await waitFor(() => {
      // Undo button should STILL be enabled — stack was preserved, not wiped
      const undoBtn = screen.getByRole('button', { name: /undo/i }) as HTMLButtonElement
      expect(undoBtn.disabled).toBe(false)
    })

    // And Ctrl+Z should still work (undoStack has the original stroke)
    const callsBefore = wsInstance.sendUndoStroke.mock.calls.length
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false })
    expect(wsInstance.sendUndoStroke.mock.calls.length).toBeGreaterThan(callsBefore)
  })
})
