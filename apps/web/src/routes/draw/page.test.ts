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

// Mock $app/environment — set browser: true so API_URL resolves via window.location.origin
// (mirrors real browser behavior; with browser: false, API_URL would be an empty string)
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
      wordLength: null,
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
