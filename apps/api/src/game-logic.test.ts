import { describe, expect, test } from 'bun:test'
import { handlePlayerLeaveInActiveGame } from './game-logic'
import { createInitialGameState, type GameState } from './game-types'

describe('handlePlayerLeaveInActiveGame', () => {
  // Helper to create a basic playing game state
  function createPlayingGameState(playerIds: string[], currentRoundIndex: number = 0): GameState {
    const state = createInitialGameState()
    state.status = 'playing'
    state.drawerOrder = [...playerIds]
    state.totalRounds = playerIds.length
    state.currentRound = currentRoundIndex + 1 // currentRound is 1-indexed
    state.currentDrawerId = playerIds[currentRoundIndex]
    state.currentWord = 'testword'
    state.wordLength = 8
    state.roundStartTime = Date.now()
    state.roundEndTime = Date.now() + 60000

    // Initialize scores for all players
    for (const id of playerIds) {
      state.scores.set(id, { score: 0, name: `Player ${id}` })
    }

    // Initialize round guessers (everyone except current drawer)
    state.roundGuessers = new Set(playerIds.filter((id) => id !== playerIds[currentRoundIndex]))

    return state
  }

  describe('when player leaving is not in drawer order (late joiner)', () => {
    test('should not affect drawer order or round count', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0)
      const remainingPlayers = ['p1', 'p2', 'p3', 'p4'] // p4 is late joiner

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

    test('should end game if remaining players < MIN_PLAYERS_TO_START', () => {
      const state = createPlayingGameState(['p1', 'p2'], 0)
      const remainingPlayers = ['p1'] // Only 1 player left (p2 is the late joiner leaving)

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(true)
      expect(result.shouldEndRound).toBe(false)
    })
  })

  describe('when non-drawer participant leaves', () => {
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

    test('should end game if remaining players < MIN_PLAYERS_TO_START', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 0)
      const remainingPlayers = ['p1'] // Only 1 player left

      const result = handlePlayerLeaveInActiveGame('p3', state, remainingPlayers)

      expect(result.shouldEndGame).toBe(true)
      expect(result.shouldEndRound).toBe(false)
    })
  })

  describe('when current drawer leaves', () => {
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
      expect(result.updatedGameState.endGameAfterCurrentRound).toBe(false)
    })
  })

  describe('when player leaves during round-end status', () => {
    test('should handle same as during playing status', () => {
      const state = createPlayingGameState(['p1', 'p2', 'p3'], 1)
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
