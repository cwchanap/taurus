import type { GameStatus, ScoreEntry, RoundResult, Winner, ChatMessage } from './game'

export interface Player {
  id: string
  name: string
  color: string
}

export interface Stroke {
  id: string
  playerId: string
  color: string
  size: number
  points: Array<{ x: number; y: number }>
}

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
  | { type: 'chat-message'; content: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-point'; strokeId: string; point: { x: number; y: number } }
  | { type: 'stroke-complete'; strokeId: string }
  | { type: 'start-game' }
  | { type: 'reset-game' }
  | { type: 'clear-canvas' }

// Server-to-Client Messages
export type ServerMessage =
  | {
      type: 'init'
      playerId: string
      player: Player
      players: Player[]
      strokes: Stroke[]
      gameState: GameStateWire
      chatHistory: ChatMessage[]
      isHost: boolean
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: { x: number; y: number } }
  | { type: 'stroke-complete'; strokeId: string }
  | { type: 'clear'; initiatorId?: string }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'chat-history'; messages: ChatMessage[] }
  | { type: 'game-state'; gameState: GameStateWire }
  | { type: 'game-started'; gameState: GameStateWire }
  | {
      type: 'round-start'
      round: number
      drawerId: string
      drawerName: string
      wordLength: number
      currentWord?: string
    }
  | { type: 'correct-guess'; playerId: string; playerName: string; score: number }
  | { type: 'round-end'; result: RoundResult; nextRound: number | null }
  | { type: 'game-over'; winners: Winner[]; finalScores: Record<string, ScoreEntry> }
  | { type: 'host-change'; newHostId: string }
  | { type: 'game-terminated'; reason: string }
  | { type: 'error'; message: string }

// Combined for convenience
export type MessageType = ClientMessage | ServerMessage
