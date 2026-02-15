import { describe, expect, test } from 'bun:test'
import {
  gameStateToStorage,
  gameStateFromStorage,
  gameStateToWire,
  createInitialGameState,
  type PlayingState,
  type RoundEndState,
  type GameOverState,
  type StartingState,
  type StoredGameState,
} from './game-types'

describe('gameStateToStorage / gameStateFromStorage round-trip', () => {
  test('lobby state round-trips correctly', () => {
    const state = createInitialGameState()
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('lobby')
    expect(restored.currentRound).toBe(0)
    expect(restored.totalRounds).toBe(0)
    expect(restored.currentDrawerId).toBeNull()
    expect(restored.currentWord).toBeNull()
    expect(restored.scores.size).toBe(0)
    expect(restored.drawerOrder).toEqual([])
  })

  test('starting state round-trips correctly', () => {
    const state: StartingState = {
      ...createInitialGameState(),
      status: 'starting',
      totalRounds: 3,
      drawerOrder: ['p1', 'p2', 'p3'],
      scores: new Map([
        ['p1', { score: 0, name: 'Player 1' }],
        ['p2', { score: 0, name: 'Player 2' }],
      ]),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('starting')
    expect(restored.totalRounds).toBe(3)
    expect(restored.drawerOrder).toEqual(['p1', 'p2', 'p3'])
    expect(restored.scores.size).toBe(2)
  })

  test('playing state round-trips correctly', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: 'p2',
      currentWord: 'elephant',
      wordLength: 8,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['p1', 'p2', 'p3'],
      scores: new Map([
        ['p1', { score: 100, name: 'Player 1' }],
        ['p2', { score: 50, name: 'Player 2' }],
      ]),
      correctGuessers: new Set(['p1']),
      roundGuessers: new Set(['p1', 'p3']),
      roundGuesserScores: new Map([['p1', 120]]),
      usedWords: new Set(['cat', 'dog']),
      endGameAfterCurrentRound: true,
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('playing')
    const playing = restored as PlayingState
    expect(playing.currentDrawerId).toBe('p2')
    expect(playing.currentWord).toBe('elephant')
    expect(playing.wordLength).toBe(8)
    expect(playing.roundStartTime).toBe(now)
    expect(playing.roundEndTime).toBe(now + 60000)
    expect(playing.correctGuessers.has('p1')).toBe(true)
    expect(playing.roundGuessers.size).toBe(2)
    expect(playing.roundGuesserScores.get('p1')).toBe(120)
    expect(playing.usedWords.has('cat')).toBe(true)
    expect(playing.endGameAfterCurrentRound).toBe(true)
  })

  test('round-end state round-trips correctly', () => {
    const now = Date.now()
    const state: RoundEndState = {
      status: 'round-end',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: now - 60000,
      roundEndTime: now,
      drawerOrder: ['p1', 'p2', 'p3'],
      scores: new Map([['p1', { score: 200, name: 'Player 1' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat']),
      endGameAfterCurrentRound: false,
      nextTransitionAt: now + 5000,
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('round-end')
    const roundEnd = restored as RoundEndState
    expect(roundEnd.roundStartTime).toBe(now - 60000)
    expect(roundEnd.roundEndTime).toBe(now)
  })

  test('game-over state round-trips correctly', () => {
    const state: GameOverState = {
      status: 'game-over',
      currentRound: 3,
      totalRounds: 3,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2', 'p3'],
      scores: new Map([
        ['p1', { score: 300, name: 'Player 1' }],
        ['p2', { score: 250, name: 'Player 2' }],
      ]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat', 'dog', 'elephant']),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('game-over')
    expect(restored.scores.size).toBe(2)
    expect(restored.scores.get('p1')?.score).toBe(300)
    expect(restored.usedWords.size).toBe(3)
  })
})

describe('gameStateFromStorage validation', () => {
  test('corrupt playing state (missing fields) falls back to lobby', () => {
    const corrupt: StoredGameState = {
      status: 'playing',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: null, // Missing - should be non-null for playing
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundGuesserScores: [],
      usedWords: [],
    }
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('lobby')
  })

  test('corrupt round-end state (missing roundStartTime) falls back to lobby', () => {
    const corrupt: StoredGameState = {
      status: 'round-end',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null, // Missing for round-end
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundGuesserScores: [],
      usedWords: [],
    }
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('lobby')
  })

  test('unknown status falls back to lobby', () => {
    const corrupt = {
      status: 'unknown-status' as 'lobby',
      currentRound: 0,
      totalRounds: 0,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: [],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundGuesserScores: [],
      usedWords: [],
    } as StoredGameState
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('lobby')
  })
})

describe('gameStateToWire', () => {
  test('drawer sees the current word during playing state', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer',
      currentWord: 'secret',
      wordLength: 6,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['drawer', 'p2', 'p3'],
      scores: new Map([['drawer', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
    }

    const wire = gameStateToWire(state, true)
    expect(wire.currentWord).toBe('secret')
    expect(wire.wordLength).toBe(6)
  })

  test('guesser does not see the current word during playing state', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer',
      currentWord: 'secret',
      wordLength: 6,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['drawer', 'p2', 'p3'],
      scores: new Map([['drawer', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
    }

    const wire = gameStateToWire(state, false)
    expect(wire.currentWord).toBeUndefined()
    expect(wire.wordLength).toBe(6)
  })

  test('lobby state has correct shape', () => {
    const state = createInitialGameState()
    const wire = gameStateToWire(state, false)

    expect(wire.status).toBe('lobby')
    expect(wire.currentDrawerId).toBeNull()
    expect(wire.wordLength).toBeUndefined()
    expect(wire.scores).toEqual({})
  })
})
