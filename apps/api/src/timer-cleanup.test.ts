import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import type { DurableObjectState } from '@cloudflare/workers-types'
import { clearTimers, type TimerContainer } from './game-logic'
import { VOCABULARY } from './vocabulary'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockWs(playerId: string, playerName = 'TestPlayer'): any {
  return {
    deserializeAttachment: () => ({
      playerId,
      player: { id: playerId, name: playerName, color: '#FF6B6B' },
    }),
    serializeAttachment: mock(() => {}),
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

describe('Timer Cleanup', () => {
  let timers: {
    roundTimer: ReturnType<typeof setTimeout> | null
    tickTimer: ReturnType<typeof setInterval> | null
    roundEndTimer: ReturnType<typeof setTimeout> | null
    gameEndTimer: ReturnType<typeof setTimeout> | null
  }

  beforeEach(() => {
    timers = {
      roundTimer: null,
      tickTimer: null,
      roundEndTimer: null,
      gameEndTimer: null,
    }
  })

  afterEach(() => {
    // Clean up any timers created during tests
    if (timers.roundTimer) clearTimeout(timers.roundTimer)
    if (timers.tickTimer) clearInterval(timers.tickTimer)
    if (timers.roundEndTimer) clearTimeout(timers.roundEndTimer)
    if (timers.gameEndTimer) clearTimeout(timers.gameEndTimer)
  })

  // clearTimers is imported from game-logic

  test('clearTimers clears all four timer types', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    timers.tickTimer = setInterval(() => {}, 100)
    timers.roundEndTimer = setTimeout(() => {}, 5000)
    timers.gameEndTimer = setTimeout(() => {}, 10000)

    clearTimers(timers as TimerContainer)

    expect(timers.roundTimer).toBeNull()
    expect(timers.tickTimer).toBeNull()
    expect(timers.roundEndTimer).toBeNull()
    expect(timers.gameEndTimer).toBeNull()
  })

  test('double clear does not cause errors', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)

    clearTimers(timers as TimerContainer)
    expect(() => clearTimers(timers as TimerContainer)).not.toThrow()
  })

  test('clearing null timers does not cause errors', () => {
    expect(() => clearTimers(timers as TimerContainer)).not.toThrow()
  })

  test('clearing only some timers works', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    timers.tickTimer = setInterval(() => {}, 100)
    // roundEndTimer and gameEndTimer remain null

    clearTimers(timers as TimerContainer)

    expect(timers.roundTimer).toBeNull()
    expect(timers.tickTimer).toBeNull()
    expect(timers.roundEndTimer).toBeNull()
    expect(timers.gameEndTimer).toBeNull()
  })

  test('timers can be recreated after clearing', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    clearTimers(timers as TimerContainer)

    timers.roundTimer = setTimeout(() => {}, 1000)
    expect(timers.roundTimer).not.toBe(null)

    clearTimers(timers as TimerContainer)
  })
})

describe('DrawingRoom - timer callback coverage', () => {
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

  test('resumeGameFlowFromState: round timer callback calls endRound when it fires', () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    globalThis.setTimeout = ((fn: () => void) => {
      fn()
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.setInterval = ((fn: () => void) => {
      fn()
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

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
        roundEndTime: Date.now() + 50_000,
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
      ;(room as any).resumeGameFlowFromState()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((room as any).gameState.status).not.toBe('playing')
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
    }
  })

  test('resumeGameFlowFromState: round-end timer callback calls startRound when it fires', () => {
    const originalSetTimeout = globalThis.setTimeout
    let scheduledTimeout: (() => void) | undefined
    globalThis.setTimeout = ((fn: () => void) => {
      scheduledTimeout = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'round-end',
        currentRound: 1,
        totalRounds: 3,
        currentDrawerId: null,
        drawerOrder: ['p1', 'p2'],
        scores: new Map([
          ['p1', { score: 0, name: 'Drawer' }],
          ['p2', { score: 0, name: 'Guesser' }],
        ]),
        lastRoundResult: null,
        usedWords: new Set<string>(),
        endGameAfterCurrentRound: false,
        nextTransitionAt: Date.now() + 2_000,
      }

      const startRoundSpy = mock(() => {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).startRound = startRoundSpy

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).resumeGameFlowFromState()

      expect(scheduledTimeout).toBeDefined()
      expect(startRoundSpy).not.toHaveBeenCalled()

      scheduledTimeout!()

      expect(startRoundSpy).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('endRound(false): round-end timer callback calls startRound when it fires', () => {
    const originalSetTimeout = globalThis.setTimeout
    let scheduledTimeout: (() => void) | undefined
    globalThis.setTimeout = ((fn: () => void) => {
      scheduledTimeout = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'playing',
        currentRound: 1,
        totalRounds: 3,
        currentDrawerId: 'p1',
        currentWord: 'cat',
        wordLength: 3,
        roundStartTime: Date.now() - 5_000,
        roundEndTime: Date.now() + 55_000,
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
      }

      const startRoundSpy = mock(() => {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).startRound = startRoundSpy

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).endRound(false)

      expect(scheduledTimeout).toBeDefined()
      expect(startRoundSpy).not.toHaveBeenCalled()

      scheduledTimeout!()

      expect(startRoundSpy).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('endRound(true): skip-to-next timer callback calls startRound when it fires', () => {
    const originalSetTimeout = globalThis.setTimeout
    let scheduledTimeout: (() => void) | undefined
    globalThis.setTimeout = ((fn: () => void) => {
      scheduledTimeout = fn
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).gameState = {
        status: 'playing',
        currentRound: 1,
        totalRounds: 3,
        currentDrawerId: 'p1',
        currentWord: 'cat',
        wordLength: 3,
        roundStartTime: Date.now() - 5_000,
        roundEndTime: Date.now() + 55_000,
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
      }

      const startRoundSpy = mock(() => {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).startRound = startRoundSpy

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).endRound(true)

      expect(scheduledTimeout).toBeDefined()
      expect(startRoundSpy).not.toHaveBeenCalled()

      scheduledTimeout!()

      expect(startRoundSpy).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.setTimeout = originalSetTimeout
    }
  })

  test('startRound: round timer callback calls endRound when it fires', () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    const scheduledTimeouts: Array<() => void> = []
    globalThis.setTimeout = ((fn: () => void) => {
      scheduledTimeouts.push(fn)
      return scheduledTimeouts.length as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.setInterval = (() => {
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    try {
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
        offeredWords: ['apple', 'cat', 'dog'],
        choiceDeadline: Date.now() + 10_000,
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
      ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).beginDrawing('apple')

      const endRoundSpy = mock(() => {})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).endRound = endRoundSpy

      const roundTimerCallback = scheduledTimeouts[0]
      expect(roundTimerCallback).toBeDefined()
      roundTimerCallback()

      expect(endRoundSpy).toHaveBeenCalledWith(false)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
    }
  })

  test('handleLeave advances word-choice when the current drawer disconnects', () => {
    const leavingDrawerWs = createMockWs('p1', 'Drawer')
    const nextDrawerWs = createMockWs('p2', 'Next Drawer')
    mockGetWebSockets.mockReturnValue([leavingDrawerWs, nextDrawerWs])

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
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'cat', 'dog'],
      choiceDeadline: Date.now() + 10_000,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Next Drawer' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).wordChoiceStartTime = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).wordChoiceTimer = 1 as unknown as ReturnType<typeof setTimeout>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).handleLeave(leavingDrawerWs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('word-choice')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.currentDrawerId).toBe('p2')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.currentRound).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.totalRounds).toBe(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.drawerOrder).toEqual(['p2'])
    const nextDrawerMessages = getSentMessages(nextDrawerWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(nextDrawerMessages.some((message: any) => message?.type === 'word-options')).toBe(true)
  })

  test('beginDrawing: tick timer callback fires and broadcasts tick', () => {
    const originalSetInterval = globalThis.setInterval
    globalThis.setInterval = ((fn: () => void) => {
      fn()
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    try {
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).beginDrawing('cat')

      const ws1Msgs = getSentMessages(ws1)
      expect(ws1Msgs.some((m) => m?.type === 'tick')).toBe(true)
    } finally {
      globalThis.setInterval = originalSetInterval
    }
  })

  test('wordChoiceTimer callback auto-selects first word and begins drawing', () => {
    const originalSetTimeout = globalThis.setTimeout
    const originalSetInterval = globalThis.setInterval
    let wordChoiceCallback: (() => void) | undefined
    let timeoutCallCount = 0

    globalThis.setTimeout = ((fn: () => void) => {
      timeoutCallCount++
      if (timeoutCallCount === 1) {
        wordChoiceCallback = fn
      }
      return timeoutCallCount as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout
    globalThis.setInterval = (() =>
      1 as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval

    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

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
      offeredWords: ['apple', 'banana', 'cherry'],
      choiceDeadline: Date.now() + 10000,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(room as any).beginWordChoice()

      expect(wordChoiceCallback).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((room as any).gameState.status).toBe('word-choice')

      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval

      wordChoiceCallback!()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((room as any).gameState.status).toBe('playing')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(typeof (room as any).gameState.currentWord).toBe('string')
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.setInterval = originalSetInterval
    }
  })

  test('beginWordChoice ends the game when fewer than three unused words remain', () => {
    const ws1 = createMockWs('p1', 'Drawer')
    const ws2 = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([ws1, ws2])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'round-end',
      currentRound: 0,
      totalRounds: 2,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      nextTransitionAt: 0,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([
        ['p1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'Guesser' }],
      ]),
      correctGuessers: new Set<string>(),
      roundGuessers: new Set<string>(['p2']),
      roundGuesserScores: new Map<string, number>(),
      usedWords: new Set(VOCABULARY.slice(2)),
      consecutiveMissedRounds: new Map<string, number>(),
      endGameAfterCurrentRound: false,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).beginWordChoice()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).gameState.status).toBe('game-over')
    expect(getSentMessages(ws1).some((message) => message?.type === 'word-options')).toBe(false)
  })
})

describe('DrawingRoom - hint timers', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockStorageGet: ReturnType<typeof mock>
  let mockStoragePut: ReturnType<typeof mock>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockStorageGet = mock(() => Promise.resolve(undefined))
    mockStoragePut = mock(() => Promise.resolve())
    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    mockState = {
      storage: {
        get: mockStorageGet,
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
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  function setPlayingStateWithWord(drawerId: string, guessers: string[], word = 'apple') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: drawerId,
      currentWord: word,
      wordLength: word.length,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: [drawerId, ...guessers],
      scores: new Map([
        [drawerId, { score: 0, name: 'Drawer' }],
        ...guessers.map(
          (g) => [g, { score: 0, name: `Player ${g}` }] as [string, { score: number; name: string }]
        ),
      ]),
      correctGuessers: new Set<string>(),
      roundGuessers: new Set(guessers),
      roundGuesserScores: new Map(),
      usedWords: new Set([word]),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      revealedPositions: [],
    }
  }

  test('sendHint(1) sends hint message to non-drawers but not to the drawer', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'apple')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).sendHint(1)

    const drawerMsgs = getSentMessages(drawerWs)
    const guesserMsgs = getSentMessages(guesserWs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(drawerMsgs.some((m: any) => m?.type === 'hint')).toBe(false)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hintMsg = guesserMsgs.find((m: any) => m?.type === 'hint')
    expect(hintMsg).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (hintMsg as any).revealed).toBe('string')
  })

  test('sendHint(2) builds on hint(1) — revealed positions are cumulative', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'elephant')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).sendHint(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positionsAfterHint1: number[] = (room as any).gameState.revealedPositions
    expect(positionsAfterHint1.length).toBeGreaterThan(0)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).sendHint(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positionsAfterHint2: number[] = (room as any).gameState.revealedPositions
    expect(positionsAfterHint2.length).toBeGreaterThanOrEqual(positionsAfterHint1.length)

    expect(positionsAfterHint1.every((p) => positionsAfterHint2.includes(p))).toBe(true)

    const guesserMsgs = getSentMessages(guesserWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hintMsgs = guesserMsgs.filter((m: any) => m?.type === 'hint')
    expect(hintMsgs.length).toBe(2)
  })

  test('sendHint does nothing when game is not in playing state', () => {
    const ws1 = createMockWs('p1', 'Player1')
    mockGetWebSockets.mockReturnValue([ws1])

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).sendHint(1)

    const msgs = getSentMessages(ws1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(msgs.some((m: any) => m?.type === 'hint')).toBe(false)
  })

  test('sendHint skips players who have already guessed correctly', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const correctGuesserWs = createMockWs('p2', 'AlreadyGuessed')
    const pendingGuesserWs = createMockWs('p3', 'StillGuessing')
    mockGetWebSockets.mockReturnValue([drawerWs, correctGuesserWs, pendingGuesserWs])

    setPlayingStateWithWord('p1', ['p2', 'p3'], 'apple')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState.correctGuessers.add('p2')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).sendHint(1)

    const correctGuesserMsgs = getSentMessages(correctGuesserWs)
    const pendingGuesserMsgs = getSentMessages(pendingGuesserWs)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(correctGuesserMsgs.some((m: any) => m?.type === 'hint')).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(pendingGuesserMsgs.some((m: any) => m?.type === 'hint')).toBe(true)
  })

  test('sendHint persists revealedPositions after updating them', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'apple')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).sendHint(1)

    const persistedState = mockStoragePut.mock.calls.find(
      (call) => call[0] === 'gameState'
    )?.[1] as { revealedPositions?: number[] } | undefined
    expect(persistedState?.revealedPositions?.length).toBeGreaterThan(0)
  })

  test('beginDrawing sets hintTimer1 and hintTimer2', () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

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
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).pendingWordOptions = ['apple', 'cat', 'dog']

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).beginDrawing('apple')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer1).not.toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer2).not.toBeNull()
  })

  test('schedulePendingHints: skips hintTimer1 when hint fraction 1 already reached, schedules hintTimer2', async () => {
    const roundEndTime = Date.now() + 60_000
    const roundStartTime = roundEndTime - 60_000

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
          return Promise.resolve({
            status: 'playing',
            currentRound: 1,
            totalRounds: 2,
            currentDrawerId: 'p1',
            currentWord: 'apple',
            wordLength: 5,
            roundStartTime,
            roundEndTime,
            drawerOrder: ['p1', 'p2'],
            scores: [['p1', { score: 0, name: 'Drawer' }]],
            correctGuessers: [],
            roundGuessers: ['p2'],
            roundGuesserScores: [],
            usedWords: ['apple'],
            consecutiveMissedRounds: [],
            endGameAfterCurrentRound: false,
            revealedPositions: [0, 1],
          })
        default:
          return Promise.resolve(undefined)
      }
    })

    const ws = createMockWs('p1', 'Drawer')
    mockGetWebSockets.mockReturnValue([ws])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (room as any).ensureInitialized()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer1).toBeNull()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((room as any).hintTimer2).not.toBeNull()
  })
})
