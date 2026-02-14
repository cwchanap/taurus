/**
 * Game state types for the drawing guessing game
 */

import type { GameStatus, ScoreEntry, RoundResult, Winner, GameStateWire } from '@repo/types'

export type { GameStatus, ScoreEntry, RoundResult, Winner, GameStateWire }

// Base fields shared by all game states
type BaseGameState = {
  scores: Map<string, ScoreEntry>
  usedWords: Set<string>
  drawerOrder: string[] // Player IDs in draw order
  correctGuessers: Set<string> // Players who guessed correctly this round
  roundGuessers: Set<string> // Players eligible to guess this round
  roundGuesserScores: Map<string, number> // Scores earned by guessers this round
}

// Lobby state - waiting for game to start
export type LobbyState = BaseGameState & {
  status: 'lobby'
  currentRound: 0
  totalRounds: number
  currentDrawerId: null
  currentWord: null
  wordLength: null
  roundStartTime: null
  roundEndTime: null
}

// Starting state - game initialized but round not yet started
export type StartingState = BaseGameState & {
  status: 'starting'
  currentRound: 0
  totalRounds: number
  currentDrawerId: null
  currentWord: null
  wordLength: null
  roundStartTime: null
  roundEndTime: null
}

// Playing state - active round in progress
export type PlayingState = BaseGameState & {
  status: 'playing'
  currentRound: number // 1-based round number
  totalRounds: number
  currentDrawerId: string // non-null - drawer is always set
  currentWord: string // non-null - word is always set
  wordLength: number // non-null - derived from currentWord
  roundStartTime: number // non-null - when round started
  roundEndTime: number // non-null - when round ends
  endGameAfterCurrentRound: boolean // Flag to end game after current round
}

// Round end state - between rounds, showing results
export type RoundEndState = BaseGameState & {
  status: 'round-end'
  currentRound: number // Which round just ended
  totalRounds: number
  currentDrawerId: null // Cleared after round ends
  currentWord: null // Cleared after round ends
  wordLength: null // Cleared after round ends
  roundStartTime: number // When round started (kept for reference)
  roundEndTime: number // When round ended (kept for reference)
  endGameAfterCurrentRound: boolean // Flag to end game after current round
  nextTransitionAt: number // Timestamp when next transition should occur
}

// Game over state - game finished, showing final results
export type GameOverState = BaseGameState & {
  status: 'game-over'
  currentRound: number
  totalRounds: number
  currentDrawerId: null
  currentWord: null
  wordLength: null
  roundStartTime: null
  roundEndTime: null
}

// Discriminated union of all game states
export type GameState = LobbyState | StartingState | PlayingState | RoundEndState | GameOverState

// Type guards for narrowing GameState
export function isLobbyState(state: GameState): state is LobbyState {
  return state.status === 'lobby'
}

export function isStartingState(state: GameState): state is StartingState {
  return state.status === 'starting'
}

export function isPlayingState(state: GameState): state is PlayingState {
  return state.status === 'playing'
}

export function isRoundEndState(state: GameState): state is RoundEndState {
  return state.status === 'round-end'
}

export function isGameOverState(state: GameState): state is GameOverState {
  return state.status === 'game-over'
}

// Type guard for active game states (playing or round-end)
export function isActiveGameState(state: GameState): state is PlayingState | RoundEndState {
  return state.status === 'playing' || state.status === 'round-end'
}

export interface PlayerScore {
  playerId: string
  playerName: string
  score: number
}

/**
 * Create initial game state (lobby)
 */
export function createInitialGameState(): LobbyState {
  return {
    status: 'lobby',
    currentRound: 0,
    totalRounds: 0,
    currentDrawerId: null,
    currentWord: null,
    wordLength: null,
    roundStartTime: null,
    roundEndTime: null,
    drawerOrder: [],
    scores: new Map(),
    correctGuessers: new Set(),
    roundGuessers: new Set(),
    roundGuesserScores: new Map(),
    usedWords: new Set(),
  }
}

/**
 * Convert scores Map to Record for JSON serialization
 */
export function scoresToRecord(scores: Map<string, ScoreEntry>): Record<string, ScoreEntry> {
  return Object.fromEntries(scores)
}

/**
 * Serializable version of GameState for storage (converts Maps/Sets to arrays)
 */
export interface StoredGameState {
  status: GameStatus
  currentRound: number
  totalRounds: number
  currentDrawerId: string | null
  currentWord: string | null
  wordLength: number | null
  roundStartTime: number | null
  roundEndTime: number | null
  drawerOrder: string[]
  scores: [string, ScoreEntry][]
  correctGuessers: string[]
  roundGuessers: string[]
  roundGuesserScores: [string, number][]
  usedWords: string[]
  endGameAfterCurrentRound?: boolean
  nextTransitionAt?: number
}

/**
 * Convert GameState to storage-friendly format
 */
export function gameStateToStorage(state: GameState): StoredGameState {
  const stored: StoredGameState = {
    status: state.status,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    currentDrawerId: state.currentDrawerId,
    currentWord: state.currentWord,
    wordLength: state.wordLength,
    roundStartTime: state.roundStartTime,
    roundEndTime: state.roundEndTime,
    drawerOrder: state.drawerOrder,
    scores: Array.from(state.scores.entries()),
    correctGuessers: Array.from(state.correctGuessers),
    roundGuessers: Array.from(state.roundGuessers),
    roundGuesserScores: Array.from(state.roundGuesserScores.entries()),
    usedWords: Array.from(state.usedWords),
  }

  // Only include endGameAfterCurrentRound for states that have it
  if (isPlayingState(state) || isRoundEndState(state)) {
    stored.endGameAfterCurrentRound = state.endGameAfterCurrentRound
  }

  // Only include nextTransitionAt for round-end state
  if (isRoundEndState(state)) {
    stored.nextTransitionAt = state.nextTransitionAt
  }

  return stored
}

/**
 * Restore GameState from storage format
 */
export function gameStateFromStorage(stored: StoredGameState): GameState {
  const baseState = {
    currentRound: stored.currentRound,
    totalRounds: stored.totalRounds,
    drawerOrder: stored.drawerOrder,
    scores: new Map(stored.scores),
    correctGuessers: new Set(stored.correctGuessers),
    roundGuessers: new Set(stored.roundGuessers),
    roundGuesserScores: new Map(stored.roundGuesserScores),
    usedWords: new Set(stored.usedWords),
  }

  switch (stored.status) {
    case 'lobby':
      return {
        ...baseState,
        status: 'lobby',
        currentDrawerId: null,
        currentWord: null,
        wordLength: null,
        roundStartTime: null,
        roundEndTime: null,
      } as LobbyState
    case 'starting':
      return {
        ...baseState,
        status: 'starting',
        currentDrawerId: null,
        currentWord: null,
        wordLength: null,
        roundStartTime: null,
        roundEndTime: null,
      } as StartingState
    case 'playing': {
      // Validate required fields for playing state
      if (
        !stored.currentDrawerId ||
        !stored.currentWord ||
        stored.wordLength == null ||
        stored.roundStartTime == null ||
        stored.roundEndTime == null
      ) {
        console.error(
          'Corrupt playing state in storage: missing required fields, falling back to lobby'
        )
        return createInitialGameState()
      }
      return {
        ...baseState,
        status: 'playing',
        currentDrawerId: stored.currentDrawerId,
        currentWord: stored.currentWord,
        wordLength: stored.wordLength,
        roundStartTime: stored.roundStartTime,
        roundEndTime: stored.roundEndTime,
        endGameAfterCurrentRound: stored.endGameAfterCurrentRound ?? false,
      } as PlayingState
    }
    case 'round-end': {
      // Validate required fields for round-end state
      if (stored.roundStartTime == null || stored.roundEndTime == null) {
        console.error(
          'Corrupt round-end state in storage: missing required fields, falling back to lobby'
        )
        return createInitialGameState()
      }
      return {
        ...baseState,
        status: 'round-end',
        currentDrawerId: null,
        currentWord: null,
        wordLength: null,
        roundStartTime: stored.roundStartTime,
        roundEndTime: stored.roundEndTime,
        endGameAfterCurrentRound: stored.endGameAfterCurrentRound ?? false,
        nextTransitionAt: stored.nextTransitionAt ?? Date.now(),
      } as RoundEndState
    }
    case 'game-over':
      return {
        ...baseState,
        status: 'game-over',
        currentDrawerId: null,
        currentWord: null,
        wordLength: null,
        roundStartTime: null,
        roundEndTime: null,
      } as GameOverState
    default:
      console.error(
        `Unknown game state status in storage: "${stored.status}", falling back to lobby`
      )
      return createInitialGameState()
  }
}

/**
 * Helper to convert internal state to wire format
 */
export function gameStateToWire(state: GameState, isDrawer: boolean): GameStateWire {
  // Use type guards to access fields correctly
  if (isPlayingState(state)) {
    return {
      status: state.status,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      currentDrawerId: state.currentDrawerId,
      currentWord: isDrawer ? state.currentWord : undefined,
      wordLength: state.wordLength,
      roundEndTime: state.roundEndTime,
      scores: scoresToRecord(state.scores),
    }
  }

  if (isRoundEndState(state)) {
    return {
      status: state.status,
      currentRound: state.currentRound,
      totalRounds: state.totalRounds,
      currentDrawerId: state.currentDrawerId,
      wordLength: undefined,
      roundEndTime: state.roundEndTime,
      scores: scoresToRecord(state.scores),
    }
  }

  // Lobby or game-over state
  return {
    status: state.status,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    currentDrawerId: state.currentDrawerId,
    wordLength: undefined,
    roundEndTime: state.roundEndTime,
    scores: scoresToRecord(state.scores),
  }
}
