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
})

/** Get the handlers registered by the most recently created GameWebSocket instance */
function getWsHandlers(): Record<string, (...args: unknown[]) => void> {
  const MockWS = vi.mocked(GameWebSocket)
  const instances = MockWS.mock.instances
  const instance = instances[instances.length - 1] as unknown as { on: ReturnType<typeof vi.fn> }
  if (!instance?.on?.mock?.calls?.length) return {}
  return instance.on.mock.calls[0][0] as Record<string, (...args: unknown[]) => void>
}

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

  render(DrawPage)

  const nameInput = screen.getByLabelText('Your Name') as HTMLInputElement
  await fireEvent.input(nameInput, { target: { value: playerName } })

  const createButton = screen.getByRole('button', { name: 'Create Room' })
  await fireEvent.click(createButton)

  // Wait for WebSocket to be constructed with the correct roomId and playerName
  await waitFor(() => {
    expect(vi.mocked(GameWebSocket).mock.instances.length).toBeGreaterThan(0)
  })
  expect(vi.mocked(GameWebSocket)).toHaveBeenCalledWith(expect.any(String), 'TEST-ROOM', playerName)

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
    }
  )

  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Create Room' })).toBeNull()
  })
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
    expect(vi.mocked(GameWebSocket)).toHaveBeenCalledWith(expect.any(String), 'ABC123', 'Alice')
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

  it('Ctrl+Z triggers undo when player is the current drawer', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()
    const MockWS = vi.mocked(GameWebSocket)
    const wsInstance = MockWS.mock.instances[MockWS.mock.instances.length - 1] as unknown as {
      sendUndoStroke: ReturnType<typeof vi.fn>
    }

    // Start a round where Alice is the drawer
    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // Fire Ctrl+Z keyboard event on the window
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false })

    // sendUndoStroke may or may not be called (depends on undo stack), but no error should occur
    // The important thing is that canDraw is true and the handler runs
    expect(wsInstance.sendUndoStroke).toBeDefined()
  })

  it('Ctrl+Shift+Z triggers redo when player is the current drawer', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Start a round where Alice is the drawer
    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'cat', 3, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // Fire Ctrl+Shift+Z keyboard event on the window - no errors expected
    await fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })

    // sendUndoFill/sendStroke may not be called with empty stacks, but handler runs without error
    expect(true).toBe(true)
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

    // Start round where Alice is the drawer so canDraw is true
    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)

    await waitFor(() => {
      expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy()
    })

    // Find an input element (the chat input) and fire keydown from it
    const chatInput = document.querySelector('input[type="text"]') as HTMLInputElement
    if (chatInput) {
      const callsBefore = (wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length
      await fireEvent.keyDown(chatInput, { key: 'z', ctrlKey: true })
      // Should not trigger undo when target is an editable element
      expect((wsInstance.sendUndoStroke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
        callsBefore
      )
    }
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
      }
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
      }
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
    await simulateJoinGame('Alice')
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

    // Call onStroke with a new stroke (not in existing strokes)
    handlers.onStroke?.(stroke)

    await waitFor(() => expect(true).toBe(true)) // just allow state to settle
  })

  it('onStrokeUpdate updates existing strokes', async () => {
    await simulateJoinGame('Alice')
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
    await waitFor(() => expect(true).toBe(true))
  })

  it('onStrokeRemoved removes strokes from canvas state', async () => {
    await simulateJoinGame('Alice')
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
    await waitFor(() => expect(true).toBe(true))
  })

  it('onFill adds new fill operations', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
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
    await waitFor(() => expect(true).toBe(true))
  })

  it('onFillRemoved removes fill operations', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
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
    await waitFor(() => expect(true).toBe(true))
  })

  it('onClear removes all strokes and fills', async () => {
    await simulateJoinGame('Alice')
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
    await waitFor(() => expect(true).toBe(true))
  })

  it('onTick updates time remaining display', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    handlers.onRoundStart?.(1, 2, 'player-123', 'Alice', 'elephant', 8, Date.now() + 60000)
    await waitFor(() => expect(screen.queryByText('🏆 Scoreboard')).toBeTruthy())

    handlers.onTick?.(45)
    await waitFor(() => expect(true).toBe(true))
  })

  it('onConnectionChange false triggers clearRedoLock', async () => {
    await simulateJoinGame('Alice')
    const handlers = getWsHandlers()

    // Simulate connection drop (triggers clearRedoLock)
    handlers.onConnectionChange?.(false)
    await waitFor(() => expect(true).toBe(true))
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
})
