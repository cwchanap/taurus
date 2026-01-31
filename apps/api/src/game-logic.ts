/**
 * Pure game logic functions for testability
 *
 * This module contains game logic extracted from DrawingRoom for unit testing.
 * All functions are pure and side-effect free.
 */

import { MIN_PLAYERS_TO_START } from './constants'
import type { GameState } from './game-types'

/**
 * Result of handling a player leave during an active game
 */
export interface PlayerLeaveResult {
  /**
   * Whether the game should end due to insufficient players
   */
  shouldEndGame: boolean

  /**
   * Whether the current round should end immediately (e.g., current drawer left)
   */
  shouldEndRound: boolean

  /**
   * The updated game state after handling the player leave
   */
  updatedGameState: GameState

  /**
   * Index where the player was removed from drawerOrder (-1 if not in order)
   */
  removedFromDrawerIndex: number
}

/**
 * Handle a player leaving during an active game (playing or round-end status)
 *
 * @param leavingPlayerId - The ID of the player who is leaving
 * @param gameState - The current game state (will be cloned, not mutated)
 * @param remainingPlayerIds - IDs of players who will remain after this player leaves
 * @returns Result indicating what actions to take and the updated game state
 */
export function handlePlayerLeaveInActiveGame(
  leavingPlayerId: string,
  gameState: GameState,
  remainingPlayerIds: string[]
): PlayerLeaveResult {
  // Clone the game state to avoid mutations
  const updatedState: GameState = {
    ...gameState,
    drawerOrder: [...gameState.drawerOrder],
    scores: new Map(gameState.scores),
    correctGuessers: new Set(gameState.correctGuessers),
    roundGuessers: new Set(gameState.roundGuessers),
    roundGuesserScores: new Map(gameState.roundGuesserScores),
    usedWords: new Set(gameState.usedWords),
  }

  // Remove from correct guessers and round guessers
  updatedState.correctGuessers.delete(leavingPlayerId)
  updatedState.roundGuessers.delete(leavingPlayerId)

  // Find the player's index in drawer order
  const removedIndex = updatedState.drawerOrder.indexOf(leavingPlayerId)

  // 1. Adjust drawer order if the player was in it
  if (removedIndex !== -1) {
    // If the player being removed has already drawn or is currently drawing,
    // we need to decrement currentRound so the next round points to the correct player
    if (removedIndex <= updatedState.currentRound - 1) {
      updatedState.currentRound = Math.max(0, updatedState.currentRound - 1)
    }

    // Remove player from drawer order
    updatedState.drawerOrder.splice(removedIndex, 1)

    // Update total rounds to reflect the new player count
    updatedState.totalRounds = Math.max(1, updatedState.drawerOrder.length)
  }

  // 2. Check if we have enough players to continue
  if (remainingPlayerIds.length < MIN_PLAYERS_TO_START) {
    return {
      shouldEndGame: true,
      shouldEndRound: false,
      updatedGameState: updatedState,
      removedFromDrawerIndex: removedIndex,
    }
  }

  // 3. Handle specific state interruptions
  let shouldEndRound = false

  if (updatedState.status === 'playing' && leavingPlayerId === gameState.currentDrawerId) {
    // Current drawer left during active round -> end round immediately
    shouldEndRound = true
  }

  // Check if we should end game after current round (regardless of whether round is ending now)
  if (removedIndex !== -1 && updatedState.currentRound >= updatedState.totalRounds) {
    // Edge case: if the last player in order left, set flag to end after this round
    updatedState.endGameAfterCurrentRound = true
  }

  return {
    shouldEndGame: false,
    shouldEndRound,
    updatedGameState: updatedState,
    removedFromDrawerIndex: removedIndex,
  }
}
