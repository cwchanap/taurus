import type { ScoreEntry, RoundResult, Winner, ChatMessage, PaletteColor } from './game'

export interface Player {
  id: string
  name: string
  color: PaletteColor
}

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  id: string
  playerId: string
  color: PaletteColor
  size: number
  points: Point[]
  eraser?: boolean
  timestamp: number
  /** Server-assigned monotonic sequence number for stable cross-operation ordering */
  seq?: number
}

/**
 * Stroke payload sent by client. Unlike Stroke, playerId is optional
 * because the server will always overwrite it with the authenticated
 * player's ID for security reasons. If provided by client, it's ignored.
 */
export interface ClientStrokePayload {
  id?: string // Optional - server generates if not provided or if collision
  playerId?: string // Optional and IGNORED - server uses authenticated session ID
  color: PaletteColor
  size: number
  points: Point[]
  eraser?: boolean
}

export interface FillOperation {
  id: string
  playerId: string
  x: number
  y: number
  color: PaletteColor
  timestamp: number
  /** Server-assigned monotonic sequence number for stable cross-operation ordering */
  seq?: number
  /**
   * Client-generated correlation token for optimistic undo/redo tracking.
   * Never persisted on the server. Echoed back verbatim to the originating client only.
   */
  nonce?: string
  /**
   * Coordinates x and y are normalized values in the range [0, 1], representing
   * the position relative to canvas dimensions. For example, x=0.5 means "50%
   * across the canvas width" regardless of the actual pixel dimensions.
   */
}

// Wire format for GameState — discriminated union matching internal GameState
interface BaseGameStateWire {
  currentRound: number
  totalRounds: number
  scores: Record<string, ScoreEntry>
  currentDrawerId: string | null
}

export interface LobbyStateWire extends BaseGameStateWire {
  status: 'lobby'
}

export interface StartingStateWire extends BaseGameStateWire {
  status: 'starting'
}

export interface WordChoiceStateWire extends BaseGameStateWire {
  status: 'word-choice'
  currentDrawerId: string
  deadlineTime: number
}

export interface PlayingStateWire extends BaseGameStateWire {
  status: 'playing'
  currentDrawerId: string
  deadlineTime: number
  wordLength: number
  currentWord?: string // only present for the drawer
  revealedHint?: string
}

export interface RoundEndStateWire extends BaseGameStateWire {
  status: 'round-end'
  nextTransitionAt: number
}

export interface GameOverStateWire extends BaseGameStateWire {
  status: 'game-over'
}

export type GameStateWire =
  | LobbyStateWire
  | StartingStateWire
  | WordChoiceStateWire
  | PlayingStateWire
  | RoundEndStateWire
  | GameOverStateWire

// Client-to-Server Messages
export type ClientMessage =
  | { type: 'join'; name: string; playerId?: string; reconnectToken?: string }
  | { type: 'chat'; content: string }
  | { type: 'stroke'; stroke: ClientStrokePayload }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'undo-stroke'; strokeId: string }
  | { type: 'undo-fill'; fillId: string }
  | {
      type: 'fill'
      x: number
      y: number
      color: PaletteColor
      /**
       * Client-generated nonce for undo/redo correlation.
       * The server echoes this back verbatim and never persists it.
       */
      nonce?: string
    }
  | { type: 'clear' }
  | { type: 'start-game' }
  | { type: 'reset-game' }
  | { type: 'choose-word'; word: string }

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
      /** Server-issued secret for reconnection — proves ownership of this playerId */
      reconnectToken: string
    }
  | { type: 'player-joined'; player: Player }
  | { type: 'host-change'; newHostId: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'stroke-update'; strokeId: string; point: Point }
  | { type: 'stroke-removed'; strokeId: string }
  | ({ type: 'fill' } & FillOperation)
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
      type: 'round-start-for-drawer'
      roundNumber: number
      totalRounds: number
      drawerId: string
      drawerName: string
      word: string
      wordLength: number
      endTime: number
    }
  | {
      type: 'round-start-for-guesser'
      roundNumber: number
      totalRounds: number
      drawerId: string
      drawerName: string
      wordLength?: number
      endTime: number
      revealedHint?: string
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
      catchUpBonus?: number
    }
  | { type: 'tick'; timeRemaining: number }
  | { type: 'game-reset' }
  | {
      type: 'word-choice-start'
      roundNumber: number
      totalRounds: number
      drawerId: string
      drawerName: string
      wordChoiceEndTime: number
    }
  | {
      type: 'word-options'
      words: [string, string, string]
      timeToChoose: number
      roundNumber: number
      totalRounds: number
      wordChoiceEndTime: number
    }
  | { type: 'hint'; revealed: string }
  | { type: 'system-message'; content: string }
  | { type: 'error'; message: string; action?: ClientMessage['type']; nonce?: string }

/** @deprecated Use `ClientMessage` or `ServerMessage` directly for type safety */
export type MessageType = ClientMessage | ServerMessage
