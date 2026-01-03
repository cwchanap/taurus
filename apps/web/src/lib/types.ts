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

export type MessageType =
  | { type: 'join'; name: string }
  | { type: 'init'; playerId: string; player: Player; players: Player[]; strokes: Stroke[] }
  | { type: 'player-joined'; player: Player }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'clear' }
