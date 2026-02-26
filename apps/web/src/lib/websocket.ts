import type {
  Player,
  Stroke,
  FillOperation,
  ChatMessage,
  GameState,
  RoundResult,
  Winner,
  ScoreEntry,
} from './types'
import type { ServerMessage, ClientMessage } from '@repo/types'

export type GameEventHandler = {
  onInit?: (
    playerId: string,
    player: Player,
    players: Player[],
    strokes: Stroke[],
    fills: FillOperation[],
    chatHistory: ChatMessage[],
    isHost: boolean,
    gameState: GameState
  ) => void
  onHostChange?: (newHostId: string) => void
  onPlayerJoined?: (player: Player) => void
  onPlayerLeft?: (playerId: string) => void
  onStroke?: (stroke: Stroke) => void
  onStrokeUpdate?: (strokeId: string, point: { x: number; y: number }) => void
  onStrokeRemoved?: (strokeId: string) => void
  onFill?: (fill: FillOperation) => void
  onFillRemoved?: (fillId: string) => void
  onClear?: () => void
  onChat?: (message: ChatMessage) => void
  onConnectionChange?: (connected: boolean) => void
  onConnectionFailed?: (reason: string) => void
  onSystemMessage?: (content: string) => void
  // Game event handlers
  onGameStarted?: (
    totalRounds: number,
    drawerOrder: string[],
    scores: Record<string, ScoreEntry>
  ) => void
  onRoundStart?: (
    roundNumber: number,
    totalRounds: number,
    drawerId: string,
    drawerName: string,
    word: string | undefined,
    wordLength: number,
    endTime: number
  ) => void
  onRoundEnd?: (word: string, result: RoundResult, scores: Record<string, ScoreEntry>) => void
  onGameOver?: (finalScores: Record<string, ScoreEntry>, winners: Winner[]) => void
  onCorrectGuess?: (
    playerId: string,
    playerName: string,
    score: number,
    timeRemaining: number
  ) => void
  onTick?: (timeRemaining: number) => void
  onGameReset?: () => void
}

export class GameWebSocket {
  private ws: WebSocket | null = null
  private handlers: GameEventHandler = {}
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private maxReconnectAttempts = 5
  private intentionalDisconnect = false
  private roomId: string
  private playerName: string
  private apiUrl: string

  constructor(apiUrl: string, roomId: string, playerName: string) {
    this.apiUrl = apiUrl
    this.roomId = roomId
    this.playerName = playerName
  }

  connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    this.intentionalDisconnect = false
    const wsUrl = this.apiUrl.replace(/^http/, 'ws')
    this.ws = new WebSocket(`${wsUrl}/api/rooms/${this.roomId}/ws`)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      // Clear any pending reconnect timer on successful connection
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.handlers.onConnectionChange?.(true)
      this.send({ type: 'join', name: this.playerName })
    }

    this.ws.onmessage = (event) => {
      try {
        const data: ServerMessage = JSON.parse(event.data)
        this.handleMessage(data)
      } catch (e) {
        console.error('Failed to parse message:', e)
        // Just log the error - the connection is still valid
        // Don't increment reconnectAttempts as this is not a connection issue
      }
    }

    this.ws.onclose = () => {
      this.handlers.onConnectionChange?.(false)
      if (!this.intentionalDisconnect) {
        this.attemptReconnect()
      }
    }

    this.ws.onerror = (event) => {
      console.error('WebSocket error:', event)
      // Don't call onConnectionChange(false) here - onclose will fire after onerror
      // and handle the connection change notification, preventing duplicate calls
    }
  }

  private handleMessage(data: ServerMessage) {
    switch (data.type) {
      case 'init':
        this.handlers.onInit?.(
          data.playerId,
          data.player,
          data.players,
          data.strokes,
          data.fills,
          data.chatHistory,
          data.isHost,
          data.gameState
        )
        break
      case 'player-joined':
        this.handlers.onPlayerJoined?.(data.player)
        break
      case 'host-change':
        this.handlers.onHostChange?.(data.newHostId)
        break
      case 'player-left':
        this.handlers.onPlayerLeft?.(data.playerId)
        break
      case 'stroke':
        this.handlers.onStroke?.(data.stroke)
        break
      case 'stroke-update':
        this.handlers.onStrokeUpdate?.(data.strokeId, data.point)
        break
      case 'stroke-removed':
        this.handlers.onStrokeRemoved?.(data.strokeId)
        break
      case 'fill':
        this.handlers.onFill?.({
          id: data.id,
          playerId: data.playerId,
          x: data.x,
          y: data.y,
          color: data.color,
          timestamp: data.timestamp,
        })
        break
      case 'fill-removed':
        this.handlers.onFillRemoved?.(data.fillId)
        break
      case 'clear':
        this.handlers.onClear?.()
        break
      case 'chat':
        this.handlers.onChat?.(data.message)
        break
      case 'system-message':
        this.handlers.onSystemMessage?.(data.content)
        break
      case 'game-started':
        this.handlers.onGameStarted?.(data.totalRounds, data.drawerOrder, data.scores)
        break
      case 'round-start':
        this.handlers.onRoundStart?.(
          data.roundNumber,
          data.totalRounds,
          data.drawerId,
          data.drawerName,
          data.word,
          data.wordLength ?? 0,
          data.endTime
        )
        break
      case 'round-end':
        this.handlers.onRoundEnd?.(data.word, data.result, data.scores)
        break
      case 'game-over':
        this.handlers.onGameOver?.(data.finalScores, data.winners)
        break
      case 'correct-guess':
        this.handlers.onCorrectGuess?.(
          data.playerId,
          data.playerName,
          data.score,
          data.timeRemaining
        )
        break
      case 'tick':
        this.handlers.onTick?.(data.timeRemaining)
        break
      case 'game-reset':
        this.handlers.onGameReset?.()
        break
      case 'error':
        console.error('Server error:', data.message)
        break
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delayMs = Math.pow(2, this.reconnectAttempts - 1) * 1000
      // Clear any existing reconnect timer before setting a new one
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delayMs)
    } else {
      this.handlers.onConnectionFailed?.(
        `Failed to reconnect after ${this.maxReconnectAttempts} attempts. Please refresh the page.`
      )
    }
  }

  on(handlers: GameEventHandler) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  private send(message: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message))
        return true
      } catch (e) {
        console.error('Failed to send message:', e)
        return false
      }
    }
    console.warn('Cannot send message: WebSocket is not open')
    return false
  }

  sendStroke(stroke: Stroke) {
    this.send({ type: 'stroke', stroke })
  }

  sendStrokeUpdate(strokeId: string, point: { x: number; y: number }) {
    this.send({ type: 'stroke-update', strokeId, point })
  }

  sendUndoStroke(strokeId: string) {
    this.send({ type: 'undo-stroke', strokeId })
  }

  sendUndoFill(fillId: string) {
    this.send({ type: 'undo-fill', fillId })
  }

  sendFill(x: number, y: number, color: string) {
    this.send({ type: 'fill', x, y, color })
  }

  sendClear() {
    this.send({ type: 'clear' })
  }

  sendChat(content: string) {
    this.send({ type: 'chat', content })
  }

  sendStartGame() {
    this.send({ type: 'start-game' })
  }

  sendResetGame() {
    this.send({ type: 'reset-game' })
  }

  disconnect() {
    this.intentionalDisconnect = true
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}
