import { describe, expect, it, test } from 'bun:test'
import type { FillOperation, Stroke } from '@repo/types'
import {
  applyFill,
  handlePlayerLeaveInActiveGame,
  calculateCorrectGuessScore,
  checkRateLimit,
  checkMessageRateLimit,
  checkStrokeRateLimit,
  checkStrokeUpdateRateLimit,
  type RateLimitState,
  findNextDrawer,
  containsCurrentWord,
  undoFill,
  undoStroke,
  validateFillRequest,
  editDistance,
  isCloseGuess,
  buildHintString,
  pickNextRevealPositions,
} from './game-logic'
import {
  createInitialGameState,
  isPlayingState,
  type PlayingState,
  type RoundEndState,
} from './game-types'
import {
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  CATCH_UP_BONUS_PER_ROUND,
  MAX_CATCH_UP_BONUS,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
  MAX_STROKE_UPDATES_PER_WINDOW,
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
      endGameAfterCurrentRound: false,
      consecutiveMissedRounds: new Map(),
      revealedPositions: [],
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
      state.revealedPositions = [1, 4]
      const remainingPlayers = ['p1', 'p2'] // p3 leaving

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(false)
      expect(result.shouldEndRound).toBe(false)
      expect(result.removedFromDrawerIndex).toBe(2)
      expect(result.updatedGameState.drawerOrder).toEqual(['p1', 'p2'])
      expect(result.updatedGameState.totalRounds).toBe(2)
      expect(result.updatedGameState.currentRound).toBe(1) // Should not decrement
      expect(isPlayingState(result.updatedGameState)).toBe(true)
      if (!isPlayingState(result.updatedGameState)) throw new Error('Expected playing state')
      expect(result.updatedGameState.revealedPositions).toEqual([1, 4])
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

      // currentRound becomes 0 so findNextDrawer() advances to round 1 (first remaining drawer)
      expect(result.updatedGameState.currentRound).toBe(0)
      expect(result.updatedGameState.drawerOrder).toEqual(['p2', 'p3'])

      const nextDrawer = findNextDrawer(
        result.updatedGameState.currentRound,
        result.updatedGameState.drawerOrder,
        new Set(remainingPlayers)
      )
      expect(nextDrawer.drawerId).toBe('p2')
      expect(nextDrawer.roundNumber).toBe(1)
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
    const { score } = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.5))
  })

  test('no time remaining gives base score', () => {
    const roundEndTime = FIXED_NOW
    const { score } = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })

  test('half time remaining gives 125% base score', () => {
    const roundEndTime = FIXED_NOW + ROUND_DURATION_MS / 2
    const { score } = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.25))
  })

  test('time already expired gives base score', () => {
    const roundEndTime = FIXED_NOW - 1000
    const { score } = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })

  test('handles very large negative time difference', () => {
    const roundEndTime = FIXED_NOW - 999999
    const { score } = calculateCorrectGuessScore(roundEndTime, FIXED_NOW)
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

  describe('checkStrokeUpdateRateLimit', () => {
    test('uses MAX_STROKE_UPDATES_PER_WINDOW constant', () => {
      const state: RateLimitState = { timestamps: [] }
      const now = Date.now()

      // Fill up to limit
      let currentState = state
      for (let i = 0; i < MAX_STROKE_UPDATES_PER_WINDOW; i++) {
        const result = checkStrokeUpdateRateLimit(currentState, now + i)
        expect(result.allowed).toBe(true)
        currentState = result.updatedState
      }

      // Next one should be blocked
      const result = checkStrokeUpdateRateLimit(currentState, now + MAX_STROKE_UPDATES_PER_WINDOW)
      expect(result.allowed).toBe(false)
    })

    test('allows much higher rate than message rate limit', () => {
      const state: RateLimitState = { timestamps: [] }
      const now = Date.now()

      // Stroke updates should allow 600 per window vs 50 for messages
      let currentState = state
      for (let i = 0; i < MAX_MESSAGES_PER_WINDOW; i++) {
        const result = checkStrokeUpdateRateLimit(currentState, now + i)
        expect(result.allowed).toBe(true)
        currentState = result.updatedState
      }
      // Should still be allowed since stroke update limit is much higher
      const additionalResult = checkStrokeUpdateRateLimit(
        currentState,
        now + MAX_MESSAGES_PER_WINDOW
      )
      expect(additionalResult.allowed).toBe(true)
    })
  })
})

describe('drawing operation helpers', () => {
  const createPlayingState = (drawerId = 'drawer-1'): PlayingState => ({
    status: 'playing',
    currentRound: 1,
    totalRounds: 2,
    currentDrawerId: drawerId,
    currentWord: 'cat',
    wordLength: 3,
    roundStartTime: 100,
    roundEndTime: 60_100,
    drawerOrder: [drawerId, 'guesser-1'],
    scores: new Map([
      [drawerId, { score: 0, name: 'Drawer' }],
      ['guesser-1', { score: 0, name: 'Guesser' }],
    ]),
    correctGuessers: new Set(),
    roundGuessers: new Set(['guesser-1']),
    roundGuesserScores: new Map(),
    usedWords: new Set(),
    endGameAfterCurrentRound: false,
    consecutiveMissedRounds: new Map(),
    revealedPositions: [],
  })

  test('applyFill returns generated fill metadata and nonce echo event', () => {
    const result = applyFill(
      createPlayingState(),
      [],
      [],
      'drawer-1',
      { type: 'fill', x: 0.5, y: 0.5, color: '#FF6B6B', nonce: 'nonce-1' },
      { id: 'fill-1', timestamp: 1234, seq: 7 }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fills).toEqual([
        {
          id: 'fill-1',
          playerId: 'drawer-1',
          x: 0.5,
          y: 0.5,
          color: '#FF6B6B',
          timestamp: 1234,
          seq: 7,
        },
      ])
      expect(result.events).toEqual([
        {
          type: 'fill',
          fill: result.fills[0],
          nonce: 'nonce-1',
        },
      ])
      expect(result.nextOperationSeq).toBe(7)
    }
  })

  test('applyFill keeps invalid fill validation side-effect free', () => {
    const result = applyFill(
      createPlayingState(),
      [],
      [],
      'drawer-1',
      { type: 'fill', x: 100, y: 200, color: '#FF6B6B' },
      { id: 'fill-1', timestamp: 1234, seq: 7 }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.warning).toBe('Invalid fill data from player drawer-1')
      expect(result.clientError).toEqual({
        action: 'fill',
        message: 'Fill failed: invalid fill data',
      })
    }
  })

  test('undoStroke rejects when a newer fill exists for the same player', () => {
    const stroke: Stroke = {
      id: 'stroke-1',
      playerId: 'drawer-1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
      seq: 1,
    }
    const fill: FillOperation = {
      id: 'fill-1',
      playerId: 'drawer-1',
      x: 0.5,
      y: 0.5,
      color: '#FF6B6B',
      timestamp: 1001,
      seq: 2,
    }

    const result = undoStroke(createPlayingState(), [stroke], [fill], 'drawer-1', 'stroke-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.clientError).toEqual({
        action: 'undo-stroke',
        message: 'Undo failed: can only undo the most recent operation',
      })
    }
  })

  test('undoFill removes the most recent fill and emits a fill-removed event', () => {
    const fill: FillOperation = {
      id: 'fill-1',
      playerId: 'drawer-1',
      x: 0.5,
      y: 0.5,
      color: '#FF6B6B',
      timestamp: 1000,
      seq: 1,
    }

    const result = undoFill(createPlayingState(), [], [fill], 'drawer-1', 'fill-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fills).toEqual([])
      expect(result.storageWrites).toEqual(['fills'])
      expect(result.events).toEqual([{ type: 'fill-removed', fillId: 'fill-1' }])
    }
  })

  test('undoStroke returns an error when the game is not playing', () => {
    const result = undoStroke(createInitialGameState(), [], [], 'drawer-1', 'stroke-1')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.clientError).toEqual({
        action: 'undo-stroke',
        message: 'Undo failed: game is not in progress',
      })
    }
  })

  test('undoStroke rejects invalid stroke ids', () => {
    const stroke: Stroke = {
      id: 'stroke-1',
      playerId: 'drawer-1',
      points: [{ x: 1, y: 1 }],
      color: '#FF6B6B',
      size: 4,
      timestamp: 1000,
      seq: 1,
    }

    for (const invalidStrokeId of [null, '', '  ']) {
      const result = undoStroke(createPlayingState(), [stroke], [], 'drawer-1', invalidStrokeId)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.warning).toBe('Invalid strokeId in undo-stroke from player drawer-1')
        expect(result.clientError).toEqual({
          action: 'undo-stroke',
          message: 'Undo failed: invalid stroke ID',
        })
      }
    }
  })

  test('undoStroke removes the most recent stroke and emits a stroke-removed event', () => {
    const stroke: Stroke = {
      id: 'stroke-1',
      playerId: 'drawer-1',
      points: [{ x: 1, y: 1 }],
      color: '#FF6B6B',
      size: 4,
      timestamp: 1000,
      seq: 1,
    }

    const result = undoStroke(createPlayingState(), [stroke], [], 'drawer-1', 'stroke-1')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.strokes).toEqual([])
      expect(result.fills).toEqual([])
      expect(result.storageWrites).toEqual(['strokes'])
      expect(result.events).toEqual([{ type: 'stroke-removed', strokeId: 'stroke-1' }])
    }
  })

  test('undoFill rejects when the game is not playing, the player is not the drawer, or the id is invalid', () => {
    const fill: FillOperation = {
      id: 'fill-1',
      playerId: 'drawer-1',
      x: 0.5,
      y: 0.5,
      color: '#FF6B6B',
      timestamp: 1000,
      seq: 1,
    }

    const notPlaying = undoFill(createInitialGameState(), [], [fill], 'drawer-1', 'fill-1')
    expect(notPlaying.ok).toBe(false)
    if (!notPlaying.ok) {
      expect(notPlaying.clientError).toEqual({
        action: 'undo-fill',
        message: 'Undo failed: game is not in progress',
      })
    }

    const wrongPlayer = undoFill(createPlayingState(), [], [fill], 'guesser-1', 'fill-1')
    expect(wrongPlayer.ok).toBe(false)
    if (!wrongPlayer.ok) {
      expect(wrongPlayer.clientError).toEqual({
        action: 'undo-fill',
        message: 'Undo failed: only the current drawer can undo',
      })
    }

    const invalidId = undoFill(createPlayingState(), [], [fill], 'drawer-1', null)
    expect(invalidId.ok).toBe(false)
    if (!invalidId.ok) {
      expect(invalidId.warning).toBe('Invalid fillId in undo-fill from player drawer-1')
      expect(invalidId.clientError).toEqual({
        action: 'undo-fill',
        message: 'Undo failed: invalid fill ID',
      })
    }
  })

  test('validateFillRequest enforces playing-state drawer permissions', () => {
    expect(validateFillRequest(createInitialGameState(), 'drawer-1')).toEqual({
      ok: false,
      clientError: {
        action: 'fill',
        message: 'Fill failed: game is not in progress',
      },
    })

    expect(validateFillRequest(createPlayingState(), 'guesser-1')).toEqual({
      ok: false,
      clientError: {
        action: 'fill',
        message: 'Fill failed: only the current drawer can fill',
      },
    })

    expect(validateFillRequest(createPlayingState(), 'drawer-1')).toEqual({ ok: true })
  })
})

describe('findNextDrawer', () => {
  test('should recover from a negative current round index safely', () => {
    const result = findNextDrawer(-1, ['p1', 'p2'], new Set(['p1', 'p2']))

    expect(result).toEqual({ drawerId: 'p1', roundNumber: 1 })
  })

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

describe('containsCurrentWord', () => {
  test('detects exact match', () => {
    expect(containsCurrentWord('cat', 'cat')).toBe(true)
  })

  test('detects case-insensitive match', () => {
    expect(containsCurrentWord('I love CATS', 'cat')).toBe(true)
    expect(containsCurrentWord('CAT is great', 'cat')).toBe(true)
  })

  test('detects substring match', () => {
    expect(containsCurrentWord('the category is...', 'cat')).toBe(true)
    expect(containsCurrentWord('concatenate', 'cat')).toBe(true)
  })

  test('returns false when word is not contained', () => {
    expect(containsCurrentWord('dog', 'cat')).toBe(false)
    expect(containsCurrentWord('hello world', 'cat')).toBe(false)
  })

  test('handles empty strings', () => {
    expect(containsCurrentWord('', 'cat')).toBe(false)
    // Empty word should return false (guard against matching everything)
    expect(containsCurrentWord('cat', '')).toBe(false)
    expect(containsCurrentWord('any message', '')).toBe(false)
  })

  test('handles multi-word targets', () => {
    expect(containsCurrentWord('I love ice cream!', 'ice cream')).toBe(true)
    expect(containsCurrentWord('icecream', 'ice cream')).toBe(false)
  })
})

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('apple', 'apple')).toBe(0)
  })
  it('returns 1 for single substitution', () => {
    expect(editDistance('cat', 'bat')).toBe(1)
  })
  it('returns 1 for single insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1)
  })
  it('returns 1 for single deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1)
  })
  it('returns correct distance for multiple edits', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1)
    expect(editDistance('elephant', 'elfant')).toBe(3)
  })
  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
    expect(editDistance('', '')).toBe(0)
  })
})

describe('isCloseGuess', () => {
  it('matches near guesses within the short-word threshold', () => {
    expect(isCloseGuess(' appl ', 'apple')).toBe(true)
  })

  it('matches near guesses within the long-word threshold', () => {
    expect(isCloseGuess('elepant', 'elephant')).toBe(true)
  })

  it('rejects exact matches and guesses outside the threshold', () => {
    expect(isCloseGuess('apple', 'apple')).toBe(false)
    expect(isCloseGuess('dog', 'elephant')).toBe(false)
  })

  it('is close for 5-char word with edit distance exactly 1 (threshold 1)', () => {
    expect(isCloseGuess('heard', 'heart')).toBe(true)
    expect(isCloseGuess('hears', 'heart')).toBe(true)
  })

  it('is NOT close for 5-char word with edit distance 2 (above threshold 1)', () => {
    expect(isCloseGuess('board', 'heart')).toBe(false)
  })

  it('is close for 6-char word with edit distance exactly 2 (threshold 2)', () => {
    expect(isCloseGuess('brldge', 'bridge')).toBe(true)
  })

  it('is NOT close for 6-char word with edit distance 3 (above threshold 2)', () => {
    expect(isCloseGuess('xxxxxx', 'bridge')).toBe(false)
  })
})

describe('buildHintString', () => {
  it('masks all letters with no revealed positions', () => {
    expect(buildHintString('apple', [])).toBe('_ _ _ _ _')
  })
  it('reveals letters at specified positions', () => {
    expect(buildHintString('apple', [1, 4])).toBe('_ p _ _ e')
  })
  it('always shows spaces', () => {
    expect(buildHintString('hot dog', [])).toBe('_ _ _   _ _ _')
  })
  it('always shows hyphens', () => {
    expect(buildHintString('t-rex', [])).toBe('_ - _ _ _')
  })
})

describe('pickNextRevealPositions', () => {
  it('returns at least 1 position', () => {
    const result = pickNextRevealPositions('hi', [], 0.25)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
  it('does not duplicate existing positions', () => {
    const result = pickNextRevealPositions('apple', [0], 0.5)
    const unique = new Set(result)
    expect(unique.size).toBe(result.length)
  })
  it('does not reveal more than targetFraction', () => {
    const result = pickNextRevealPositions('apple', [], 0.25)
    expect(result.length).toBeLessThanOrEqual(2) // ceil(5 * 0.25) = 2
  })
  it('skips spaces when counting maskable chars', () => {
    // "hot dog" has 6 maskable chars (spaces excluded)
    const result = pickNextRevealPositions('hot dog', [], 0.5)
    expect(result.length).toBe(3) // ceil(6 * 0.5) = 3
  })

  it('returns existing unchanged when already at or above targetCount', () => {
    // 'apple' has 5 maskable chars; targetFraction 0.25 → targetCount = ceil(5*0.25) = 2
    // existing already has 2 positions → no new positions should be added
    const existing = [0, 2]
    const result = pickNextRevealPositions('apple', existing, 0.25)
    expect(result).toEqual(existing)
    expect(result.length).toBe(2)
  })
})

describe('calculateCorrectGuessScore with missedRounds', () => {
  const FIXED_NOW = 1700000000000
  const FIXED_END = FIXED_NOW + 30000

  it('catchUpBonus is 0 when missedRounds is 0', () => {
    const { catchUpBonus } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 0)
    expect(catchUpBonus).toBe(0)
  })

  it('catchUpBonus is missedRounds * CATCH_UP_BONUS_PER_ROUND when under cap', () => {
    const { catchUpBonus } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 3)
    expect(catchUpBonus).toBe(3 * CATCH_UP_BONUS_PER_ROUND)
  })

  it('catchUpBonus is capped at MAX_CATCH_UP_BONUS (50)', () => {
    const { catchUpBonus: bonus10 } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 10)
    const { catchUpBonus: bonus5 } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 5)
    expect(bonus10).toBe(MAX_CATCH_UP_BONUS)
    expect(bonus5).toBe(MAX_CATCH_UP_BONUS)
  })

  it('total score includes catchUpBonus', () => {
    const { score, catchUpBonus } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 3)
    const { score: baseOnly } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW, 0)
    expect(score - baseOnly).toBe(catchUpBonus)
  })

  it('catchUpBonus defaults to 0 when missedRounds not provided', () => {
    const { catchUpBonus } = calculateCorrectGuessScore(FIXED_END, FIXED_NOW)
    expect(catchUpBonus).toBe(0)
  })
})
