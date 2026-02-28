// Re-export shared types
// Note: GameStateWire is re-exported as GameState for frontend convenience
export type {
  GameStatus,
  ScoreEntry,
  RoundResult,
  Winner,
  ChatMessage,
  Player,
  Stroke,
  Point,
  FillOperation,
  GameStateWire as GameState,
} from '@repo/types'

// Import types used locally
import type { Player, Stroke } from '@repo/types'

export interface Room {
  roomId: string
  players: Player[]
  strokes: Stroke[]
}
