export type GameStatus = 'lobby' | 'starting' | 'playing' | 'round-end' | 'game-over'

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

/** A color that is guaranteed to be one of the valid drawing palette colors */
export type PaletteColor = (typeof PALETTE_COLORS)[number]

/** Drawing tool types */
export type Tool = 'pencil' | 'eraser' | 'fill'
