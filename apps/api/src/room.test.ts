import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import {
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKE_POINTS,
  MAX_STROKES_PER_WINDOW,
  ROUND_END_TRANSITION_DELAY,
} from './constants'

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

// Shared helpers used across multiple describe blocks

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockWs(playerId: string, playerName = 'TestPlayer'): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attachment: any = {
    playerId,
    player: { id: playerId, name: playerName, color: '#FF6B6B' },
  }
  return {
    deserializeAttachment: () => attachment,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serializeAttachment: mock((data: any) => {
      attachment = data
    }),
    send: mock(() => {}),
    close: mock(() => {}),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSentMessages(ws: ReturnType<typeof createMockWs>): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ws.send as ReturnType<typeof mock>).mock.calls.map((call: any[]) => {
    try {
      return JSON.parse(call[0] as string)
    } catch {
      return null
    }
  })
}

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer1).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer2).not.toBeNull()
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer1).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer2).not.toBeNull()
  })

  test('rehydrates word-choice state without auto-starting the round', async () => {
    const choiceDeadline = Date.now() + 10_000
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
            status: 'word-choice',
            currentRound: 1,
            totalRounds: 2,
            currentDrawerId: 'drawer-1',
            currentWord: null,
            wordLength: null,
            roundStartTime: null,
            roundEndTime: null,
            drawerOrder: ['drawer-1', 'guesser-1'],
            scores: [
              ['drawer-1', { score: 0, name: 'Drawer' }],
              ['guesser-1', { score: 0, name: 'Guesser' }],
            ],
            correctGuessers: [],
            roundGuessers: ['guesser-1'],
            roundGuesserScores: [],
            usedWords: [],
            endGameAfterCurrentRound: false,
            offeredWords: ['apple', 'cat', 'dog'],
            choiceDeadline,
          })
        default:
          return Promise.resolve(undefined)
      }
    })

    mockGetWebSockets.mockReturnValue([])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).ensureInitialized()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).pendingWordOptions).toEqual(['apple', 'cat', 'dog'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).wordChoiceTimer).not.toBeNull()
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat']),
      consecutiveMissedRounds: new Map(),
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

  test('retries deferred fill writes after a background failure', async () => {
    // Speed up debounced scheduler for test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [
      {
        id: 'fill-1',
        playerId: 'p1',
        x: 0.5,
        y: 0.5,
        color: '#FF6B6B',
        timestamp: Date.now(),
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalQueueFillWrite = (room as any).queueFillWrite.bind(room)
    let attempts = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueFillWrite = mock(() => {
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(new Error('fill write failed'))
      }
      return originalQueueFillWrite()
    })

    const originalError = console.error
    console.error = mock(() => {})
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).scheduleStorageWrite('fills')
      await new Promise((resolve) => setTimeout(resolve, 0))
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).queueFillWrite).toHaveBeenCalledTimes(2)
    const fillPutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'fills')
    expect(fillPutCalls).toHaveLength(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).fillStorageDirty).toBe(false)
  })

  test('re-schedules storage writes when canvas delete fails during endGame', async () => {
    // Speed up debounced scheduler for test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0

    // Force delete queue failures so endGame catch blocks run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueStrokeDelete = mock(() => Promise.reject(new Error('stroke delete failed')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueFillDelete = mock(() => Promise.reject(new Error('fill delete failed')))

    const originalError = console.error
    console.error = mock(() => {})
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).endGame()
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await flushPromises()
    } finally {
      console.error = originalError
    }

    const strokePutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'strokes')
    const fillPutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'fills')
    expect(strokePutCalls.length).toBeGreaterThan(0)
    expect(fillPutCalls.length).toBeGreaterThan(0)
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
          return Promise.resolve([
            { id: 's1', playerId: 'p1', points: [], color: '#000', size: 4, timestamp: Date.now() },
          ])
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

  test('ensureInitialized backfills missing legacy stroke timestamps', async () => {
    const validTimestamp = Date.now()

    mockStorageGet.mockImplementation((key: string) => {
      switch (key) {
        case 'strokes':
          return Promise.resolve([
            {
              id: 'legacy-stroke',
              playerId: 'p1',
              points: [{ x: 1, y: 1 }],
              color: '#FF6B6B',
              size: 4,
            },
            {
              id: 'modern-stroke',
              playerId: 'p2',
              points: [{ x: 2, y: 2 }],
              color: '#4ECDC4',
              size: 6,
              timestamp: validTimestamp,
            },
          ])
        case 'fills':
          return Promise.resolve([])
        case 'created':
          return Promise.resolve(true)
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes[0].timestamp).toBe(0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes[1].timestamp).toBe(validTimestamp)
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
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
        consecutiveMissedRounds: new Map(),
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
        consecutiveMissedRounds: new Map(),
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

  test('non-drawer leaving during word-choice ends game when room drops below min players', async () => {
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'drawer-1',
        player: { id: 'drawer-1', name: 'Drawer', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws2 = {
      deserializeAttachment: () => ({
        playerId: 'guesser-1',
        player: { id: 'guesser-1', name: 'Guesser', color: '#222222' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }

    mockGetWebSockets.mockReturnValue([ws1])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'drawer-1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'drawer-1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['drawer-1', 'guesser-1'],
      scores: new Map([
        ['drawer-1', { score: 0, name: 'Drawer' }],
        ['guesser-1', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'cat', 'dog'],
      choiceDeadline: Date.now() + 10_000,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).wordChoiceStartTime = Date.now()

    // Non-drawer (guesser) leaves during word-choice
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleLeave(ws2 as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('game-over')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).pendingWordOptions).toBeNull()
  })

  test('non-drawer leaving during word-choice continues if enough players remain', async () => {
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'drawer-1',
        player: { id: 'drawer-1', name: 'Drawer', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws2 = {
      deserializeAttachment: () => ({
        playerId: 'guesser-1',
        player: { id: 'guesser-1', name: 'Guesser1', color: '#222222' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws3 = {
      deserializeAttachment: () => ({
        playerId: 'guesser-2',
        player: { id: 'guesser-2', name: 'Guesser2', color: '#333333' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }

    // After guesser-2 leaves, drawer-1 and guesser-1 remain (2 players)
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'drawer-1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer-1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['drawer-1', 'guesser-1', 'guesser-2'],
      scores: new Map([
        ['drawer-1', { score: 0, name: 'Drawer' }],
        ['guesser-1', { score: 0, name: 'Guesser1' }],
        ['guesser-2', { score: 0, name: 'Guesser2' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'cat', 'dog'],
      choiceDeadline: Date.now() + 10_000,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']

    // Non-drawer (guesser-2) leaves during word-choice — room still has 2 players
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleLeave(ws3 as any)

    // Game should remain in word-choice (not ended)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).pendingWordOptions).toEqual(['apple', 'cat', 'dog'])

    // Non-drawer should be pruned from drawerOrder and round counters rebased
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.drawerOrder).toEqual(['drawer-1', 'guesser-1'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.totalRounds).toBe(2)
  })

  test('non-drawer who already drew leaving during word-choice decrements currentRound', async () => {
    const wsDrawer = {
      deserializeAttachment: () => ({
        playerId: 'drawer-2',
        player: { id: 'drawer-2', name: 'Drawer2', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const wsPrevDrawer = {
      deserializeAttachment: () => ({
        playerId: 'p1',
        player: { id: 'p1', name: 'P1', color: '#222222' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const wsG = {
      deserializeAttachment: () => ({
        playerId: 'guesser-1',
        player: { id: 'guesser-1', name: 'Guesser1', color: '#333333' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }

    // After p1 leaves, drawer-2 and guesser-1 remain (2 players)
    mockGetWebSockets.mockReturnValue([wsDrawer, wsG])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'drawer-2'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: 'drawer-2',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'drawer-2', 'guesser-1'], // p1 already drew (round 1)
      scores: new Map([
        ['p1', { score: 10, name: 'P1' }],
        ['drawer-2', { score: 0, name: 'Drawer2' }],
        ['guesser-1', { score: 5, name: 'Guesser1' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'cat', 'dog'],
      choiceDeadline: Date.now() + 10_000,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']

    // p1 (non-drawer who already drew) leaves during word-choice
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleLeave(wsPrevDrawer as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
    // p1 was at index 0 (already drew, index <= currentRound-1) so currentRound decremented
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.currentRound).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.drawerOrder).toEqual(['drawer-2', 'guesser-1'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.totalRounds).toBe(2)
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
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
    const errorMsg = msgs.find((m) => m?.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg?.message).toBe('Fill failed: only the current drawer can fill')
    expect((errorMsg as { action?: string }).action).toBe('fill')
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    await room.webSocketMessage(
      ws,
      JSON.stringify({ type: 'fill', x: 100, y: 100, color: '#FF6B6B' })
    )
    await flushPromises()

    const msgs = getSentMessages(ws)
    expect(msgs.some((m) => m?.type === 'fill')).toBe(false)
    const errorMsg = msgs.find((m) => m?.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg?.message).toBe('Fill failed: game is not in progress')
    expect((errorMsg as { action?: string }).action).toBe('fill')
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
      JSON.stringify({ type: 'fill', x: 0.1, y: 0.2, color: '#FF6B6B' })
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await flushPromises()

    // Both sockets should have received the fill broadcast
    const drawerMsgs = getSentMessages(drawerWs)
    const observerMsgs = getSentMessages(observerWs)
    const drawerFill = drawerMsgs.find((m) => m?.type === 'fill')
    const observerFill = observerMsgs.find((m) => m?.type === 'fill')
    expect(
      drawerFill &&
        drawerFill.playerId === 'player-1' &&
        drawerFill.x === 0.1 &&
        drawerFill.y === 0.2 &&
        drawerFill.color === '#FF6B6B'
    ).toBe(true)
    expect(
      observerFill &&
        observerFill.playerId === 'player-1' &&
        observerFill.x === 0.1 &&
        observerFill.y === 0.2 &&
        observerFill.color === '#FF6B6B'
    ).toBe(true)
    expect(drawerFill?.seq).toBe(1)
    expect(observerFill?.seq).toBe(1)

    // Storage put should have been called for fills
    const fillPutCalls = mockStoragePut.mock.calls.filter((call) => call[0] === 'fills')
    expect(fillPutCalls.length).toBeGreaterThan(0)
  })

  test('handleFill: echoes nonce only to the originating client', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    const observerWs = createMockWs('player-2', 'Observer')
    mockGetWebSockets.mockReturnValue([drawerWs, observerWs])
    setPlayingState('player-1')

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({
        type: 'fill',
        x: 0.5,
        y: 0.5,
        color: '#FF6B6B',
        nonce: 'nonce-123',
      })
    )
    await flushPromises()

    const drawerFill = getSentMessages(drawerWs).find((m) => m?.type === 'fill')
    const observerFill = getSentMessages(observerWs).find((m) => m?.type === 'fill')

    expect(drawerFill?.nonce).toBe('nonce-123')
    expect(observerFill?.nonce).toBeUndefined()
    expect(drawerFill?.seq).toBe(1)
    expect(observerFill?.seq).toBe(1)
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
      JSON.stringify({ type: 'fill', x: 0.1, y: 0.2, color: 'red' })
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

  test('handleUndoStroke: non-existent strokeId sends error and does not broadcast stroke-removed', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-stroke', strokeId: 'non-existent-stroke-id' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    // Should NOT have a stroke-removed message
    expect(msgs.some((m) => m?.type === 'stroke-removed')).toBe(false)
    // Should have an error message
    expect(msgs.some((m) => m?.type === 'error')).toBe(true)
  })

  test('handleUndoFill: non-existent fillId sends error and does not broadcast fill-removed', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-fill', fillId: 'non-existent-fill-id' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    // Should NOT have a fill-removed message
    expect(msgs.some((m) => m?.type === 'fill-removed')).toBe(false)
    // Should have an error message
    expect(msgs.some((m) => m?.type === 'error')).toBe(true)
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

  test('handleClear: clears in-memory state immediately even when storage delete fails', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Setup initial state with strokes and fills
    const initialStrokes = [
      {
        id: 'stroke-1',
        playerId: 'player-1',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: Date.now(),
      },
    ]
    const initialFills = [
      {
        id: 'fill-1',
        playerId: 'player-1',
        x: 10,
        y: 10,
        color: '#4ECDC4',
        timestamp: Date.now() + 100,
      },
    ]

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = initialStrokes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = initialFills
    // Set storage write delay to 0 to make async operations complete synchronously
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0

    // Mock queueFillDelete to fail while queueStrokeDelete succeeds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueFillDelete = mock(() => Promise.reject(new Error('fill delete failed')))

    const mockError = mock(() => {})
    const originalError = console.error
    console.error = mockError
    try {
      await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'clear' }))
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // Verify in-memory state is cleared despite storage failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).fills).toEqual([])

    // Verify error was logged (the fill delete failure)
    expect(mockError).toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorCalls = mockError.mock.calls.filter((call: any) => {
      return (
        call.length > 0 &&
        typeof call[0] === 'string' &&
        call[0].includes('Failed to delete fills from storage')
      )
    })
    expect(errorCalls.length).toBeGreaterThan(0)

    // Verify clear broadcast was sent
    const msgs = getSentMessages(drawerWs)
    expect(msgs.some((m) => m?.type === 'clear')).toBe(true)
  })

  test('handleUndoStroke: error messages include action field', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Test non-drawer error
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-stroke', strokeId: 'stroke-1' })
    )
    await flushPromises()
    setPlayingState('player-1') // Reset to playing state for next test

    // Test non-existent stroke error
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-stroke', strokeId: 'non-existent-stroke-id' })
    )
    await flushPromises()
    setPlayingState('player-1') // Reset to playing state for next test

    // Test invalid stroke ID error
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-stroke', strokeId: 'invalid id' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    const errorMessages = msgs.filter((m) => m?.type === 'error')
    // All errors should have action field set to 'undo-stroke'
    errorMessages.forEach((msg) => {
      if (msg && msg.type === 'error') {
        expect((msg as { action?: string }).action).toBe('undo-stroke')
      }
    })
  })

  test('handleUndoFill: error messages include action field', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Test non-existent fill error
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-fill', fillId: 'non-existent-fill-id' })
    )
    await flushPromises()
    setPlayingState('player-1') // Reset to playing state for next test

    // Test invalid fill ID error
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-fill', fillId: 'invalid id' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    const errorMessages = msgs.filter((m) => m?.type === 'error')
    // All errors should have action field set to 'undo-fill'
    errorMessages.forEach((msg) => {
      if (msg && msg.type === 'error') {
        expect((msg as { action?: string }).action).toBe('undo-fill')
      }
    })
  })

  test('handleFill: rate limit error includes action field', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Exhaust rate limit by sending many fills
    for (let i = 0; i < 150; i++) {
      await room.webSocketMessage(
        drawerWs,
        JSON.stringify({ type: 'fill', x: 0.5, y: 0.5, color: '#FF6B6B' })
      )
    }
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    const rateLimitError = msgs.find(
      (m) => m?.type === 'error' && m?.message === 'Rate limit exceeded'
    )
    expect(rateLimitError).toBeDefined()
    expect((rateLimitError as { action?: string }).action).toBe('fill')
  })

  test('handleStroke: rejected drawing errors include action field', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    const nonDrawerWs = createMockWs('player-2', 'Observer')
    mockGetWebSockets.mockReturnValue([drawerWs, nonDrawerWs])

    // Not playing should send an explicit stroke rejection instead of silently dropping.
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({
        type: 'stroke',
        stroke: {
          id: 'stroke-1',
          playerId: 'player-1',
          color: '#FF6B6B',
          size: 4,
          points: [{ x: 0, y: 0 }],
          timestamp: Date.now(),
        },
      })
    )
    await flushPromises()

    setPlayingState('player-1')

    await room.webSocketMessage(
      nonDrawerWs,
      JSON.stringify({
        type: 'stroke',
        stroke: {
          id: 'stroke-2',
          playerId: 'player-2',
          color: '#4ECDC4',
          size: 4,
          points: [{ x: 1, y: 1 }],
          timestamp: Date.now(),
        },
      })
    )
    await flushPromises()

    const notPlayingError = getSentMessages(drawerWs).find((m) => m?.type === 'error')
    expect(notPlayingError).toBeDefined()
    expect(notPlayingError?.message).toBe('Drawing failed: game is not in progress')
    expect((notPlayingError as { action?: string }).action).toBe('stroke')

    const nonDrawerError = getSentMessages(nonDrawerWs).find((m) => m?.type === 'error')
    expect(nonDrawerError).toBeDefined()
    expect(nonDrawerError?.message).toBe('Drawing failed: only the current drawer can draw')
    expect((nonDrawerError as { action?: string }).action).toBe('stroke')
  })

  test('handleStroke: rate limit error includes action field', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    for (let i = 0; i < 150; i++) {
      await room.webSocketMessage(
        drawerWs,
        JSON.stringify({
          type: 'stroke',
          stroke: {
            id: `stroke-${i}`,
            playerId: 'player-1',
            color: '#FF6B6B',
            size: 4,
            points: [{ x: i, y: i }],
            timestamp: Date.now(),
          },
        })
      )
    }
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    const rateLimitError = msgs.find(
      (m) => m?.type === 'error' && m?.message === 'Rate limit exceeded'
    )
    expect(rateLimitError).toBeDefined()
    expect((rateLimitError as { action?: string }).action).toBe('stroke')
  })

  test('handleStrokeUpdate: ignores updates when the game is not playing or the player is not the drawer', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    const nonDrawerWs = createMockWs('player-2', 'Observer')
    mockGetWebSockets.mockReturnValue([drawerWs, nonDrawerWs])

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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'stroke-1', point: { x: 1, y: 1 } })
    )
    await flushPromises()

    setPlayingState('player-1')

    await room.webSocketMessage(
      nonDrawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'stroke-1', point: { x: 2, y: 2 } })
    )
    await flushPromises()

    expect(getSentMessages(drawerWs)).toHaveLength(0)
    expect(getSentMessages(nonDrawerWs)).toHaveLength(0)
  })

  test('handleStrokeUpdate: validates identifiers and points before mutating state', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'player-1',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: 1000,
      },
    ]

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'invalid id', point: { x: 1, y: 1 } })
    )
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'stroke-1', point: { x: 'bad', y: 1 } })
    )
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes[0].points).toEqual([{ x: 0, y: 0 }])
    expect(getSentMessages(drawerWs).some((message) => message?.type === 'stroke-update')).toBe(
      false
    )
  })

  test('handleStrokeUpdate: rejects updates once a stroke reaches the maximum point count', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'player-1',
        color: '#FF6B6B',
        size: 4,
        points: Array.from({ length: MAX_STROKE_POINTS }, (_, index) => ({ x: index, y: index })),
        timestamp: 1000,
      },
    ]

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'stroke-1', point: { x: 999, y: 999 } })
    )
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes[0].points).toHaveLength(MAX_STROKE_POINTS)
    expect(getSentMessages(drawerWs).some((message) => message?.type === 'stroke-update')).toBe(
      false
    )
  })

  test('handleStrokeUpdate: appends points and broadcasts valid updates to other players', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    const observerWs = createMockWs('player-2', 'Observer')
    mockGetWebSockets.mockReturnValue([drawerWs, observerWs])
    setPlayingState('player-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'player-1',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: 1000,
      },
    ]

    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'stroke-update', strokeId: 'stroke-1', point: { x: 2, y: 3 } })
    )
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 3 },
    ])
    expect(getSentMessages(drawerWs).some((message) => message?.type === 'stroke-update')).toBe(
      false
    )
    expect(getSentMessages(observerWs)).toContainEqual({
      type: 'stroke-update',
      strokeId: 'stroke-1',
      point: { x: 2, y: 3 },
    })
  })

  test('handleUndoStroke: enforces LIFO semantics - rejects non-most-recent stroke', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Set up multiple strokes for the same player
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [
      {
        id: 'stroke-1',
        playerId: 'player-1',
        color: '#FF6B6B',
        size: 4,
        points: [{ x: 0, y: 0 }],
        timestamp: 1000,
      },
      {
        id: 'stroke-2',
        playerId: 'player-1',
        color: '#4ECDC4',
        size: 4,
        points: [{ x: 10, y: 10 }],
        timestamp: 2000,
      },
    ]

    // Attempt to undo the first (older) stroke instead of the most recent one
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'undo-stroke', strokeId: 'stroke-1' })
    )
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    // Should NOT have a stroke-removed message
    expect(msgs.some((m) => m?.type === 'stroke-removed')).toBe(false)
    // Should have an error message about LIFO
    const errorMsg = msgs.find((m) => m?.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg?.message).toContain('can only undo the most recent operation')
    expect((errorMsg as { action?: string }).action).toBe('undo-stroke')
  })

  test('handleUndoFill: enforces LIFO semantics - rejects non-most-recent fill', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')

    // Set up multiple fills for the same player
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [
      {
        id: 'fill-1',
        playerId: 'player-1',
        x: 10,
        y: 10,
        color: '#FF6B6B',
        timestamp: 1000,
      },
      {
        id: 'fill-2',
        playerId: 'player-1',
        x: 20,
        y: 20,
        color: '#4ECDC4',
        timestamp: 2000,
      },
    ]

    // Attempt to undo the first (older) fill instead of the most recent one
    await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'undo-fill', fillId: 'fill-1' }))
    await flushPromises()

    const msgs = getSentMessages(drawerWs)
    // Should NOT have a fill-removed message
    expect(msgs.some((m) => m?.type === 'fill-removed')).toBe(false)
    // Should have an error message about LIFO
    const errorMsg = msgs.find((m) => m?.type === 'error')
    expect(errorMsg).toBeDefined()
    expect(errorMsg?.message).toContain('can only undo the most recent operation')
    expect((errorMsg as { action?: string }).action).toBe('undo-fill')
  })
})

describe('DrawingRoom - startRound, handleCorrectGuess, webSocketClose, webSocketError, handleJoin', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

  function setStartingState(
    drawerOrder: string[],
    scores: Map<string, { score: number; name: string }>
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'starting',
      currentRound: 0,
      totalRounds: drawerOrder.length,
      drawerOrder,
      scores,
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }
  }

  function setPlayingState(drawerId: string, guessers: string[] = []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: drawerId,
      currentWord: 'banana',
      wordLength: 6,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: [drawerId, ...guessers],
      scores: new Map([
        [drawerId, { score: 0, name: 'Drawer' }],
        ...guessers.map(
          (g) => [g, { score: 0, name: `Player ${g}` }] as [string, { score: number; name: string }]
        ),
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(guessers),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['banana']),
      consecutiveMissedRounds: new Map(),
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

  test('startRound sends word-options to drawer and word-choice-start to others', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setStartingState(
      ['p1', 'p2'],
      new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ])
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).startRound()
    await flushPromises()

    const drawerMsgs = getSentMessages(drawerWs)
    const guesserMsgs = getSentMessages(guesserWs)

    // Drawer should receive word-options with round context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wordOptions = drawerMsgs.find((m: any) => m?.type === 'word-options')
    expect(wordOptions).toBeDefined()
    expect(Array.isArray(wordOptions.words)).toBe(true)
    expect(wordOptions.words.length).toBeGreaterThan(0)
    expect(wordOptions.roundNumber).toBe(1)
    expect(wordOptions.totalRounds).toBe(2)
    expect(typeof wordOptions.wordChoiceEndTime).toBe('number')

    // Guesser should receive word-choice-start
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wordChoiceStart = guesserMsgs.find((m: any) => m?.type === 'word-choice-start')
    expect(wordChoiceStart).toBeDefined()

    // Word-choice timer should be set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).wordChoiceTimer).not.toBeNull()

    // Game status should transition to 'word-choice'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
  })

  test('beginDrawing broadcasts canvas clear message and transitions to playing', async () => {
    const ws1 = createMockWs('p1', 'Player1')
    const ws2 = createMockWs('p2', 'Player2')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    setStartingState(
      ['p1', 'p2'],
      new Map([
        ['p1', { score: 0, name: 'Player1' }],
        ['p2', { score: 0, name: 'Player2' }],
      ])
    )

    // Set up word-choice state first
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Player1' }],
        ['p2', { score: 0, name: 'Player2' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).beginDrawing('apple')
    await flushPromises()

    // Both players should receive a 'clear' message
    const p1Msgs = getSentMessages(ws1)
    const p2Msgs = getSentMessages(ws2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(p1Msgs.some((m: any) => m?.type === 'clear')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(p2Msgs.some((m: any) => m?.type === 'clear')).toBe(true)

    // Game status should transition to 'playing'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('playing')

    // Round timers should be set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).roundTimer).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).tickTimer).not.toBeNull()
  })

  test('startRound calls endGame when no valid drawers are connected', async () => {
    mockGetWebSockets.mockReturnValue([])

    setStartingState(['p1'], new Map([['p1', { score: 0, name: 'Player1' }]]))
    // Set round past the drawer order length to trigger no-drawer path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState.currentRound = 99

    const endGameSpy = mock(() => {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).endGame = endGameSpy

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).startRound()

    expect(endGameSpy).toHaveBeenCalled()
  })

  test('choose-word: drawer choosing a valid word transitions to playing state', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    // Set up word-choice state with p1 as drawer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['cat', 'dog', 'fish']

    await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'choose-word', word: 'cat' }))
    await flushPromises()

    // Game should now be in playing state with the chosen word
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('playing')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.currentWord).toBe('cat')
  })

  test('choose-word: invalid word (not in options) is rejected with error', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1'],
      scores: new Map([['p1', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['cat', 'dog', 'fish']

    await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'choose-word', word: 'elephant' }))
    await flushPromises()

    // Game should remain in word-choice state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')

    const msgs = getSentMessages(drawerWs)
    const errorMsg = msgs.find((m) => m?.type === 'error')
    expect(errorMsg).toBeDefined()
  })

  test('choose-word: non-drawer sending choose-word is silently ignored', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['cat', 'dog', 'fish']

    // Guesser (p2) sends choose-word — should be silently ignored
    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'choose-word', word: 'cat' }))
    await flushPromises()

    // Game should remain in word-choice state
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
  })

  test('handleCorrectGuess updates score and broadcasts correct-guess', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingState('p1', ['p2'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleCorrectGuess('p2', 'Guesser')
    await flushPromises()

    // Both players receive correct-guess broadcast
    const drawerMsgs = getSentMessages(drawerWs)
    const guesserMsgs = getSentMessages(guesserWs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawerNotif = drawerMsgs.find((m: any) => m?.type === 'correct-guess')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guesserNotif = guesserMsgs.find((m: any) => m?.type === 'correct-guess')
    expect(drawerNotif).toBeDefined()
    expect(drawerNotif.playerId).toBe('p2')
    expect(drawerNotif.playerName).toBe('Guesser')
    expect(guesserNotif).toBeDefined()

    // Score should be updated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const score = (room as any).gameState.scores.get('p2')
    expect(score).toBeDefined()
    expect(score.score).toBeGreaterThan(0)
  })

  test('handleCorrectGuess ends round early when all guessers have guessed', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingState('p1', ['p2'])

    const endRoundSpy = mock(() => {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).endRound = endRoundSpy
    // p2 is the only guesser - guessing correctly should trigger early round end
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleCorrectGuess('p2', 'Guesser')

    expect(endRoundSpy).toHaveBeenCalledWith(false)
  })

  test('handleCorrectGuess prevents duplicate scoring for same player', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingState('p1', ['p2'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleCorrectGuess('p2', 'Guesser')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstScore = (room as any).gameState.scores.get('p2').score
    // Second call should be a no-op
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleCorrectGuess('p2', 'Guesser')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondScore = (room as any).gameState.scores.get('p2').score

    expect(secondScore).toBe(firstScore)
  })

  test('webSocketClose calls handleLeave and broadcasts player-left', async () => {
    const ws1 = createMockWs('p1', 'Player1')
    const ws2 = createMockWs('p2', 'Player2')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    await room.webSocketClose(ws1 as unknown as WebSocket)
    await flushPromises()

    // ws2 should receive player-left for p1
    const ws2Msgs = getSentMessages(ws2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerLeft = ws2Msgs.find((m: any) => m?.type === 'player-left')
    expect(playerLeft).toBeDefined()
    expect(playerLeft.playerId).toBe('p1')
  })

  test('webSocketError calls handleLeave and broadcasts player-left', async () => {
    const ws1 = createMockWs('p1', 'Player1')
    const ws2 = createMockWs('p2', 'Player2')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p2'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    await room.webSocketError(ws1 as unknown as WebSocket)
    await flushPromises()

    // ws2 should receive player-left for p1
    const ws2Msgs = getSentMessages(ws2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerLeft = ws2Msgs.find((m: any) => m?.type === 'player-left')
    expect(playerLeft).toBeDefined()
    expect(playerLeft.playerId).toBe('p1')
  })

  test('handleJoin via webSocketMessage sends init to new player and player-joined to others', async () => {
    const existingWs = createMockWs('existing-player', 'ExistingPlayer')
    const newWs = {
      deserializeAttachment: () => null,
      serializeAttachment: mock(() => {}),
      send: mock(() => {}),
      close: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    // After join, newWs should have attachment set via serializeAttachment
    // Simulate: after serializeAttachment is called, deserializeAttachment returns new player
    let capturedAttachment: unknown = null
    newWs.serializeAttachment = mock((attachment: unknown) => {
      capturedAttachment = attachment
      newWs.deserializeAttachment = () => capturedAttachment
    })

    mockGetWebSockets.mockReturnValue([existingWs, newWs])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'existing-player'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'NewPlayer' })
    )
    await flushPromises()

    // newWs should receive 'init' message
    const newWsMsgs = getSentMessages(newWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initMsg = newWsMsgs.find((m: any) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.players).toBeDefined()

    // existingWs should receive 'player-joined' message
    const existingMsgs = getSentMessages(existingWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const playerJoined = existingMsgs.find((m: any) => m?.type === 'player-joined')
    expect(playerJoined).toBeDefined()
    expect(playerJoined.player.name).toBe('NewPlayer')
  })

  test('handleJoin assigns first player as host', async () => {
    const newWs = {
      deserializeAttachment: () => null,
      serializeAttachment: mock(() => {}),
      send: mock(() => {}),
      close: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    let capturedAttachment: unknown = null
    newWs.serializeAttachment = mock((attachment: unknown) => {
      capturedAttachment = attachment
      newWs.deserializeAttachment = () => capturedAttachment
    })

    mockGetWebSockets.mockReturnValue([newWs])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'FirstPlayer' })
    )
    await flushPromises()

    // First player should become the host
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hostPlayerId).not.toBeNull()

    // Init message should have isHost: true
    const msgs = getSentMessages(newWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const initMsg = msgs.find((m: any) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.isHost).toBe(true)
  })

  test('handleJoin during word-choice persists late joiner score entry', async () => {
    const existingWs = createMockWs('drawer-1', 'Drawer')
    const newWs = {
      deserializeAttachment: () => null,
      serializeAttachment: mock(() => {}),
      send: mock(() => {}),
      close: mock(() => {}),
    } as unknown as WebSocket

    let capturedAttachment: unknown = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newWs.serializeAttachment = mock((attachment: any) => {
      capturedAttachment = attachment
      newWs.deserializeAttachment = () => capturedAttachment
    })

    mockGetWebSockets.mockReturnValue([existingWs, newWs])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'drawer-1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'drawer-1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['drawer-1', 'guesser-1'],
      scores: new Map([['drawer-1', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'cat', 'dog'],
      choiceDeadline: Date.now() + 10_000,
    }

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'LateJoiner' })
    )
    await flushPromises()

    // Late joiner should be added to scores
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scores = (room as any).gameState.scores as Map<string, { score: number; name: string }>
    // Find the new player in scores and verify entry
    let found = false
    for (const [playerId, entry] of scores) {
      if (entry.name === 'LateJoiner') {
        found = true
        expect(entry.score).toBe(0)
        // Verify the player was added with a valid UUID-style ID
        expect(playerId).toMatch(/-/)
        break
      }
    }
    expect(found).toBe(true)

    // waitUntil should have been called to persist the score entry for word-choice state
    expect(mockWaitUntil).toHaveBeenCalled()
  })
})

describe('DrawingRoom - fetch HTTP endpoints', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockAcceptWebSocket: ReturnType<typeof mock>

  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStoragePut = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})
    mockAcceptWebSocket = mock(() => {})

    mockState = {
      storage: {
        get: mock(() => Promise.resolve(undefined)),
        put: mockStoragePut,
        delete: mock(() => Promise.resolve()),
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
      acceptWebSocket: mockAcceptWebSocket,
    }

    mockEnv = {}
    void mockEnv

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, mockEnv as any)
    // Skip initialization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  test('POST /create marks room as created and returns 200', async () => {
    const request = new Request('http://localhost/create', { method: 'POST' })
    const response = await room.fetch(request)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Created')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).created).toBe(true)
    expect(mockStoragePut).toHaveBeenCalledWith('created', true)
  })

  test('GET /ws returns 404 when room has not been created', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = false
    const request = new Request('http://localhost/ws', {
      method: 'GET',
      headers: { Upgrade: 'websocket' },
    })
    const response = await room.fetch(request)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Room not found')
  })

  test('GET /ws returns 426 when missing Upgrade header', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = true
    const request = new Request('http://localhost/ws', { method: 'GET' })
    const response = await room.fetch(request)

    expect(response.status).toBe(426)
    expect(await response.text()).toBe('Expected WebSocket')
  })

  test('GET /ws returns 426 when Upgrade header is not websocket', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = true
    const request = new Request('http://localhost/ws', {
      method: 'GET',
      headers: { Upgrade: 'http/2' },
    })
    const response = await room.fetch(request)

    expect(response.status).toBe(426)
  })

  test('GET /ws upgrades to WebSocket when room exists and Upgrade header is correct', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = true

    // Save original so we can restore it even if assertions fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalWebSocketPair = (globalThis as any).WebSocketPair

    // Mock WebSocketPair globally for this test
    const mockClientWs = { type: 'client' }
    const mockServerWs = { type: 'server' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocketPair = function () {
      return { 0: mockClientWs, 1: mockServerWs }
    }

    try {
      const request = new Request('http://localhost/ws', {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      })
      const response = await room.fetch(request)

      expect(response.status).toBe(101)
      expect(mockAcceptWebSocket).toHaveBeenCalledWith(mockServerWs)
    } finally {
      if (originalWebSocketPair === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).WebSocketPair
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(globalThis as any).WebSocketPair = originalWebSocketPair
      }
    }
  })

  test('GET /info returns 404 when room has not been created', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = false
    const request = new Request('http://localhost/info', { method: 'GET' })
    const response = await room.fetch(request)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })

  test('GET /info returns player and stroke counts when room exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).created = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [{ id: 'stroke-1' }, { id: 'stroke-2' }]

    const ws1 = createMockWs('player-1', 'Alice')
    const ws2 = createMockWs('player-2', 'Bob')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    const request = new Request('http://localhost/info', { method: 'GET' })
    const response = await room.fetch(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((body as any).playerCount).toBe(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((body as any).strokeCount).toBe(2)
  })

  test('unknown path returns 404', async () => {
    const request = new Request('http://localhost/unknown-path', { method: 'GET' })
    const response = await room.fetch(request)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })
})

describe('DrawingRoom - storage error catch blocks', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>

  let mockEnv: unknown

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  function setPlayingState(drawerId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: drawerId,
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: [drawerId, 'other'],
      scores: new Map([[drawerId, { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set<string>(),
      roundGuessers: new Set<string>(),
      roundGuesserScores: new Map<string, number>(),
      usedWords: new Set<string>(),
      endGameAfterCurrentRound: false,
    }
  }

  test('handleClear: stroke delete failure logs error and marks dirty', async () => {
    const drawerWs = createMockWs('player-1', 'Drawer')
    mockGetWebSockets.mockReturnValue([drawerWs])
    setPlayingState('player-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [{ id: 'stroke-1', playerId: 'player-1' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = []

    // Mock queueStrokeDelete to fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueStrokeDelete = mock(() => Promise.reject(new Error('stroke delete failed')))

    const mockError = mock(() => {})
    const originalError = console.error
    console.error = mockError

    try {
      await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'clear' }))
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // In-memory should be cleared
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strokeDirty = (room as any).strokeStorageDirty
    expect(strokeDirty).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(mockError.mock.calls.some((call: any) => String(call[0]).includes('strokes'))).toBe(true)
  })

  test('handleResetGame: stroke and fill delete failures log errors', async () => {
    const hostWs = createMockWs('host-player', 'Host')
    mockGetWebSockets.mockReturnValue([hostWs])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'host-player'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'game-over',
      currentRound: 2,
      totalRounds: 2,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set<string>(),
      winners: [],
      finalScores: {},
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [{ id: 'stroke-1' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [{ id: 'fill-1' }]

    // Mock both queue deletes to fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueStrokeDelete = mock(() => Promise.reject(new Error('stroke delete fail')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueFillDelete = mock(() => Promise.reject(new Error('fill delete fail')))

    const mockError = mock(() => {})
    const originalError = console.error
    console.error = mockError

    try {
      await room.webSocketMessage(hostWs, JSON.stringify({ type: 'reset-game' }))
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // Verify both error catch blocks ran
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockError.mock.calls.map((c: any) => String(c[0]))
    expect(calls.some((c) => c.includes('strokes'))).toBe(true)
    expect(calls.some((c) => c.includes('fills'))).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokeStorageDirty).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).fillStorageDirty).toBe(true)
  })

  test('webSocketMessage: inner sendError catch fires when ws.send throws', async () => {
    const ws = {
      deserializeAttachment: () => ({
        playerId: 'player-1',
        player: { id: 'player-1', name: 'P', color: '#FF6B6B' },
      }),
      serializeAttachment: mock(() => {}),
      send: mock(() => {
        throw new Error('socket closed')
      }),
      close: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    const ws2 = createMockWs('player-2', 'Q')
    mockGetWebSockets.mockReturnValue([ws, ws2])

    // Make player-1 the host so handleStartGame proceeds past the permission check
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'player-1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set<string>(),
    }

    // Override storagePutWithRetry to throw immediately so persistGameState throws,
    // which causes handleStartGame to throw, triggering sendError in the outer catch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storagePutWithRetry = async () => {
      throw new Error('storage failure')
    }

    // Send start-game as host: persistGameState throws → sendError is called →
    // ws.send throws when sendError tries to send the error response → inner catch fires
    await room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'start-game' }))

    // sendError was triggered: ws.send was called (and threw), no exception propagated
    expect(ws.send).toHaveBeenCalled()
    // serializeAttachment should not have been called (error path, not a normal response)
    expect(ws.serializeAttachment).not.toHaveBeenCalled()
  })

  test('resumeGameFlowFromState: sets up round and tick timers when playing round has time remaining', () => {
    const setTimeoutSpy = mock(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const setIntervalSpy = mock(() => 1 as unknown as ReturnType<typeof setInterval>)
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    globalThis.setTimeout = setTimeoutSpy as unknown as typeof setTimeout
    globalThis.setInterval = setIntervalSpy as unknown as typeof setInterval

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'playing',
        currentRound: 1,
        totalRounds: 2,
        currentDrawerId: 'p1',
        currentWord: 'cat',
        wordLength: 3,
        roundStartTime: Date.now() - 10_000,
        roundEndTime: Date.now() + 50_000, // 50 seconds remaining
        drawerOrder: ['p1', 'p2'],
        scores: new Map(),
        correctGuessers: new Set(),
        roundGuessers: new Set(),
        roundStartGuesserIds: new Set(),
        roundGuesserScores: new Map(),
        usedWords: new Set(),
        consecutiveMissedRounds: new Map(),
        endGameAfterCurrentRound: false,
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).resumeGameFlowFromState()

      // Should have called setTimeout (roundTimer) and setInterval (tickTimer)
      expect(setTimeoutSpy).toHaveBeenCalled()
      expect(setIntervalSpy).toHaveBeenCalled()
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
    }
  })

  test('resumeGameFlowFromState: uses fallback delay when nextTransitionAt is null in round-end', () => {
    const setTimeoutSpy = mock(() => 1 as unknown as ReturnType<typeof setTimeout>)
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = setTimeoutSpy as unknown as typeof setTimeout

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'round-end',
        currentRound: 1,
        totalRounds: 3,
        currentDrawerId: null,
        drawerOrder: ['p1', 'p2'],
        scores: new Map(),
        lastRoundResult: null,
        usedWords: new Set(),
        consecutiveMissedRounds: new Map(),
        endGameAfterCurrentRound: false,
        nextTransitionAt: null, // Null - should use fallback delay
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).resumeGameFlowFromState()

      // Should call setTimeout with the ROUND_END_TRANSITION_DELAY fallback
      // (currentRound:1 < totalRounds:3 and endGameAfterCurrentRound:false → shouldEnd=false)
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), ROUND_END_TRANSITION_DELAY)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('beginWordChoice ends game when player count drops below MIN_PLAYERS_TO_START', () => {
    // Simulate a DO waking from hibernation with only 1 connected player
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'solo-player',
        player: { id: 'solo-player', name: 'Solo', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws1])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'solo-player',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['solo-player', 'gone-player'],
      scores: new Map([
        ['solo-player', { score: 0, name: 'Solo' }],
        ['gone-player', { score: 0, name: 'Gone' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: null,
      choiceDeadline: null,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).beginWordChoice()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('game-over')
  })

  test('beginWordChoice proceeds normally when enough players are connected', () => {
    const ws1 = {
      deserializeAttachment: () => ({
        playerId: 'player-1',
        player: { id: 'player-1', name: 'Player1', color: '#111111' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    const ws2 = {
      deserializeAttachment: () => ({
        playerId: 'player-2',
        player: { id: 'player-2', name: 'Player2', color: '#222222' },
      }),
      send: mock(() => {}),
      close: mock(() => {}),
    }
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 2,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['player-1', 'player-2'],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).beginWordChoice()

    // Should have transitioned to word-choice, NOT game-over
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
  })
})

describe('DrawingRoom - sendError inner catch and startRound storage errors', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>

  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStoragePut = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    mockState = {
      storage: {
        get: mock(() => Promise.resolve(undefined)),
        put: mockStoragePut,
        delete: mock(() => Promise.resolve()),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storageWriteDelay = 0
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  test('sendError inner catch fires when ws.send throws during handler error recovery', async () => {
    // Create a ws that throws on send
    const throwingWs = {
      deserializeAttachment: () => null, // Returns null so getPlayerIdForSocket returns null
      serializeAttachment: mock(() => {}),
      send: mock(() => {
        throw new Error('WebSocket connection closed')
      }),
      close: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any

    mockGetWebSockets.mockReturnValue([throwingWs])

    // Make handleJoin throw by making storagePutWithRetry throw on any call
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).storagePutWithRetry = mock(() =>
      Promise.reject(new Error('storage unavailable'))
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set<string>(),
    }

    const mockError = mock(() => {})
    const originalError = console.error
    console.error = mockError

    try {
      // Send a join message - handleJoin will throw because storagePutWithRetry fails
      // then sendError is called, which calls ws.send, which also throws
      await room.webSocketMessage(
        throwingWs as unknown as WebSocket,
        JSON.stringify({ type: 'join', name: 'TestPlayer' })
      )
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // If sendError inner catch fires, no uncaught exception should propagate
    // Verify error was logged from the handler failure
    expect(mockError).toHaveBeenCalled()
  })

  test('beginDrawing: stroke and fill delete failures mark storage as dirty', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    // Set up word-choice state (beginDrawing requires this state)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set<string>(),
      roundGuessers: new Set<string>(),
      roundGuesserScores: new Map<string, number>(),
      usedWords: new Set<string>(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map<string, number>(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['cat', 'dog', 'fish']

    // Add some existing strokes and fills
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).strokes = [{ id: 'old-stroke' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).fills = [{ id: 'old-fill' }]

    // Mock both delete operations to fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueStrokeDelete = mock(() => Promise.reject(new Error('stroke delete failed')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).queueFillDelete = mock(() => Promise.reject(new Error('fill delete failed')))

    const mockError = mock(() => {})
    const originalError = console.error
    console.error = mockError

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).beginDrawing('cat')
      await flushPromises()
    } finally {
      console.error = originalError
    }

    // In-memory state should be cleared despite storage failures
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokes).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).fills).toEqual([])

    // Storage dirty flags should be set
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).strokeStorageDirty).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).fillStorageDirty).toBe(true)

    // Error messages should be logged for both failures
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorMessages = mockError.mock.calls.map((c: any) => String(c[0]))
    expect(errorMessages.some((m) => m.includes('strokes') || m.includes('stroke'))).toBe(true)
  })
})

describe('DrawingRoom - game state persistence ordering', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let pendingWrites: Array<{ value: unknown; resolve: () => void }>
  let committedState: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    pendingWrites = []
    committedState = null
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    const mockStoragePut = mock((_key: string, value: unknown) => {
      return new Promise<void>((resolve) => {
        pendingWrites.push({
          value,
          resolve: () => {
            committedState = value
            resolve()
          },
        })
      })
    })

    mockState = {
      storage: {
        get: mock(() => Promise.resolve(undefined)),
        put: mockStoragePut,
        delete: mock(() => Promise.resolve()),
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, {} as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  test('persistGameState keeps the newest snapshot when writes complete out of order', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(room as any).gameState,
      status: 'starting',
      currentRound: 0,
      totalRounds: 1,
      drawerOrder: ['p1'],
      scores: new Map([['p1', { score: 0, name: 'Alice' }]]),
      usedWords: new Set<string>(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstPersist = (room as any).persistGameState()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(room as any).gameState,
      status: 'game-over',
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondPersist = (room as any).persistGameState()

    await flushPromises()
    expect(pendingWrites.length).toBeGreaterThan(0)

    if (pendingWrites.length >= 2) {
      pendingWrites[1].resolve()
      await flushPromises()
      pendingWrites[0].resolve()
    } else {
      pendingWrites[0].resolve()
      await flushPromises()
      if (pendingWrites.length > 1) {
        pendingWrites[1].resolve()
      }
    }

    await Promise.all([firstPersist, secondPersist])

    expect((committedState as { status?: string } | null)?.status).toBe('game-over')
  })
})

describe('DrawingRoom - Player Reconnect', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStoragePut: ReturnType<typeof mock>
  let mockStorageDelete: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
  })

  afterEach(() => {
    if (room) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).clearTimers()
    }
  })

  test('Reconnecting player with valid playerId restores identity and score', async () => {
    const oldWs = createMockWs('p1', 'Alice')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'secret-token-p1']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([['p1', { score: 42, name: 'Alice' }]]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({
        type: 'join',
        name: 'Alice',
        playerId: 'p1',
        reconnectToken: 'secret-token-p1',
      })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.playerId).toBe('p1')
    expect(initMsg.player.id).toBe('p1')
    expect(initMsg.player.name).toBe('Alice')
    expect(initMsg.isHost).toBe(true)
    expect(initMsg.reconnectToken).toBeDefined()
    expect(typeof initMsg.reconnectToken).toBe('string')

    // Old socket should have been superseded (attachment nulled)
    const oldAttachment = oldWs.deserializeAttachment()
    expect(oldAttachment).toBeNull()

    // No player-joined broadcast for reconnects
    expect(msgs.some((m) => m?.type === 'player-joined')).toBe(false)
  })

  test('Reconnecting drawer during word-choice receives word-options after init', async () => {
    const oldWs = createMockWs('p1', 'Drawer')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'token-p1']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      offeredWords: ['cat', 'dog', 'fish'],
      choiceDeadline: Date.now() + 15_000,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['cat', 'dog', 'fish']

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Drawer', playerId: 'p1', reconnectToken: 'token-p1' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.playerId).toBe('p1')

    const wordOptionsMsg = msgs.find((m) => m?.type === 'word-options')
    expect(wordOptionsMsg).toBeDefined()
    expect(wordOptionsMsg.words).toEqual(['cat', 'dog', 'fish'])
  })

  test('Reconnecting drawer during playing receives round-start-for-drawer with word', async () => {
    const oldWs = createMockWs('p1', 'Drawer')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'token-p1']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: 'p1',
      currentWord: 'banana',
      wordLength: 6,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['banana']),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      revealedPositions: [],
    }

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Drawer', playerId: 'p1', reconnectToken: 'token-p1' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const roundStartMsg = msgs.find((m) => m?.type === 'round-start-for-drawer')
    expect(roundStartMsg).toBeDefined()
    expect(roundStartMsg.word).toBe('banana')
    expect(roundStartMsg.drawerId).toBe('p1')
  })

  test('Join with unknown playerId creates a new player (graceful fallback)', async () => {
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    let capturedAttachment: unknown = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newWs.serializeAttachment = mock((attachment: any) => {
      capturedAttachment = attachment

      newWs.deserializeAttachment = () => capturedAttachment
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'NewPlayer', playerId: 'nonexistent-id' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.playerId).not.toBe('nonexistent-id')
  })

  test('Old socket handleLeave is no-op after player reconnects on new socket', async () => {
    const oldWs = createMockWs('p1', 'Alice')
    const otherWs = createMockWs('p2', 'Bob')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'token-p1']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([
        ['p1', { score: 10, name: 'Alice' }],
        ['p2', { score: 0, name: 'Bob' }],
      ]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([oldWs, otherWs, newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Alice', playerId: 'p1', reconnectToken: 'token-p1' })
    )
    await flushPromises()

    // Now simulate old socket disconnecting
    await room.webSocketClose(oldWs as unknown as WebSocket)
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.scores.has('p1')).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hostPlayerId).toBe('p1')

    // Other player should NOT have received player-left for p1
    const otherMsgs = getSentMessages(otherWs)
    expect(otherMsgs.some((m) => m?.type === 'player-left' && m?.playerId === 'p1')).toBe(false)
  })

  test('Reconnect with wrong token is rejected — player treated as new', async () => {
    const oldWs = createMockWs('p1', 'Alice')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'correct-token']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([['p1', { score: 42, name: 'Alice' }]]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    // Send wrong token — should fall through to new-player path
    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Alice', playerId: 'p1', reconnectToken: 'wrong-token' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    // Should be a NEW playerId, not p1
    expect(initMsg.playerId).not.toBe('p1')
    // Old socket should NOT have been superseded
    const oldAttachment = oldWs.deserializeAttachment()
    expect(oldAttachment).not.toBeNull()
  })

  test('Reconnect without token is rejected — player treated as new', async () => {
    const oldWs = createMockWs('p1', 'Alice')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'secret-token']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([['p1', { score: 42, name: 'Alice' }]]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    // Send playerId without any token — should fall through to new-player path
    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Alice', playerId: 'p1' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    // Should be a NEW playerId, not p1
    expect(initMsg.playerId).not.toBe('p1')
  })

  test('Reconnecting player gets a fresh token in init response', async () => {
    const oldWs = createMockWs('p1', 'Alice')
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'old-token']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([['p1', { score: 42, name: 'Alice' }]]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    mockGetWebSockets.mockReturnValue([oldWs, newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Alice', playerId: 'p1', reconnectToken: 'old-token' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    // Token should be different from the original
    expect(initMsg.reconnectToken).toBeDefined()
    expect(initMsg.reconnectToken).not.toBe('old-token')
    // Internal token map should be updated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).playerTokens.get('p1')).toBe(initMsg.reconnectToken)
  })

  test('Reconnecting player preserves color from ScoreEntry', async () => {
    const newWs = createMockWs('', '')

    newWs.deserializeAttachment = () => null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).hostPlayerId = 'p1'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).playerTokens = new Map([['p1', 'token-p1']])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      drawerOrder: [],
      scores: new Map([['p1', { score: 42, name: 'Alice', color: '#4ECDC4' }]]),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    // Old socket is already gone (no websockets for p1)
    mockGetWebSockets.mockReturnValue([newWs])

    await room.webSocketMessage(
      newWs as unknown as WebSocket,
      JSON.stringify({ type: 'join', name: 'Alice', playerId: 'p1', reconnectToken: 'token-p1' })
    )
    await flushPromises()

    const msgs = getSentMessages(newWs)
    const initMsg = msgs.find((m) => m?.type === 'init')
    expect(initMsg).toBeDefined()
    expect(initMsg.player.color).toBe('#4ECDC4')
  })
})
