import { describe, expect, test, it } from 'bun:test'
import {
  gameStateToStorage,
  gameStateFromStorage,
  gameStateToWire,
  createInitialGameState,
  isLobbyState,
  isStartingState,
  isGameOverState,
  isActiveGameState,
  type PlayingState,
  type RoundEndState,
  type GameOverState,
  type StartingState,
  type StoredGameState,
  type WordChoiceState,
} from './game-types'
import { buildHintString } from './game-logic'

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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map([['p1', 120]]),
      usedWords: new Set(['cat', 'dog']),
      endGameAfterCurrentRound: true,
      revealedPositions: [],
      consecutiveMissedRounds: new Map(),
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat']),
      endGameAfterCurrentRound: false,
      nextTransitionAt: now + 5000,
      consecutiveMissedRounds: new Map(),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)

    expect(restored.status).toBe('round-end')
    const roundEnd = restored as RoundEndState
    expect(roundEnd.roundStartTime).toBe(now - 60000)
    expect(roundEnd.roundEndTime).toBe(now)
    expect(roundEnd.nextTransitionAt).toBe(now + 5000)
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['cat', 'dog', 'elephant']),
      consecutiveMissedRounds: new Map(),
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
      roundStartGuesserIds: [],
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
      roundStartGuesserIds: [],
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
      roundStartGuesserIds: [],
      roundGuesserScores: [],
      usedWords: [],
    } as StoredGameState
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('lobby')
  })

  test('corrupt lobby state with non-zero currentRound resets to 0', () => {
    const corrupt: StoredGameState = {
      status: 'lobby',
      currentRound: 5, // Corrupt - should be 0 for lobby
      totalRounds: 3,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: [],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundStartGuesserIds: [],
      roundGuesserScores: [],
      usedWords: [],
    }
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('lobby')
    expect(restored.currentRound).toBe(0) // Should be reset to 0
  })

  test('corrupt starting state with non-zero currentRound resets to 0', () => {
    const corrupt: StoredGameState = {
      status: 'starting',
      currentRound: 3, // Corrupt - should be 0 for starting
      totalRounds: 5,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['p1', 'p2'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundStartGuesserIds: [],
      roundGuesserScores: [],
      usedWords: [],
    }
    const restored = gameStateFromStorage(corrupt)
    expect(restored.status).toBe('starting')
    expect(restored.currentRound).toBe(0) // Should be reset to 0
    expect(restored.totalRounds).toBe(5) // Other fields preserved
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [],
    }

    const wire = gameStateToWire(state, true)
    expect(wire.status).toBe('playing')
    if (wire.status === 'playing') {
      expect(wire.currentWord).toBe('secret')
      expect(wire.wordLength).toBe(6)
    }
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
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [],
    }

    const wire = gameStateToWire(state, false)
    expect(wire.status).toBe('playing')
    if (wire.status === 'playing') {
      expect(wire.currentWord).toBeUndefined()
      expect(wire.wordLength).toBe(6)
    }
  })

  test('lobby state has correct shape', () => {
    const state = createInitialGameState()
    const wire = gameStateToWire(state, false)

    expect(wire.status).toBe('lobby')
    expect(wire.currentDrawerId).toBeNull()
    expect(wire.scores).toEqual({})
  })

  test('round-end state wire format omits currentWord and wordLength', () => {
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
      drawerOrder: ['p1', 'p2'],
      scores: new Map([['p1', { score: 100, name: 'Player 1' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      nextTransitionAt: now + 5000,
      consecutiveMissedRounds: new Map(),
    }

    const wire = gameStateToWire(state, false)
    expect(wire.status).toBe('round-end')
    expect(wire.currentRound).toBe(2)
    expect(wire.totalRounds).toBe(3)
    expect(wire.scores).toEqual({ p1: { score: 100, name: 'Player 1' } })
  })

  test('word-choice state wire format includes choiceDeadline as deadlineTime', () => {
    const now = Date.now()
    const choiceDeadline = now + 15_000
    const state: WordChoiceState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'banana', 'cherry'],
      choiceDeadline,
      drawerOrder: ['drawer1', 'p2'],
      scores: new Map([['drawer1', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }

    const wire = gameStateToWire(state, true)
    expect(wire.status).toBe('word-choice')
    expect(wire.currentRound).toBe(1)
    expect(wire.totalRounds).toBe(3)
    expect(wire.currentDrawerId).toBe('drawer1')
    expect(wire.scores).toEqual({ drawer1: { score: 0, name: 'Drawer' } })
    if (wire.status === 'word-choice') {
      expect(wire.deadlineTime).toBe(choiceDeadline)
    }
  })

  it('playing state includes revealedHint when revealedPositions is non-empty', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['drawer', 'p2', 'p3'],
      scores: new Map([['drawer', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [0, 2],
    }
    const wire = gameStateToWire(state, false)
    expect(wire.status).toBe('playing')
    if (wire.status === 'playing') {
      expect(wire.revealedHint).toBe(buildHintString('cat', [0, 2]))
    }
  })

  it('playing state omits revealedHint when revealedPositions is empty', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['drawer', 'p2', 'p3'],
      scores: new Map([['drawer', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [],
    }
    const wire = gameStateToWire(state, false)
    expect(wire.status).toBe('playing')
    if (wire.status === 'playing') {
      expect(wire.revealedHint).toBeUndefined()
    }
  })

  it('playing state omits revealedHint for the drawer', () => {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['drawer', 'p2', 'p3'],
      scores: new Map([['drawer', { score: 0, name: 'Drawer' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2', 'p3']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [0, 2],
    }
    const wire = gameStateToWire(state, true)
    expect(wire.status).toBe('playing')
    if (wire.status === 'playing') {
      // Drawer should see the word but NOT the revealedHint
      expect(wire.currentWord).toBe('cat')
      expect(wire.revealedHint).toBeUndefined()
    }
  })
})

describe('type guards', () => {
  test('isLobbyState identifies lobby state', () => {
    const lobby = createInitialGameState()
    expect(isLobbyState(lobby)).toBe(true)

    const starting: StartingState = {
      ...lobby,
      status: 'starting',
      totalRounds: 3,
      drawerOrder: ['p1'],
    }
    expect(isLobbyState(starting)).toBe(false)
  })

  test('isStartingState identifies starting state', () => {
    const lobby = createInitialGameState()
    expect(isStartingState(lobby)).toBe(false)

    const starting: StartingState = {
      ...lobby,
      status: 'starting',
      totalRounds: 3,
      drawerOrder: ['p1'],
    }
    expect(isStartingState(starting)).toBe(true)
  })

  test('isGameOverState identifies game-over state', () => {
    const lobby = createInitialGameState()
    expect(isGameOverState(lobby)).toBe(false)

    const gameOver: GameOverState = {
      ...lobby,
      status: 'game-over',
      currentRound: 3,
      totalRounds: 3,
      roundStartTime: null,
      roundEndTime: null,
    }
    expect(isGameOverState(gameOver)).toBe(true)
  })

  test('isActiveGameState returns true for word-choice, playing and round-end, false for others', () => {
    const now = Date.now()
    const lobby = createInitialGameState()
    expect(isActiveGameState(lobby)).toBe(false)

    const playing: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'p1',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: now,
      roundEndTime: now + 60000,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([['p1', { score: 0, name: 'Player 1' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [],
    }
    expect(isActiveGameState(playing)).toBe(true)

    const roundEnd: RoundEndState = {
      ...playing,
      status: 'round-end',
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      nextTransitionAt: now + 5000,
    }
    expect(isActiveGameState(roundEnd)).toBe(true)

    const wordChoice: WordChoiceState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'p1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      endGameAfterCurrentRound: false,
      offeredWords: ['cat', 'dog', 'fish'],
      choiceDeadline: now + 15000,
      drawerOrder: ['p1', 'p2'],
      scores: new Map([['p1', { score: 0, name: 'Player 1' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['p2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map(),
    }
    expect(isActiveGameState(wordChoice)).toBe(true)

    const starting: StartingState = {
      ...lobby,
      status: 'starting',
      totalRounds: 3,
      drawerOrder: ['p1'],
    }
    expect(isActiveGameState(starting)).toBe(false)
  })
})

describe('WordChoiceState serialization', () => {
  it('round-trips through gameStateToStorage/gameStateFromStorage', () => {
    const choiceDeadline = Date.now() + 10_000
    const state: WordChoiceState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      endGameAfterCurrentRound: false,
      offeredWords: ['apple', 'banana', 'cherry'],
      choiceDeadline,
      drawerOrder: ['player1', 'player2'],
      scores: new Map([['player1', { score: 0, name: 'Alice' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['player2']),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map([['player2', 2]]),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)
    expect(restored.status).toBe('word-choice')
    expect((restored as WordChoiceState).currentDrawerId).toBe('player1')
    expect((restored as WordChoiceState).offeredWords).toEqual(['apple', 'banana', 'cherry'])
    expect((restored as WordChoiceState).choiceDeadline).toBe(choiceDeadline)
    expect(restored.consecutiveMissedRounds.get('player2')).toBe(2)
  })

  it('falls back to lobby when word-choice state has missing offeredWords', () => {
    const stored: StoredGameState = {
      status: 'word-choice',
      currentRound: 2,
      totalRounds: 3,
      currentDrawerId: 'player-1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: ['player-1', 'player-2'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundStartGuesserIds: [],
      roundGuesserScores: [],
      usedWords: [],
      // offeredWords intentionally omitted (simulates older storage)
    }
    const restored = gameStateFromStorage(stored)
    expect(restored.status).toBe('lobby')
  })
})

describe('PlayingState with revealedPositions', () => {
  it('serializes and restores revealedPositions', () => {
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: 'apple',
      wordLength: 5,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      revealedPositions: [1, 3],
      drawerOrder: ['player1'],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundStartGuesserIds: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['apple']),
      consecutiveMissedRounds: new Map(),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored) as PlayingState
    expect(restored.revealedPositions).toEqual([1, 3])
  })

  it('defaults revealedPositions to [] when absent from storage', () => {
    const stored: StoredGameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: 'apple',
      wordLength: 5,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      drawerOrder: ['player1'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundStartGuesserIds: [],
      roundGuesserScores: [],
      usedWords: ['apple'],
      // revealedPositions absent (old storage)
      // consecutiveMissedRounds absent (old storage)
    }
    const restored = gameStateFromStorage(stored) as PlayingState
    expect(restored.revealedPositions).toEqual([])
    expect(restored.consecutiveMissedRounds.size).toBe(0)
  })

  it('backfills roundStartGuesserIds from roundGuessers when absent in old storage', () => {
    const stored: StoredGameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer1',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      drawerOrder: ['drawer1', 'p2', 'p3'],
      scores: [
        ['drawer1', { score: 0, name: 'Drawer' }],
        ['p2', { score: 0, name: 'P2' }],
        ['p3', { score: 0, name: 'P3' }],
      ],
      correctGuessers: [],
      roundGuessers: ['p2', 'p3'],
      // roundStartGuesserIds is intentionally omitted (pre-schema storage)
      roundGuesserScores: [],
      usedWords: ['cat'],
    }
    const restored = gameStateFromStorage(stored) as PlayingState

    // Should fall back to roundGuessers so that endRound() correctly tracks
    // consecutiveMissedRounds for players who were present at round start.
    expect(restored.roundStartGuesserIds.has('p2')).toBe(true)
    expect(restored.roundStartGuesserIds.has('p3')).toBe(true)
    expect(restored.roundStartGuesserIds.size).toBe(2)
  })

  it('uses explicit roundStartGuesserIds when present in storage', () => {
    const stored: StoredGameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'drawer1',
      currentWord: 'cat',
      wordLength: 3,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      drawerOrder: ['drawer1', 'p2', 'p3'],
      scores: [],
      correctGuessers: [],
      roundGuessers: ['p2', 'p3'],
      roundStartGuesserIds: ['p2'], // Only p2 was present at round start (p3 joined late)
      roundGuesserScores: [],
      usedWords: ['cat'],
    }
    const restored = gameStateFromStorage(stored) as PlayingState

    expect(restored.roundStartGuesserIds.has('p2')).toBe(true)
    expect(restored.roundStartGuesserIds.has('p3')).toBe(false) // p3 was a late joiner
    expect(restored.roundStartGuesserIds.size).toBe(1)
  })
})
