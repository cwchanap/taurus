/**
 * Game logic functions for testability
 *
 * This module contains game logic extracted from DrawingRoom for unit testing.
 * Functions are side-effect free (except clearTimers which mutates its argument).
 * Some accept an optional `currentTime` parameter that defaults to `Date.now()`.
 */

import {
  MIN_PLAYERS_TO_START,
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
  MAX_STROKE_UPDATES_PER_WINDOW,
  RATE_LIMIT_WINDOW,
  CATCH_UP_BONUS_PER_ROUND,
  MAX_CATCH_UP_BONUS,
} from './constants'
import type { FillOperation, Stroke } from '@repo/types'
import type { GameState, PlayingState, RoundEndState } from './game-types'
import { isPlayingState } from './game-types'
import { isValidDrawingId, validateFill } from './validation'

/**
 * Interface for object containing game timers
 */
export interface TimerContainer {
  roundTimer: ReturnType<typeof setTimeout> | null
  tickTimer: ReturnType<typeof setInterval> | null
  roundEndTimer: ReturnType<typeof setTimeout> | null
  gameEndTimer: ReturnType<typeof setTimeout> | null
  wordChoiceTimer: ReturnType<typeof setTimeout> | null
  hintTimer1: ReturnType<typeof setTimeout> | null
  hintTimer2: ReturnType<typeof setTimeout> | null
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
  if (container.wordChoiceTimer) clearTimeout(container.wordChoiceTimer)
  if (container.hintTimer1) clearTimeout(container.hintTimer1)
  if (container.hintTimer2) clearTimeout(container.hintTimer2)

  container.roundTimer = null
  container.tickTimer = null
  container.roundEndTimer = null
  container.gameEndTimer = null
  container.wordChoiceTimer = null
  container.hintTimer1 = null
  container.hintTimer2 = null
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
 * Check if a message contains the current word as a substring (case-insensitive).
 * Used for suppressing messages that might leak the answer.
 *
 * @param message - The chat message to check
 * @param word - The current word to match against
 * @returns true if the message contains the word
 */
export function containsCurrentWord(message: string, word: string): boolean {
  // Guard against empty or whitespace-only word - "".includes("") is true, which would match everything
  if (word === '' || word.trim() === '') {
    return false
  }
  return message.toLowerCase().includes(word.toLowerCase())
}

/**
 * Check whether a guess is close enough to the target word to warrant "So close!" feedback.
 *
 * The comparison is case-insensitive and trims surrounding whitespace before applying
 * a small edit-distance threshold that scales with word length.
 */
export function isCloseGuess(candidate: string, targetWord: string): boolean {
  const normalizedCandidate = candidate.toLowerCase().trim()
  const normalizedTarget = targetWord.toLowerCase().trim()
  const threshold = normalizedTarget.length <= 5 ? 1 : 2

  return (
    normalizedCandidate !== normalizedTarget &&
    editDistance(normalizedCandidate, normalizedTarget) <= threshold
  )
}

/**
 * Calculate score for a correct guess based on time remaining
 *
 * @param roundEndTime - The timestamp when the round will end
 * @param currentTime - The current timestamp (defaults to Date.now())
 * @param missedRounds - Number of rounds the player missed (for catch-up bonus)
 * @returns The calculated score: 100 (base) to 150 (with full time bonus), plus catch-up bonus
 */
export function calculateCorrectGuessScore(
  roundEndTime: number,
  currentTime: number = Date.now(),
  missedRounds = 0
): { score: number; catchUpBonus: number } {
  const timeRemaining = Math.max(0, roundEndTime - currentTime)
  const timeRatio = Math.min(1, Math.max(0, timeRemaining / ROUND_DURATION_MS))
  const baseScore = Math.round(CORRECT_GUESS_BASE_SCORE * (1 + timeRatio * 0.5))
  const catchUpBonus = Math.min(missedRounds * CATCH_UP_BONUS_PER_ROUND, MAX_CATCH_UP_BONUS)
  return { score: baseScore + catchUpBonus, catchUpBonus }
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
 * Check if a stroke update should be rate limited
 *
 * Stroke updates happen much more frequently than new strokes (30-60 per second during active drawing),
 * so this uses a much higher rate limit.
 *
 * @param state - Current rate limit state
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Object with allowed status and updated state
 */
export function checkStrokeUpdateRateLimit(
  state: RateLimitState,
  currentTime?: number
): ReturnType<typeof checkRateLimit> {
  return checkRateLimit(state, MAX_STROKE_UPDATES_PER_WINDOW, RATE_LIMIT_WINDOW, currentTime)
}

type DrawingAction = 'fill' | 'undo-stroke' | 'undo-fill'

type DrawingClientError<Action extends DrawingAction> = {
  action: Action
  message: string
}

type DrawingLogicFailure<Action extends DrawingAction> = {
  ok: false
  warning?: string
  clientError?: DrawingClientError<Action>
}

type DrawingLogicEvent =
  | { type: 'stroke-removed'; strokeId: string }
  | { type: 'fill-removed'; fillId: string }
  | { type: 'fill'; fill: FillOperation; nonce?: string }

type DrawingStorageWriteKind = 'strokes' | 'fills'

type DrawingLogicSuccess = {
  ok: true
  strokes: Stroke[]
  fills: FillOperation[]
  storageWrites: DrawingStorageWriteKind[]
  events: DrawingLogicEvent[]
}

export type UndoStrokeResult = DrawingLogicSuccess | DrawingLogicFailure<'undo-stroke'>
export type UndoFillResult = DrawingLogicSuccess | DrawingLogicFailure<'undo-fill'>
export type ValidateFillRequestResult = { ok: true } | DrawingLogicFailure<'fill'>
export type ApplyFillResult =
  | (DrawingLogicSuccess & { nextOperationSeq: number })
  | DrawingLogicFailure<'fill'>

type GeneratedFillMetadata = {
  id: string
  timestamp: number
  seq: number
}

function getOperationOrder(operation: Pick<Stroke | FillOperation, 'timestamp' | 'seq'>): number {
  return operation.seq ?? operation.timestamp
}

function buildClientError<Action extends DrawingAction>(
  action: Action,
  message: string
): DrawingClientError<Action> {
  return { action, message }
}

export function undoStroke(
  gameState: GameState,
  strokes: Stroke[],
  fills: FillOperation[],
  playerId: string,
  strokeId: unknown
): UndoStrokeResult {
  if (!isPlayingState(gameState)) {
    return {
      ok: false,
      clientError: buildClientError('undo-stroke', 'Undo failed: game is not in progress'),
    }
  }

  if (playerId !== gameState.currentDrawerId) {
    return {
      ok: false,
      clientError: buildClientError('undo-stroke', 'Undo failed: only the current drawer can undo'),
    }
  }

  if (!isValidDrawingId(strokeId)) {
    return {
      ok: false,
      warning: `Invalid strokeId in undo-stroke from player ${playerId}`,
      clientError: buildClientError('undo-stroke', 'Undo failed: invalid stroke ID'),
    }
  }

  const trimmedId = strokeId.trim()
  const idx = strokes.findLastIndex(
    (stroke) => stroke.id === trimmedId && stroke.playerId === playerId
  )
  if (idx === -1) {
    return {
      ok: false,
      warning: `Stroke ${trimmedId} not found for undo by player ${playerId}`,
      clientError: buildClientError(
        'undo-stroke',
        'Undo failed: stroke not found. Canvas may be out of sync.'
      ),
    }
  }

  const mostRecentStrokeIdx = strokes.findLastIndex((stroke) => stroke.playerId === playerId)
  const strokeToUndo = strokes[idx]
  const mostRecentFill = fills.findLast((fill) => fill.playerId === playerId)
  const hasNewerFill =
    mostRecentFill !== undefined &&
    getOperationOrder(mostRecentFill) >= getOperationOrder(strokeToUndo)

  if (idx !== mostRecentStrokeIdx || hasNewerFill) {
    return {
      ok: false,
      warning: `Attempted to undo non-most-recent stroke ${trimmedId} by player ${playerId} (most recent stroke index: ${mostRecentStrokeIdx}, requested index: ${idx}, has newer fill: ${hasNewerFill})`,
      clientError: buildClientError(
        'undo-stroke',
        'Undo failed: can only undo the most recent operation'
      ),
    }
  }

  return {
    ok: true,
    strokes: [...strokes.slice(0, idx), ...strokes.slice(idx + 1)],
    fills,
    storageWrites: ['strokes'],
    events: [{ type: 'stroke-removed', strokeId: trimmedId }],
  }
}

export function undoFill(
  gameState: GameState,
  strokes: Stroke[],
  fills: FillOperation[],
  playerId: string,
  fillId: unknown
): UndoFillResult {
  if (!isPlayingState(gameState)) {
    return {
      ok: false,
      clientError: buildClientError('undo-fill', 'Undo failed: game is not in progress'),
    }
  }

  if (playerId !== gameState.currentDrawerId) {
    return {
      ok: false,
      clientError: buildClientError('undo-fill', 'Undo failed: only the current drawer can undo'),
    }
  }

  if (!isValidDrawingId(fillId)) {
    return {
      ok: false,
      warning: `Invalid fillId in undo-fill from player ${playerId}`,
      clientError: buildClientError('undo-fill', 'Undo failed: invalid fill ID'),
    }
  }

  const trimmedId = fillId.trim()
  const idx = fills.findLastIndex((fill) => fill.id === trimmedId && fill.playerId === playerId)
  if (idx === -1) {
    return {
      ok: false,
      warning: `Fill ${trimmedId} not found for undo by player ${playerId}`,
      clientError: buildClientError(
        'undo-fill',
        'Undo failed: fill not found. Canvas may be out of sync.'
      ),
    }
  }

  const mostRecentFillIdx = fills.findLastIndex((fill) => fill.playerId === playerId)
  const fillToUndo = fills[idx]
  const mostRecentStroke = strokes.findLast((stroke) => stroke.playerId === playerId)
  const hasNewerStroke =
    mostRecentStroke !== undefined &&
    getOperationOrder(mostRecentStroke) >= getOperationOrder(fillToUndo)

  if (idx !== mostRecentFillIdx || hasNewerStroke) {
    return {
      ok: false,
      warning: `Attempted to undo non-most-recent fill ${trimmedId} by player ${playerId} (most recent fill index: ${mostRecentFillIdx}, requested index: ${idx}, has newer stroke: ${hasNewerStroke})`,
      clientError: buildClientError(
        'undo-fill',
        'Undo failed: can only undo the most recent operation'
      ),
    }
  }

  return {
    ok: true,
    strokes,
    fills: [...fills.slice(0, idx), ...fills.slice(idx + 1)],
    storageWrites: ['fills'],
    events: [{ type: 'fill-removed', fillId: trimmedId }],
  }
}

export function validateFillRequest(
  gameState: GameState,
  playerId: string
): ValidateFillRequestResult {
  if (!isPlayingState(gameState)) {
    return {
      ok: false,
      clientError: buildClientError('fill', 'Fill failed: game is not in progress'),
    }
  }

  if (playerId !== gameState.currentDrawerId) {
    return {
      ok: false,
      clientError: buildClientError('fill', 'Fill failed: only the current drawer can fill'),
    }
  }

  return { ok: true }
}

export function applyFill(
  gameState: GameState,
  strokes: Stroke[],
  fills: FillOperation[],
  playerId: string,
  fillData: unknown,
  generatedFill: GeneratedFillMetadata
): ApplyFillResult {
  void gameState
  void strokes

  const validated = validateFill(fillData)
  if (!validated) {
    return {
      ok: false,
      warning: `Invalid fill data from player ${playerId}`,
      clientError: buildClientError('fill', 'Fill failed: invalid fill data'),
    }
  }

  const nonce =
    typeof fillData === 'object' &&
    fillData !== null &&
    typeof (fillData as { nonce?: unknown }).nonce === 'string' &&
    (fillData as { nonce: string }).nonce.length <= 36
      ? (fillData as { nonce: string }).nonce
      : undefined

  const fill: FillOperation = {
    id: generatedFill.id,
    playerId,
    x: validated.x,
    y: validated.y,
    color: validated.color,
    timestamp: generatedFill.timestamp,
    seq: generatedFill.seq,
  }

  return {
    ok: true,
    strokes,
    fills: [...fills, fill],
    storageWrites: ['fills'],
    events: [{ type: 'fill', fill, ...(nonce ? { nonce } : {}) }],
    nextOperationSeq: generatedFill.seq,
  }
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
    consecutiveMissedRounds: new Map(gameState.consecutiveMissedRounds),
  }

  // Remove from correct guessers, round guessers, and round guesser scores
  baseClone.correctGuessers.delete(leavingPlayerId)
  baseClone.roundGuessers.delete(leavingPlayerId)
  baseClone.roundGuesserScores.delete(leavingPlayerId)

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
      currentRound = Math.max(0, currentRound - 1)
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

  // Check if the current drawer is leaving - this triggers a transition to round-end state
  // since PlayingState requires currentDrawerId to be non-null
  const isCurrentDrawerLeaving =
    isPlayingState(gameState) && leavingPlayerId === gameState.currentDrawerId

  if (isPlayingState(gameState)) {
    if (isCurrentDrawerLeaving) {
      // When drawer leaves, keep status as 'playing' so endRound() can properly
      // execute and handle the transition to 'round-end'. endRound() checks that
      // status === 'playing' before proceeding, so we must preserve that state.
      // The caller will see shouldEndRound=true and call endRound(true).
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
        revealedPositions: isPlayingState(gameState) ? gameState.revealedPositions : [],
        ...baseClone,
      }
    } else {
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
        revealedPositions: gameState.revealedPositions,
        ...baseClone,
      }
    }
  } else {
    // Preserve nextTransitionAt from the original round-end state
    const roundEndState = gameState as RoundEndState
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
      nextTransitionAt: roundEndState.nextTransitionAt,
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

/**
 * Computes the Levenshtein edit distance between two strings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns The minimum number of single-character edits (insertions, deletions, substitutions)
 *          required to change a into b
 */
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * Builds a space-separated hint string for a word, masking unrevealed characters with '_'.
 * Spaces and hyphens in the original word are always shown as-is.
 *
 * @param word - The word to build a hint for
 * @param revealedPositions - Array of character indices that should be revealed
 * @returns A hint string with characters joined by spaces, e.g. '_ p _ _ e'
 */
export function buildHintString(word: string, revealedPositions: number[]): string {
  const revealed = new Set(revealedPositions)
  return word
    .split('')
    .map((char, i) => {
      if (char === ' ' || char === '-') return char
      return revealed.has(i) ? char : '_'
    })
    .join(' ')
}

/**
 * Picks the next set of positions to reveal in a hint, up to targetFraction of maskable chars.
 * Spaces and hyphens are excluded from the maskable count.
 *
 * @param word - The word being hinted
 * @param existing - Already-revealed positions
 * @param targetFraction - Target fraction of maskable characters to reveal (0–1)
 * @returns New array of revealed positions (existing + newly picked)
 */
export function pickNextRevealPositions(
  word: string,
  existing: number[],
  targetFraction: number
): number[] {
  const maskable = word
    .split('')
    .map((char, i) => ({ char, i }))
    .filter(({ char }) => char !== ' ' && char !== '-')
    .map(({ i }) => i)

  const targetCount = Math.max(1, Math.ceil(maskable.length * targetFraction))
  const currentRevealed = new Set(existing)
  const unrevealed = maskable.filter((i) => !currentRevealed.has(i))

  const needed = Math.max(0, targetCount - existing.length)
  if (needed === 0 || unrevealed.length === 0) return [...existing]

  const shuffled = [...unrevealed]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return [...existing, ...shuffled.slice(0, needed)]
}
