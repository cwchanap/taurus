export type GameStatus = 'lobby' | 'playing' | 'round-end' | 'game-over'

export interface ScoreEntry {
  score: number
  name: string
}

export interface RoundResult {
  drawerId: string
  drawerName: string
  word: string
  correctGuessers: Array<{
    playerId: string
    playerName: string
    score: number
  }>
  drawerScore: number
}

export interface Winner {
  playerId: string
  playerName: string
  score: number
}

export interface ChatMessage {
  id: string
  playerId: string
  playerName: string
  playerColor: string
  content: string
  timestamp: number
}

export type HexColor = `#${string}`
