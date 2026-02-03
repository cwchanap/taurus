// Re-export shared types
export type {
  GameStatus,
  ScoreEntry,
  RoundResult,
  Winner,
  ChatMessage,
  Player,
  Stroke,
  GameStateWire as GameState,
} from '@repo/types'
import type {
  Player,
  Stroke,
  ChatMessage,
  ScoreEntry,
  RoundResult,
  Winner,
  GameStateWire as GameState,
} from '@repo/types'

export interface Point {
  x: number
  y: number
}

export interface Room {
  roomId: string
  players: Player[]
  strokes: Stroke[]
}

export type MessageType =
  | { type: 'join'; name: string }
  | {
      type: 'init'
      playerId: string
      player: Player
      players: Player[]
      strokes: Stroke[]
      chatHistory: ChatMessage[]
      isHost: boolean
      gameState: GameState
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'host-change'; newHostId: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'clear' }
  | { type: 'chat'; message: ChatMessage }
  // Game-related messages
  | {
      type: 'game-started'
      totalRounds: number
      drawerOrder: string[]
      scores: Record<string, ScoreEntry>
    }
  | {
      type: 'round-start'
      roundNumber: number
      totalRounds: number
      drawerId: string
      drawerName: string
      word?: string
      wordLength: number
      endTime: number
    }
  | {
      type: 'round-end'
      word: string
      result: RoundResult
      scores: Record<string, ScoreEntry>
    }
  | {
      type: 'game-over'
      finalScores: Record<string, ScoreEntry>
      winners: Winner[]
    }
  | {
      type: 'correct-guess'
      playerId: string
      playerName: string
      score: number
      timeRemaining: number
    }
  | { type: 'tick'; timeRemaining: number }
  | { type: 'reset-game' }
  | { type: 'game-reset' }
