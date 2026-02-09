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
  | { type: 'chat'; content: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: { x: number; y: number } }
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
      chatHistory: ChatMessage[]
      isHost: boolean
      gameState: GameStateWire
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'host-change'; newHostId: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: { x: number; y: number } }
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
  | { type: 'error'; message: string }

// Combined for convenience
export type MessageType = ClientMessage | ServerMessage
