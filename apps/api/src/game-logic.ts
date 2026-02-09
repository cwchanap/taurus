/**
 * Game logic functions for testability
 *
 * This module contains game logic extracted from DrawingRoom for unit testing.
 * All functions are pure and side-effect free, except clearTimers which mutates
 * its container argument in place for performance.
 */

import {
  MIN_PLAYERS_TO_START,
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
  RATE_LIMIT_WINDOW,
} from './constants'
import type { PlayingState, RoundEndState } from './game-types'
import { isPlayingState } from './game-types'

/**
 * Interface for object containing game timers
 */
export interface TimerContainer {
  roundTimer: ReturnType<typeof setTimeout> | null
  tickTimer: ReturnType<typeof setInterval> | null
  roundEndTimer: ReturnType<typeof setTimeout> | null
  gameEndTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Clears all game timers and resets them to null
 *
 * @param container - Object containing the timers
 */
export function clearTimers(container: TimerContainer) {
  if (container.roundTimer) clearTimeout(container.roundTimer)
  if (container.tickTimer) clearInterval(container.tickTimer)
  if (container.roundEndTimer) clearTimeout(container.roundEndTimer)
  if (container.gameEndTimer) clearTimeout(container.gameEndTimer)

  container.roundTimer = null
  container.tickTimer = null
  container.roundEndTimer = null
  container.gameEndTimer = null
}

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
  updatedGameState: PlayingState | RoundEndState

  /**
   * Index where the player was removed from drawerOrder (-1 if not in order)
   */
  removedFromDrawerIndex: number
}

/**
 * Check if a guess matches the target word (case-insensitive, trimmed)
 *
 * @param guess - The player's guessed word
 * @param word - The target word to match against
 * @returns true if the guess matches the word
 */
export function isCorrectGuess(guess: string, word: string): boolean {
  return guess.toLowerCase().trim() === word.toLowerCase().trim()
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
  const timeRatio = Math.min(1, Math.max(0, timeRemaining / ROUND_DURATION_MS))
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
  gameState: PlayingState | RoundEndState,
  remainingPlayerIds: string[]
): PlayerLeaveResult {
  // Clone the base fields
  const baseClone = {
    drawerOrder: [...gameState.drawerOrder],
    scores: new Map(gameState.scores),
    correctGuessers: new Set(gameState.correctGuessers),
    roundGuessers: new Set(gameState.roundGuessers),
    roundGuesserScores: new Map(gameState.roundGuesserScores),
    usedWords: new Set(gameState.usedWords),
  }

  // Remove from correct guessers and round guessers
  baseClone.correctGuessers.delete(leavingPlayerId)
  baseClone.roundGuessers.delete(leavingPlayerId)

  // Find the player's index in drawer order
  const removedIndex = baseClone.drawerOrder.indexOf(leavingPlayerId)

  // Track adjusted values
  let currentRound = gameState.currentRound
  let totalRounds = gameState.totalRounds

  // 1. Adjust drawer order if the player was in it
  if (removedIndex !== -1) {
    // If the player being removed has already drawn or is currently drawing,
    // we need to decrement currentRound so the next round points to the correct player
    if (removedIndex <= currentRound - 1) {
      currentRound = Math.max(1, currentRound - 1)
    }

    // Remove player from drawer order
    baseClone.drawerOrder.splice(removedIndex, 1)

    // Update total rounds to reflect the new player count
    totalRounds = Math.max(1, baseClone.drawerOrder.length)
  }

  // Build the updated state based on current status
  let updatedState: PlayingState | RoundEndState
  let shouldEndAfterRound = false

  // Check if we should end game after current round
  if (removedIndex !== -1 && currentRound >= totalRounds) {
    shouldEndAfterRound = true
  }

  if (isPlayingState(gameState)) {
    updatedState = {
      status: 'playing',
      currentRound,
      totalRounds,
      currentDrawerId: gameState.currentDrawerId,
      currentWord: gameState.currentWord,
      wordLength: gameState.wordLength,
      roundStartTime: gameState.roundStartTime,
      roundEndTime: gameState.roundEndTime,
      endGameAfterCurrentRound: shouldEndAfterRound || gameState.endGameAfterCurrentRound,
      ...baseClone,
    }
  } else {
    updatedState = {
      status: 'round-end',
      currentRound,
      totalRounds,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: gameState.roundStartTime,
      roundEndTime: gameState.roundEndTime,
      endGameAfterCurrentRound: shouldEndAfterRound || gameState.endGameAfterCurrentRound,
      ...baseClone,
    }
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

  if (isPlayingState(gameState) && leavingPlayerId === gameState.currentDrawerId) {
    // Current drawer left during active round -> end round immediately
    shouldEndRound = true
  }

  return {
    shouldEndGame: false,
    shouldEndRound,
    updatedGameState: updatedState,
    removedFromDrawerIndex: removedIndex,
  }
}

/**
 * Finds the next valid drawer starting from currentRound + 1
 *
 * @param currentRound The current round number
 * @param drawerOrder The ordered list of player IDs for drawing
 * @param connectedPlayers Set of currently connected player IDs
 * @returns Object containing the next drawerId (or null) and the new round number
 */
export function findNextDrawer(
  currentRound: number,
  drawerOrder: string[],
  connectedPlayers: Set<string>
): { drawerId: string | null; roundNumber: number } {
  // Start search from the NEXT round
  let nextRound = currentRound + 1

  while (nextRound <= drawerOrder.length) {
    const drawerIndex = nextRound - 1
    // Safety check for index
    if (drawerIndex < 0) {
      nextRound++
      continue
    }

    const candidateId = drawerOrder[drawerIndex]
    if (connectedPlayers.has(candidateId)) {
      return { drawerId: candidateId, roundNumber: nextRound }
    }
    nextRound++
  }

  return { drawerId: null, roundNumber: nextRound }
}
