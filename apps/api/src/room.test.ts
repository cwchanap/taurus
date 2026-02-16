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

  test.skip('placeholder - setup verified', () => {
    // TODO: Implement actual setup verification
    expect(true).toBe(true)
  })

  test.skip('player who already drew leaves - adjusts drawerOrder and totalRounds', () => {
    // TODO: Implement using helper factory and DrawingRoom instance
    // This requires significant mocking of internal state which is hard to reach from outside
    expect(true).toBe(true)
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
})
