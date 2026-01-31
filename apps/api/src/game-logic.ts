/**
 * Pure game logic functions for testability
 *
 * This module contains game logic extracted from DrawingRoom for unit testing.
 * All functions are pure and side-effect free.
 */

import {
  MIN_PLAYERS_TO_START,
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
  RATE_LIMIT_WINDOW,
} from './constants'
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
 * Calculate score for a correct guess based on time remaining
 *
 * @param roundEndTime - The timestamp when the round will end
 * @param currentTime - The current timestamp (defaults to Date.now())
 * @returns The calculated score (base score + time bonus up to 50%)
 */
export function calculateCorrectGuessScore(
  roundEndTime: number,
  currentTime: number = Date.now()
): number {
  const timeRemaining = Math.max(0, roundEndTime - currentTime)
  const timeRatio = timeRemaining / ROUND_DURATION_MS
  return Math.round(CORRECT_GUESS_BASE_SCORE * (1 + timeRatio * 0.5))
}

/**
 * State for tracking rate limiting
 */
export interface RateLimitState {
  timestamps: number[]
}

/**
 * Check if an action should be rate limited based on recent timestamps
 *
 * @param state - Current rate limit state
 * @param maxPerWindow - Maximum number of actions allowed in the window
 * @param windowMs - Time window in milliseconds
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Object with allowed status and updated state
 */
export function checkRateLimit(
  state: RateLimitState,
  maxPerWindow: number,
  windowMs: number,
  currentTime: number = Date.now()
): { allowed: boolean; updatedState: RateLimitState } {
  // Remove timestamps outside the window
  const cutoff = currentTime - windowMs
  const recentTimestamps = state.timestamps.filter((ts) => ts > cutoff)

  // Check if limit exceeded
  if (recentTimestamps.length >= maxPerWindow) {
    return {
      allowed: false,
      updatedState: { timestamps: recentTimestamps },
    }
  }

  // Allow and add new timestamp
  return {
    allowed: true,
    updatedState: { timestamps: [...recentTimestamps, currentTime] },
  }
}

/**
 * Check if a chat message should be rate limited
 *
 * @param state - Current rate limit state
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Object with allowed status and updated state
 */
export function checkMessageRateLimit(
  state: RateLimitState,
  currentTime?: number
): ReturnType<typeof checkRateLimit> {
  return checkRateLimit(state, MAX_MESSAGES_PER_WINDOW, RATE_LIMIT_WINDOW, currentTime)
}

/**
 * Check if a stroke should be rate limited
 *
 * @param state - Current rate limit state
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Object with allowed status and updated state
 */
export function checkStrokeRateLimit(
  state: RateLimitState,
  currentTime?: number
): ReturnType<typeof checkRateLimit> {
  return checkRateLimit(state, MAX_STROKES_PER_WINDOW, RATE_LIMIT_WINDOW, currentTime)
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
