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
  endGameAfterCurrentRound?: boolean // Flag to end game after current round
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
  endGameAfterCurrentRound?: boolean // Flag to end game after current round
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

// Game-related message types (server -> client)
export interface GameStartedMessage {
  type: 'game-started'
  totalRounds: number
  drawerOrder: string[]
  scores: Record<string, { score: number; name: string }>
}

export interface RoundStartMessage {
  type: 'round-start'
  roundNumber: number
  totalRounds: number
  drawerId: string
  drawerName: string
  word?: string // Only sent to the drawer
  wordLength: number // Sent to all so guessers know word length
  endTime: number // Timestamp when round ends
}

export interface RoundEndMessage {
  type: 'round-end'
  word: string
  result: RoundResult
  scores: Record<string, { score: number; name: string }>
}

export interface GameOverMessage {
  type: 'game-over'
  finalScores: Record<string, { score: number; name: string }>
  winners: { playerId: string; playerName: string; score: number }[]
}

export interface CorrectGuessMessage {
  type: 'correct-guess'
  playerId: string
  playerName: string
  score: number
  timeRemaining: number
}

export interface TickMessage {
  type: 'tick'
  timeRemaining: number
}

// Game-related message types (client -> server)
export interface StartGameClientMessage {
  type: 'start-game'
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
