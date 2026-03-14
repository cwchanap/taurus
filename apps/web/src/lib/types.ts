// Re-export shared types
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
  PaletteColor,
  GameStateWire,
} from '@repo/types'

// Import types used locally
import type { Player, Stroke, FillOperation } from '@repo/types'

export interface Room {
  roomId: string
  players: Player[]
  strokes: Stroke[]
  fills: FillOperation[]
}
