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

export type MessageType =
  | { type: 'join'; name: string }
  | {
      type: 'init'
      playerId: string
      player: Player
      players: Player[]
      strokes: Stroke[]
      chatHistory: ChatMessage[]
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'clear' }
  | { type: 'chat'; message: ChatMessage }
