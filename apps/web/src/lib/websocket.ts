import type {
  MessageType,
  Player,
  Stroke,
  ChatMessage,
  GameState,
  RoundResult,
  Winner,
  ScoreEntry,
} from './types'

export type GameEventHandler = {
  onInit?: (
    playerId: string,
    player: Player,
    players: Player[],
    strokes: Stroke[],
    chatHistory: ChatMessage[],
    isHost: boolean,
    gameState: GameState
  ) => void
  onHostChange?: (newHostId: string) => void
  onPlayerJoined?: (player: Player) => void
  onPlayerLeft?: (playerId: string) => void
  onStroke?: (stroke: Stroke) => void
  onStrokeUpdate?: (strokeId: string, point: { x: number; y: number }) => void
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
      this.handlers.onConnectionChange?.(true)
      this.send({ type: 'join', name: this.playerName })
    }

    this.ws.onmessage = (event) => {
      try {
        const data: MessageType = JSON.parse(event.data)
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

    this.ws.onerror = () => {
      this.handlers.onConnectionChange?.(false)
    }
  }

  private handleMessage(data: MessageType) {
    switch (data.type) {
      case 'init':
        this.handlers.onInit?.(
          data.playerId,
          data.player,
          data.players,
          data.strokes,
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
      case 'clear':
        this.handlers.onClear?.()
        break
      case 'chat': {
        // Narrow type: server sends 'chat' with message, client sends with content
        const chatData = data as { type: 'chat'; message: ChatMessage }
        this.handlers.onChat?.(chatData.message)
        break
      }
      case 'system-message':
        this.handlers.onSystemMessage?.(data.content)
        break
      case 'game-started':
        this.handlers.onGameStarted?.(data.totalRounds, data.drawerOrder, data.scores)
        break
      case 'round-start': {
        // Narrow type to ServerMessage's round-start
        const roundData = data as {
          type: 'round-start'
          roundNumber: number
          totalRounds: number
          drawerId: string
          drawerName: string
          word: string | undefined
          wordLength: number | undefined
          endTime: number
        }
        this.handlers.onRoundStart?.(
          roundData.roundNumber,
          roundData.totalRounds,
          roundData.drawerId,
          roundData.drawerName,
          roundData.word,
          roundData.wordLength ?? 0,
          roundData.endTime
        )
        break
      }
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
      case 'error': {
        // Log server errors and optionally notify user
        const errorData = data as { type: 'error'; message: string }
        console.error('Server error:', errorData.message)
        // Could add a handler callback here if needed
        break
      }
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delayMs = Math.pow(2, this.reconnectAttempts - 1) * 1000
      setTimeout(() => this.connect(), delayMs)
    } else {
      this.handlers.onConnectionFailed?.(
        `Failed to reconnect after ${this.maxReconnectAttempts} attempts. Please refresh the page.`
      )
    }
  }

  on(handlers: GameEventHandler) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  send(message: object): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message))
        return true
      } catch (e) {
        console.error('Failed to send message:', e)
        return false
      }
    }
    return false
  }

  sendStroke(stroke: Stroke) {
    this.send({ type: 'stroke', stroke })
  }

  sendStrokeUpdate(strokeId: string, point: { x: number; y: number }) {
    this.send({ type: 'stroke-update', strokeId, point })
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
    this.ws?.close()
    this.ws = null
  }
}
