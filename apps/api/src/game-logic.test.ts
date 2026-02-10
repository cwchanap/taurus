import { describe, expect, test } from 'bun:test'
import {
  handlePlayerLeaveInActiveGame,
  calculateCorrectGuessScore,
  checkRateLimit,
  checkMessageRateLimit,
  checkStrokeRateLimit,
  type RateLimitState,
  findNextDrawer,
} from './game-logic'
import { type PlayingState, type RoundEndState } from './game-types'
import {
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
} from './constants'

describe('handlePlayerLeaveInActiveGame', () => {
  // Helper to create a basic playing game state
  function createPlayingGameState(
    playerIds: string[],
    currentRoundIndex: number = 0
  ): PlayingState {
    const now = Date.now()
    const state: PlayingState = {
      status: 'playing',
      drawerOrder: [...playerIds],
      totalRounds: playerIds.length,
      currentRound: currentRoundIndex + 1, // currentRound is 1-indexed
      currentDrawerId: playerIds[currentRoundIndex],
      currentWord: 'testword',
      wordLength: 8,
      roundStartTime: now,
      roundEndTime: now + 60000,
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(playerIds.filter((id) => id !== playerIds[currentRoundIndex])),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
    }

    // Initialize scores for all players
    for (const id of playerIds) {
      state.scores.set(id, { score: 0, name: `Player ${id}` })
    }

    return state
  }

  describe('when player leaving is not in drawer order (late joiner)', () => {
    test('should not affect drawer order or round count', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0)
      const remainingPlayers = ['p1', 'p2', 'p3'] // p4 was late joiner, now leaving

      const result = handlePlayerLeaveInActiveGame('p4', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.removedFromDrawerIndex).toBe(-1)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2', 'p3'])
      expect(result.updatedGameState.totalRounds).toBe(3)
      expect(result.updatedGameState.currentRound).toBe(1)
      expect(result.updatedGameState.correctGuessers.has('p4')).toBe(false)
      expect(result.updatedGameState.roundGuessers.has('p4')).toBe(false)
    })
  })

  describe('when non-drawer participant leaves', () => {
    test('should end game if remaining players < MIN_PLAYERS_TO_START', () => {
      const state = createPlayingGameState(['p1', 'p2'], 0)
      const remainingPlayers = ['p1'] // Only 1 player left after p2 leaves

      const result = handlePlayerLeaveInActiveGame('p2', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(true)
      expect(result.shouldEndRound).toBe(false)
    })

    test('should remove player from drawer order and adjust rounds', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0)
      const remainingPlayers = ['p1', 'p2'] // p3 leaving

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.removedFromDrawerIndex).toBe(2)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      expect(result.updatedGameState.currentRound).toBe(1) // Should not decrement
      expect(result.updatedGameState.correctGuessers.has('p3')).toBe(false)
      expect(result.updatedGameState.roundGuessers.has('p3')).toBe(false)
    })

    test('should decrement currentRound when player who already drew leaves', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3', 'p4'], 2) // p3 is current drawer
      const remainingPlayers = ['p2', 'p3', 'p4'] // p1 leaving (already drew)

      const result = handlePlayerLeaveInActiveGame('p1', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.removedFromDrawerIndex).toBe(0)
      expect(result.updatedGameState.drawerOrder).toEqual(['p2', 'p3', 'p4'])
      expect(result.updatedGameState.totalRounds).toBe(3)
      expect(result.updatedGameState.currentRound).toBe(2) // Decremented from 3 to 2
    })

    test('should end game when only one player remains after non-drawer leaves', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0)
      const remainingPlayers = ['p1'] // Only 1 player left

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(true)
      expect(result.shouldEndRound).toBe(false)
    })
  })

  describe('when current drawer leaves', () => {
    test('should decrement currentRound to 0 when first drawer leaves in round 1', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0) // p1 is current drawer (round 1)
      const remainingPlayers = ['p2', 'p3'] // p1 leaving (first drawer)

      const result = handlePlayerLeaveInActiveGame('p1', state, remainingPlayers)

      // currentRound should be 0, not 1, so findNextDrawer starts from round 1 (index 0 = p2)
      expect(result.updatedGameState.currentRound).toBe(0)
      expect(result.updatedGameState.drawerOrder).toEqual(['p2', 'p3'])
    })

    test('should end round immediately', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 1) // p2 is current drawer
      const remainingPlayers = ['p1', 'p3'] // p2 leaving

      const result = handlePlayerLeaveInActiveGame('p2', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(true)
      expect(result.removedFromDrawerIndex).toBe(1)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p3'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      expect(result.updatedGameState.currentRound).toBe(1) // Decremented from 2 to 1
    })

    test('should end game if remaining players < MIN_PLAYERS_TO_START', () => {
      const state = createPlayingGameState(['p1', 'p2'], 0) // p1 is current drawer
      const remainingPlayers = ['p2'] // Only 1 player left

      const result = handlePlayerLeaveInActiveGame('p1', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(true)
      expect(result.shouldEndRound).toBe(false) // shouldEndGame takes precedence
    })
  })

  describe('when last player in order leaves', () => {
    test('should set endGameAfterCurrentRound flag when removal causes currentRound >= totalRounds', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 2) // p3 is current drawer (round 3)
      const remainingPlayers = ['p1', 'p2'] // p3 leaving (last in order, currently drawing)

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      // Current drawer leaving should end the round
      expect(result.shouldEndRound).toBe(true)
      expect(result.shouldEndGame).toBe(false)
      expect(result.removedFromDrawerIndex).toBe(2)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      // currentRound decremented from 3 to 2 because player at index 2 left and 2 <= 3-1
      expect(result.updatedGameState.currentRound).toBe(2)
      // After decrement: currentRound (2) >= totalRounds (2), so flag should be set
      expect(result.updatedGameState.endGameAfterCurrentRound).toBe(true)
    })

    test('should not set flag when last player leaves but game continues normally', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0) // p1 is current drawer
      const remainingPlayers = ['p1', 'p2'] // p3 leaving (last in order)

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      expect(result.updatedGameState.currentRound).toBe(1)
      // currentRound (1) < totalRounds (2), so flag not needed (game ends naturally)
      expect(result.updatedGameState.endGameAfterCurrentRound).toBeFalsy()
    })
  })

  describe('when player leaves during round-end status', () => {
    test('should handle same as during playing status', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 1) as unknown as RoundEndState
      state.status = 'round-end'
      state.currentDrawerId = null
      state.currentWord = null
      const remainingPlayers = ['p1', 'p2'] // p3 leaving

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      expect(result.updatedGameState.correctGuessers.has('p3')).toBe(false)
    })
  })
})

describe('calculateCorrectGuessScore', () => {
  const FIXED_NOW = 1700000000000

  test('full time remaining gives 150% base score', () => {
    const roundEndTime = FIXED_NOW + ROUND_DURATION_MS
    const score = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.5))
  })

  test('no time remaining gives base score', () => {
    const roundEndTime = FIXED_NOW
    const score = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })

  test('half time remaining gives 125% base score', () => {
    const roundEndTime = FIXED_NOW + ROUND_DURATION_MS / 2
    const score = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.25))
  })

  test('time already expired gives base score', () => {
    const roundEndTime = FIXED_NOW - 1000
    const score = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })

  test('handles very large negative time difference', () => {
    const roundEndTime = FIXED_NOW - 999999
    const score = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
    expect(Number.isFinite(score)).toBe(true)
  })
})

describe('Rate Limiting', () => {
  describe('checkRateLimit', () => {
    test('allows first message within window', () => {
      const state: RateLimitState = { timestamps: [] }
      const result = checkRateLimit(state, 5, 10000, 1000)

      expect(result.allowed).toBe(true)
      expect(result.updatedState.timestamps).toEqual([1000])
    })

    test('allows up to max messages within window', () => {
      const now = Date.now()
      const state: RateLimitState = {
        timestamps: [now - 500, now - 400, now - 300, now - 200],
      }
      const result = checkRateLimit(state, 5, 10000, now)

      expect(result.allowed).toBe(true)
      expect(result.updatedState.timestamps).toHaveLength(5)
    })

    test('blocks when max messages reached', () => {
      const now = Date.now()
      const state: RateLimitState = {
        timestamps: [now - 500, now - 400, now - 300, now - 200, now - 100],
      }
      const result = checkRateLimit(state, 5, 10000, now)

      expect(result.allowed).toBe(false)
      expect(result.updatedState.timestamps).toHaveLength(5)
    })

    test('allows message after window expires', () => {
      const now = Date.now()
      const state: RateLimitState = {
        timestamps: [
          now - 11000, // Outside 10s window
          now - 10500, // Outside window
          now - 500,
          now - 400,
          now - 300,
        ],
      }
      const result = checkRateLimit(state, 5, 10000, now)

      expect(result.allowed).toBe(true)
      // Should have removed old timestamps + added new one
      expect(result.updatedState.timestamps).toHaveLength(4)
    })

    test('cleans up old timestamps when blocking', () => {
      const now = Date.now()
      const state: RateLimitState = {
        timestamps: [
          now - 11000, // Should be removed
          now - 500,
          now - 400,
          now - 300,
          now - 200,
          now - 100,
        ],
      }
      const result = checkRateLimit(state, 5, 10000, now)

      expect(result.allowed).toBe(false)
      // Old timestamp should be cleaned
      expect(result.updatedState.timestamps).toHaveLength(5)
      expect(result.updatedState.timestamps[0]).toBeGreaterThan(now - 10000)
    })
  })

  describe('checkMessageRateLimit', () => {
    test('uses MAX_MESSAGES_PER_WINDOW constant', () => {
      const state: RateLimitState = { timestamps: [] }
      const now = Date.now()

      // Fill up to limit
      let currentState = state
      for (let i = 0; i < MAX_MESSAGES_PER_WINDOW; i++) {
        const result = checkMessageRateLimit(currentState, now + i)
        expect(result.allowed).toBe(true)
        currentState = result.updatedState
      }

      // Next one should be blocked
      const result = checkMessageRateLimit(currentState, now + MAX_MESSAGES_PER_WINDOW)
      expect(result.allowed).toBe(false)
    })
  })

  describe('checkStrokeRateLimit', () => {
    test('uses MAX_STROKES_PER_WINDOW constant', () => {
      const state: RateLimitState = { timestamps: [] }
      const now = Date.now()

      // Fill up to limit
      let currentState = state
      for (let i = 0; i < MAX_STROKES_PER_WINDOW; i++) {
        const result = checkStrokeRateLimit(currentState, now + i)
        expect(result.allowed).toBe(true)
        currentState = result.updatedState
      }

      // Next one should be blocked
      const result = checkStrokeRateLimit(currentState, now + MAX_STROKES_PER_WINDOW)
      expect(result.allowed).toBe(false)
    })
  })
})

describe('findNextDrawer', () => {
  test('should advance to next round and drawer', () => {
    const currentRound = 0
    const drawerOrder = ['p1', 'p2', 'p3']
    const connectedPlayers = new Set(['p1', 'p2', 'p3'])

    const result = findNextDrawer(currentRound, drawerOrder, connectedPlayers)

    expect(result.roundNumber).toBe(1)
    expect(result.drawerId).toBe('p1')
  })

  test('should skip disconnected players', () => {
    const currentRound = 1
    const drawerOrder = ['p1', 'p2', 'p3']
    const connectedPlayers = new Set(['p1', 'p3']) // p2 is disconnected

    const result = findNextDrawer(currentRound, drawerOrder, connectedPlayers)

    // Should skip p2 (round 2) and go to p3 (round 3)
    expect(result.roundNumber).toBe(3)
    expect(result.drawerId).toBe('p3')
  })

  test('should return null if no more drawers available', () => {
    const currentRound = 3
    const drawerOrder = ['p1', 'p2', 'p3']
    const connectedPlayers = new Set(['p1', 'p2', 'p3'])

    const result = findNextDrawer(currentRound, drawerOrder, connectedPlayers)

    expect(result.drawerId).toBeNull()
    expect(result.roundNumber).toBeGreaterThan(3)
  })

  test('should correctly handle transition from round 1 to round 2', () => {
    const currentRound = 1
    const drawerOrder = ['p1', 'p2', 'p3']
    const connectedPlayers = new Set(['p1', 'p2', 'p3'])

    const result = findNextDrawer(currentRound, drawerOrder, connectedPlayers)

    expect(result.roundNumber).toBe(2)
    expect(result.drawerId).toBe('p2')
  })
})
