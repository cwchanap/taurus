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

// Re-export MessageType from shared types to ensure consistency
export type { MessageType } from '@repo/types'

// Import types used locally
import type { Player, Stroke } from '@repo/types'

export interface Point {
  x: number
  y: number
}

export interface Room {
  roomId: string
  players: Player[]
  strokes: Stroke[]
}
