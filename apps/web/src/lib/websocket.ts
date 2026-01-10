import type { MessageType, Player, Stroke } from './types'

export type GameEventHandler = {
  onInit?: (playerId: string, player: Player, players: Player[], strokes: Stroke[]) => void
  onPlayerJoined?: (player: Player) => void
  onPlayerLeft?: (playerId: string) => void
  onStroke?: (stroke: Stroke) => void
  onStrokeUpdate?: (strokeId: string, point: { x: number; y: number }) => void
  onClear?: () => void
  onConnectionChange?: (connected: boolean) => void
  onConnectionFailed?: (reason: string) => void
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
        // If we get multiple malformed messages, something is wrong
        this.reconnectAttempts++ // Reuse this counter or make a new one?
        // Let's just monitor for now, or force disconnect if excessive?
        // Proposal: just log for now but better than silent
        // Or if we want to be strict:
        // this.handlers.onConnectionFailed?.('Received invalid data from server')
        // this.disconnect()
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
        this.handlers.onInit?.(data.playerId, data.player, data.players, data.strokes)
        break
      case 'player-joined':
        this.handlers.onPlayerJoined?.(data.player)
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

  disconnect() {
    this.intentionalDisconnect = true
    this.ws?.close()
    this.ws = null
  }
}
