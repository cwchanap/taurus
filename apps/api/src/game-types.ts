/**
 * Game state types for the drawing guessing game
 */

import type { GameStatus, ScoreEntry, RoundResult, Winner, GameStateWire } from '@repo/types'

export type { GameStatus, ScoreEntry, RoundResult, Winner, GameStateWire }

// Backend-specific internal state (uses Map/Set for efficiency)
export interface GameState {
  status: GameStatus
  currentRound: number
  totalRounds: number
  currentDrawerId: string | null
  currentWord: string | null
  wordLength: number | null
  roundStartTime: number | null
  roundEndTime: number | null
  drawerOrder: string[] // Player IDs in draw order
  scores: Map<string, ScoreEntry>
  correctGuessers: Set<string> // Players who guessed correctly this round
  roundGuessers: Set<string> // Players eligible to guess this round
  roundGuesserScores: Map<string, number> // Scores earned by guessers this round
  usedWords: Set<string> // Words already used in this game
  endGameAfterCurrentRound?: boolean // Flag to end game after current round (e.g., when player leaves)
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
  winner: { playerId: string; playerName: string; score: number } | null
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
 * Create initial game state
 */
export function createInitialGameState(): GameState {
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
    endGameAfterCurrentRound: false,
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
  return {
    status: state.status,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    currentDrawerId: state.currentDrawerId,
    currentWord: isDrawer && state.currentWord ? state.currentWord : undefined,
    wordLength: state.wordLength ?? undefined,
    roundEndTime: state.roundEndTime,
    scores: scoresToRecord(state.scores),
  }
}
