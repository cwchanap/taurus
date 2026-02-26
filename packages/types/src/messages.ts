import type { GameStatus, ScoreEntry, RoundResult, Winner, ChatMessage } from './game'

export interface Player {
  id: string
  name: string
  color: string
}

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  id: string
  playerId: string
  color: string
  size: number
  points: Point[]
  eraser?: boolean
}

/**
 * Stroke payload sent by client. Unlike Stroke, playerId is optional
 * because the server will always overwrite it with the authenticated
 * player's ID for security reasons. If provided by client, it's ignored.
 */
export interface ClientStrokePayload {
  id?: string // Optional - server generates if not provided or if collision
  playerId?: string // Optional and IGNORED - server uses authenticated session ID
  color: string
  size: number
  points: Point[]
  eraser?: boolean
}

export interface FillOperation {
  id: string
  playerId: string
  x: number
  y: number
  color: string
  timestamp: number
}

/** Drawing palette colors — single source of truth shared by frontend and backend */
export const PALETTE_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#FFFFFF',
  '#1a1a2e',
] as const

// Wire format for GameState (what goes over WebSocket)
export interface GameStateWire {
  status: GameStatus
  currentRound: number
  totalRounds: number
  currentDrawerId: string | null
  currentWord?: string // Optional - only sent to drawer
  wordLength?: number
  roundEndTime: number | null
  scores: Record<string, ScoreEntry>
}

// Client-to-Server Messages
export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'chat'; content: string }
  | { type: 'stroke'; stroke: ClientStrokePayload }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'undo-stroke'; strokeId: string }
  | { type: 'undo-fill'; fillId: string }
  | { type: 'fill'; x: number; y: number; color: string }
  | { type: 'clear' }
  | { type: 'start-game' }
  | { type: 'reset-game' }

// Server-to-Client Messages
export type ServerMessage =
  | {
      type: 'init'
      playerId: string
      player: Player
      players: Player[]
      strokes: Stroke[]
      fills: FillOperation[]
      chatHistory: ChatMessage[]
      isHost: boolean
      gameState: GameStateWire
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'host-change'; newHostId: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'stroke-removed'; strokeId: string }
  | {
      type: 'fill'
      id: string
      playerId: string
      x: number
      y: number
      color: string
      timestamp: number
    }
  | { type: 'fill-removed'; fillId: string }
  | { type: 'clear' }
  | { type: 'chat'; message: ChatMessage }
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
      wordLength?: number
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
  | { type: 'game-reset' }
  | { type: 'system-message'; content: string }
  | { type: 'error'; message: string }

/** @deprecated Use `ClientMessage` or `ServerMessage` directly for type safety */
export type MessageType = ClientMessage | ServerMessage
