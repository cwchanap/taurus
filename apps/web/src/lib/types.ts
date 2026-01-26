export interface Point {
  x: number
  y: number
}

export interface Stroke {
  id: string
  playerId: string
  points: Point[]
  color: string
  size: number
}

export interface Player {
  id: string
  name: string
  color: string
}

export interface Room {
  roomId: string
  players: Player[]
  strokes: Stroke[]
}

export interface ChatMessage {
  id: string
  playerId: string
  playerName: string
  playerColor: string
  content: string
  timestamp: number
}

// Game-related types
export type GameStatus = 'lobby' | 'playing' | 'round-end' | 'game-over'
export interface ScoreEntry {
  score: number
  name: string
}

export interface GameState {
  status: GameStatus
  currentRound: number
  totalRounds: number
  currentDrawerId: string | null
  currentWord?: string // Only set for drawer
  wordLength?: number
  roundEndTime: number | null
  scores: Record<string, ScoreEntry>
}

export interface RoundResult {
  drawerId: string
  drawerName: string
  word: string
  correctGuessers: Array<{ playerId: string; playerName: string; score: number }>
  drawerScore: number
}

export interface Winner {
  playerId: string
  playerName: string
  score: number
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
      winner: Winner | null
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
