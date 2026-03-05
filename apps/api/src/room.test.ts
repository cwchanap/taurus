import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { MAX_MESSAGES_PER_WINDOW, MAX_STROKES_PER_WINDOW } from './constants'

// Helper to flush all pending promises reliably
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// Mock cloudflare:workers module
mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(state: unknown, env: unknown) {
      // @ts-expect-error - Mocking DurableObject constructor
      this.ctx = state
      // @ts-expect-error - Mocking DurableObject constructor
      this.env = env
    }
  },
}))

import type { DurableObjectState } from '@cloudflare/workers-types'

describe('DrawingRoom - Player Leave During Game', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStorageGet: ReturnType<typeof mock>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>

  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStorageGet = mock(() => Promise.resolve(undefined))
    mockStoragePut = mock(() => Promise.resolve())
    mockStorageDelete = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    // Mock Durable Object state
    mockState = {
      storage: {
        get: mockStorageGet,
        put: mockStoragePut,
        delete: mockStorageDelete,
        list: mock(() => Promise.resolve(new Map())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      id: {
        toString: () => 'test-room-id',
        equals: () => false,
        name: 'test-room',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      waitUntil: mockWaitUntil,
      blockConcurrencyWhile: mock(async (fn) => await fn()),
      getWebSockets: mockGetWebSockets,
    }

    mockEnv = {}

    // Suppress unused variable warning for mockEnv (used indirectly via constructor)
    void mockEnv

    // Create actual DrawingRoom instance for future test implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, mockEnv as any)
  })

  afterEach(() => {
    // Clean up any timers to prevent leaks across tests
    if (room) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).clearTimers()
    }
  })

  test('rehydrates playing state timers after hibernation when sockets are active', async () => {
    const roundEndTime = Date.now() + 10_000
    mockStorageGet.mockImplementation((key: string) => {
      switch (key) {
        case 'strokes':
          return Promise.resolve([])
        case 'created':
          return Promise.resolve(true)
        case 'chatHistory':
          return Promise.resolve([])
        case 'hostPlayerId':
          return Promise.resolve('host-1')
        case 'gameState':
          return Promise.resolve({
            status: 'playing',
            currentRound: 1,
            totalRounds: 2,
            currentDrawerId: 'drawer-1',
            currentWord: 'cat',
            wordLength: 3,
            roundStartTime: Date.now(),
            roundEndTime,
            drawerOrder: ['drawer-1', 'guesser-1'],
            scores: [
              ['drawer-1', { score: 0, name: 'Drawer' }],
              ['guesser-1', { score: 0, name: 'Guesser' }],
            ],
            correctGuessers: [],
            roundGuessers: ['guesser-1'],
            roundGuesserScores: [],
            usedWords: ['cat'],
            endGameAfterCurrentRound: false,
          })
        default:
          return Promise.resolve(undefined)
      }
    })

    mockGetWebSockets.mockReturnValue([
      {
        send: mock(() => {}),
        close: mock(() => {}),
      },
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).ensureInitialized()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).roundTimer).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).tickTimer).not.toBeNull()
  })

  test('rehydrates timers even when no active sockets exist (cold restart scenario)', async () => {
    // This test verifies the fix for the timer rehydration gap:
    // On cold Durable Object restart, the first reconnect arrives via /ws before
    // any socket is accepted, so getWebSockets() returns empty array.
    // Timers must still be rehydrated to prevent games from getting stuck.
    const roundEndTime = Date.now() + 10_000
    mockStorageGet.mockImplementation((key: string) => {
      switch (key) {
        case 'strokes':
          return Promise.resolve([])
        case 'created':
          return Promise.resolve(true)
        case 'chatHistory':
          return Promise.resolve([])
        case 'hostPlayerId':
          return Promise.resolve('host-1')
        case 'gameState':
          return Promise.resolve({
            status: 'playing',
            currentRound: 1,
            totalRounds: 2,
            currentDrawerId: 'drawer-1',
            currentWord: 'cat',
            wordLength: 3,
            roundStartTime: Date.now(),
            roundEndTime,
            drawerOrder: ['drawer-1', 'guesser-1'],
            scores: [
              ['drawer-1', { score: 0, name: 'Drawer' }],
              ['guesser-1', { score: 0, name: 'Guesser' }],
            ],
            correctGuessers: [],
            roundGuessers: ['guesser-1'],
            roundGuesserScores: [],
            usedWords: ['cat'],
            endGameAfterCurrentRound: false,
          })
        default:
          return Promise.resolve(undefined)
      }
    })

    mockGetWebSockets.mockReturnValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).ensureInitialized()

    // Timers should be rehydrated even without active sockets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).roundTimer).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).tickTimer).not.toBeNull()
  })

  test('persists updated game state when player leaves but game continues', async () => {
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'p1',
        player: { id: 'p1', name: 'P1', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws2 = {
      deserializeAttachment: () => ({
        playerId: 'p2',
        player: { id: 'p2', name: 'P2', color: '#222222' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws3 = {
      deserializeAttachment: () => ({
        playerId: 'p3',
        player: { id: 'p3', name: 'P3', color: '#333333' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }

    mockGetWebSockets.mockReturnValue([ws1, ws2, ws3])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'p1',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: ['p1', 'p2', 'p3'],
      scores: new Map([
        ['p1', { score: 0, name: 'P1' }],
        ['p2', { score: 0, name: 'P2' }],
        ['p3', { score: 0, name: 'P3' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat']),
      endGameAfterCurrentRound: false,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleLeave(ws3 as any)

    // allow async storage put promise created in waitUntil call to execute
    // Use flushPromises to ensure all chained promises in waitUntil callback complete
    await flushPromises()

    expect(mockWaitUntil).toHaveBeenCalled()
    expect(mockStoragePut).toHaveBeenCalledWith('gameState', expect.any(Object))
  })

  test('new stroke rate limit does not consume chat message quota', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const checkRateLimit = (room as any).checkRateLimit.bind(room)
    const playerId = 'drawer-1'

    // Consume many stroke creations beyond chat message limit
    for (let i = 0; i < MAX_MESSAGES_PER_WINDOW + 1; i++) {
      expect(checkRateLimit(playerId, true)).toBe(true)
    }

    // Chat should still be allowed because stroke and chat quotas are independent
    expect(checkRateLimit(playerId, false)).toBe(true)

    // Stroke quota should still enforce its own maximum
    for (let i = MAX_MESSAGES_PER_WINDOW + 1; i < MAX_STROKES_PER_WINDOW; i++) {
      expect(checkRateLimit(playerId, true)).toBe(true)
    }
    expect(checkRateLimit(playerId, true)).toBe(false)
  })

  test('serializes stroke delete before later write operations', async () => {
    const operationOrder: string[] = []

    mockStorageDelete.mockImplementation(async () => {
      operationOrder.push('delete')
    })
    mockStoragePut.mockImplementation(async () => {
      operationOrder.push('put')
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'p1',
        color: '#000000',
        size: 8,
        points: [{ x: 10, y: 10 }],
        timestamp: Date.now(),
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deletePromise = (room as any).queueStrokeDelete()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writePromise = (room as any).queueStrokeWrite()

    await Promise.all([deletePromise, writePromise])

    expect(operationOrder).toEqual(['delete', 'put'])
    expect(mockStorageDelete).toHaveBeenCalledWith('strokes')
    expect(mockStoragePut).toHaveBeenCalledWith('strokes', expect.any(Array))
  })

  test('debounces fill writes and persists latest fills once', async () => {
    // Speed up debounced scheduler for test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [
      {
        id: 'fill-1',
        playerId: 'p1',
        x: 10,
        y: 10,
        color: '#FF6B6B',
        timestamp: Date.now(),
      },
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).scheduleStorageWrite('fills')

    // Update fills again before timer flushes; only latest state should be persisted
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [
      {
        id: 'fill-1',
        playerId: 'p1',
        x: 10,
        y: 10,
        color: '#FF6B6B',
        timestamp: Date.now(),
      },
      {
        id: 'fill-2',
        playerId: 'p1',
        x: 20,
        y: 20,
        color: '#4ECDC4',
        timestamp: Date.now(),
      },
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).scheduleStorageWrite('fills')

    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()

    const fillPutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'fills')
    expect(fillPutCalls).toHaveLength(1)
    expect(fillPutCalls[0]?.[1]).toHaveLength(2)
  })

  test('ensureInitialized recovers from invalid persisted game state', async () => {
    const originalError = console.error
    console.error = mock(() => {})

    mockStorageGet.mockImplementation((key: string) => {
      switch (key) {
        case 'strokes':
          return Promise.resolve([])
        case 'fills':
          return Promise.resolve([])
        case 'created':
          return Promise.resolve(true)
        case 'chatHistory':
          return Promise.resolve([])
        case 'hostPlayerId':
          return Promise.resolve('host-1')
        case 'gameState':
          return Promise.resolve({ status: 'invalid-status' })
        default:
          return Promise.resolve(undefined)
      }
    })

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (room as any).ensureInitialized()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((room as any).gameState.status).toBe('lobby')
    } finally {
      console.error = originalError
    }
  })

  test('ensureInitialized marks room as created when orphaned data exists', async () => {
    mockStorageGet.mockImplementation((key: string) => {
      switch (key) {
        case 'strokes':
          return Promise.resolve([{ id: 's1', playerId: 'p1', points: [], color: '#000', size: 4 }])
        case 'fills':
          return Promise.resolve([])
        case 'created':
          return Promise.resolve(false)
        case 'chatHistory':
          return Promise.resolve([])
        case 'hostPlayerId':
          return Promise.resolve(null)
        case 'gameState':
          return Promise.resolve(undefined)
        default:
          return Promise.resolve(undefined)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).ensureInitialized()

    expect(mockStoragePut).toHaveBeenCalledWith('created', true)
  })

  test('resumeGameFlowFromState ends expired playing round immediately', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: Date.now() - 10_000,
      roundEndTime: Date.now() - 1,
      drawerOrder: ['p1', 'p2'],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const endRoundSpy = mock((room as any).endRound.bind(room))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).endRound = endRoundSpy

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).resumeGameFlowFromState()

    expect(endRoundSpy).toHaveBeenCalledWith(false)
  })

  test('resumeGameFlowFromState schedules round-end transition to start next round', () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = mock(() => {
      return 1 as unknown as ReturnType<typeof setTimeout>
    })
    globalThis.setTimeout = setTimeoutSpy as unknown as typeof setTimeout

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'round-end',
        currentRound: 1,
        totalRounds: 3,
        currentDrawerId: null,
        drawerOrder: ['p1', 'p2', 'p3'],
        scores: new Map(),
        lastRoundResult: null,
        usedWords: new Set(),
        endGameAfterCurrentRound: false,
        nextTransitionAt: Date.now() + 2_000,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).resumeGameFlowFromState()

      expect(setTimeoutSpy).toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('resumeGameFlowFromState schedules game end when final transition is reached', () => {
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = mock(() => {
      return 1 as unknown as ReturnType<typeof setTimeout>
    })
    globalThis.setTimeout = setTimeoutSpy as unknown as typeof setTimeout

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'round-end',
        currentRound: 3,
        totalRounds: 3,
        currentDrawerId: null,
        drawerOrder: ['p1', 'p2', 'p3'],
        scores: new Map(),
        lastRoundResult: null,
        usedWords: new Set(),
        endGameAfterCurrentRound: false,
        nextTransitionAt: Date.now() + 2_000,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).resumeGameFlowFromState()

      expect(setTimeoutSpy).toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })
})

describe('DrawingRoom - Broadcast and Message Handling', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStorageGet: ReturnType<typeof mock>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStorageGet = mock(() => Promise.resolve(undefined))
    mockStoragePut = mock(() => Promise.resolve())
    mockStorageDelete = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    mockState = {
      storage: {
        get: mockStorageGet,
        put: mockStoragePut,
        delete: mockStorageDelete,
        list: mock(() => Promise.resolve(new Map())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      id: {
        toString: () => 'test-room-id',
        equals: () => false,
        name: 'test-room',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      waitUntil: mockWaitUntil,
      blockConcurrencyWhile: mock(async (fn) => await fn()),
      getWebSockets: mockGetWebSockets,
    }

    mockEnv = {}
    void mockEnv
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, mockEnv as any)
    // Mark as initialized so handlers skip storage reads
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
  })

  afterEach(() => {
    if (room) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).clearTimers()
    }
  })

  test('broadcast sends JSON to all connected sockets', () => {
    const ws1 = { send: mock(() => {}), close: mock(() => {}) }
    const ws2 = { send: mock(() => {}), close: mock(() => {}) }
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).broadcast({ type: 'test', value: 42 })

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', value: 42 }))
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test', value: 42 }))
  })

  test('broadcast excludes the specified socket', () => {
    const ws1 = { send: mock(() => {}), close: mock(() => {}) }
    const ws2 = { send: mock(() => {}), close: mock(() => {}) }
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).broadcast({ type: 'player-joined' }, ws1)

    expect(ws1.send).not.toHaveBeenCalled()
    expect(ws2.send).toHaveBeenCalledTimes(1)
  })

  test('handleChat broadcasts message to all players in lobby', async () => {
    const ws = {
      deserializeAttachment: () => ({
        playerId: 'p1',
        player: { id: 'p1', name: 'Alice', color: '#fff' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).handleChat(ws, {
      type: 'chat',
      content: 'hello world',
    })

    // broadcast sends the chat message to all sockets (including sender)
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"chat"'))
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"content":"hello world"'))
  })

  test('handleChat ignores message from socket with no player attachment', async () => {
    const ws = {
      deserializeAttachment: () => null,
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).handleChat(ws, {
      type: 'chat',
      content: 'hello',
    })

    expect(ws.send).not.toHaveBeenCalled()
  })

  test('handleStartGame rejects non-host player', async () => {
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    const ws = {
      deserializeAttachment: () => ({
        playerId: 'p2',
        player: { id: 'p2', name: 'Bob', color: '#000' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (room as any).handleStartGame(ws)
    } finally {
      console.warn = originalWarn
    }

    expect(warnSpy).toHaveBeenCalled()
    // Game should remain in lobby
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('lobby')
  })

  test('handleStartGame rejects when fewer than 2 players are connected', async () => {
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    const ws = {
      deserializeAttachment: () => ({
        playerId: 'p1',
        player: { id: 'p1', name: 'Alice', color: '#fff' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    // Only one player in the room
    mockGetWebSockets.mockReturnValue([ws])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (room as any).handleStartGame(ws)
    } finally {
      console.warn = originalWarn
    }

    expect(warnSpy).toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('lobby')
  })

  test('webSocketMessage returns error response for invalid JSON', async () => {
    const ws = {
      deserializeAttachment: () => null,
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws])

    await room.webSocketMessage(ws as unknown as WebSocket, '{invalid json}')

    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"error"'))
  })

  test('handleResetGame rejects non-host player', async () => {
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy

    const ws = {
      deserializeAttachment: () => ({
        playerId: 'p2',
        player: { id: 'p2', name: 'Bob', color: '#000' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (room as any).handleResetGame(ws)
    } finally {
      console.warn = originalWarn
    }

    expect(warnSpy).toHaveBeenCalled()
  })

  test('getPlayers returns player list from connected sockets', () => {
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'p1',
        player: { id: 'p1', name: 'Alice', color: '#fff' },
      }),
    }
    const ws2 = {
      deserializeAttachment: () => ({
        playerId: 'p2',
        player: { id: 'p2', name: 'Bob', color: '#000' },
      }),
    }
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const players = (room as any).getPlayers()
    expect(players).toHaveLength(2)
    expect(players[0].name).toBe('Alice')
    expect(players[1].name).toBe('Bob')
  })
})

describe('DrawingRoom - Fill and Undo Handler Authorization', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

  // Helper: create a mock WebSocket with a fixed player ID
  function createMockWs(playerId: string, playerName = 'TestPlayer') {
    return {
      deserializeAttachment: () => ({
        playerId,
        player: { id: playerId, name: playerName, color: '#FF6B6B' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  // Helper: get all parsed messages sent via ws.send
  function getSentMessages(ws: ReturnType<typeof createMockWs>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ws.send as ReturnType<typeof mock>).mock.calls.map((call: any[]) => {
      try {
        return JSON.parse(call[0] as string)
      } catch {
        return null
      }
    })
  }

  // Helper: set room into playing state with a specific drawer
  function setPlayingState(drawerId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: drawerId,
      currentWord: 'apple',
      wordLength: 5,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: [drawerId],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
    }
  }

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStoragePut = mock(() => Promise.resolve())
    mockStorageDelete = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    mockState = {
      storage: {
        get: mock(() => Promise.resolve(undefined)),
        put: mockStoragePut,
        delete: mockStorageDelete,
        list: mock(() => Promise.resolve(new Map())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      id: {
        toString: () => 'test-room-id',
        equals: () => false,
        name: 'test-room',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      waitUntil: mockWaitUntil,
      blockConcurrencyWhile: mock(async (fn) => await fn()),
      getWebSockets: mockGetWebSockets,
    }

    mockEnv = {}
    void mockEnv

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, mockEnv as any)
  })

  afterEach(() => {
    if (room) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).clearTimers()
    }
  })

  test('handleFill: rejects fill from non-drawer player', async () => {
    // Player 'non-drawer' joins; current drawer is 'actual-drawer'
    const ws = createMockWs('non-drawer', 'NonDrawer')
    mockGetWebSockets.mockReturnValue([ws])
    setPlayingState('actual-drawer')

    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'fill', x: 100, y: 100, color: '#FF6B6B' })
    )
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'fill')).toBe(false)
  })

  test('handleFill: rejects fill when game is not in playing state', async () => {
    const ws = createMockWs('player-1', 'Player')
    mockGetWebSockets.mockReturnValue([ws])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      roundEndTime: null,
      drawerOrder: [],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
    }

    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'fill', x: 100, y: 100, color: '#FF6B6B' })
    )
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'fill')).toBe(false)
  })

  test('handleFill: valid fill from drawer is persisted and broadcast to all players', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    const observerWs = createMockWs('player-2', 'Observer')
    mockGetWebSockets.mockReturnValue([drawerWs, observerWs])
    setPlayingState('player-1')
    // Speed up debounced scheduler so storage put fires synchronously in test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'fill', x: 100, y: 200, color: '#FF6B6B' })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()

    // Both sockets should have received the fill broadcast
    const drawerMsgs = getSentMessages(drawerWs)
    const observerMsgs = getSentMessages(observerWs)
    expect(
      drawerMsgs.some(
        (m) =>
          m?.type === 'fill' &&
          m.playerId === 'player-1' &&
          m.x === 100 &&
          m.y === 200 &&
          m.color === '#FF6B6B'
      )
    ).toBe(true)
    expect(
      observerMsgs.some(
        (m) =>
          m?.type === 'fill' &&
          m.playerId === 'player-1' &&
          m.x === 100 &&
          m.y === 200 &&
          m.color === '#FF6B6B'
      )
    ).toBe(true)

    // Storage put should have been called for fills
    const fillPutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'fills')
    expect(fillPutCalls.length).toBeGreaterThan(0)
  })

  test('handleFill: fill with out-of-bounds x coordinate is rejected and nothing broadcast', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'fill', x: -1, y: 200, color: '#FF6B6B' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    expect(msgs.some((m) => m?.type === 'fill')).toBe(false)
  })

  test('handleFill: fill with invalid color is rejected and nothing broadcast', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'fill', x: 100, y: 200, color: 'red' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    expect(msgs.some((m) => m?.type === 'fill')).toBe(false)
  })

  test('handleUndoStroke: does not broadcast stroke-removed when player is not the drawer', async () => {
    const ws = createMockWs('non-drawer', 'NonDrawer')
    mockGetWebSockets.mockReturnValue([ws])
    setPlayingState('actual-drawer')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'actual-drawer',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: Date.now(),
      },
    ]

    await room.webSocketMessage(ws, JSON.stringify({ type: 'undo-stroke', strokeId: 'stroke-1' }))
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'stroke-removed')).toBe(false)
  })

  test('handleUndoFill: does not broadcast fill-removed for fill owned by different player', async () => {
    const ws = createMockWs('drawer', 'Drawer')
    mockGetWebSockets.mockReturnValue([ws])
    setPlayingState('drawer')
    // Fill is owned by 'other-player', not 'drawer'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [
      {
        id: 'fill-1',
        playerId: 'other-player',
        x: 10,
        y: 10,
        color: '#FF6B6B',
        timestamp: Date.now(),
      },
    ]

    await room.webSocketMessage(ws, JSON.stringify({ type: 'undo-fill', fillId: 'fill-1' }))
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'fill-removed')).toBe(false)
  })

  test('handleClear: rejects clear from non-drawer during playing state', async () => {
    const ws = createMockWs('non-drawer', 'NonDrawer')
    mockGetWebSockets.mockReturnValue([ws])
    setPlayingState('actual-drawer')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'actual-drawer',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: Date.now(),
      },
    ]

    await room.webSocketMessage(ws, JSON.stringify({ type: 'clear' }))
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'clear')).toBe(false)
  })
})
