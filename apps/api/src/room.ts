import { DurableObject } from 'cloudflare:workers'

interface Player {
  id: string
  name: string
  color: string
}

interface Point {
  x: number
  y: number
}

interface Stroke {
  id: string
  playerId: string
  points: Point[]
  color: string
  size: number
}

interface Message {
  type: string
  [key: string]: unknown
}

interface WebSocketAttachment {
  playerId: string
  player: Player
}

import { ChatHistory, ChatMessage } from './chat-history'

const COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
]

import {
  MAX_COLOR_LENGTH,
  MAX_STROKE_SIZE,
  MIN_STROKE_SIZE,
  MAX_STROKE_POINTS,
  MAX_COORDINATE_VALUE,
} from './constants'
import {
  validateMessageContent,
  sanitizeMessage,
  isValidPlayerName as isValidPlayerNameUtil,
} from './validation'

export class DrawingRoom extends DurableObject<CloudflareBindings> {
  private strokes: Stroke[] = []
  private initialized = false
  private created = false
  private hostPlayerId: string | null = null
  private storageWriteTimer: ReturnType<typeof setTimeout> | null = null
  private storageWriteDelay = 1000 // Reduced to 1 second for stroke data

  // Rate limiting
  private playerLastMessageTime: Map<string, number> = new Map()
  private playerMessageCount: Map<string, number> = new Map()
  private readonly RATE_LIMIT_WINDOW = 1000 // 1 second
  private readonly MAX_MESSAGES_PER_WINDOW = 30
  private readonly MAX_STROKES_PER_WINDOW = 5
  private playerStrokeCount: Map<string, number> = new Map()
  private playerLastStrokeWindowTime: Map<string, number> = new Map()

  // Track players being cleaned up to prevent duplicate leave broadcasts
  private cleanedPlayers = new Set<string>()

  // Chat history manager
  private chatHistory = new ChatHistory()

  private async ensureInitialized() {
    if (!this.initialized) {
      this.strokes = (await this.ctx.storage.get<Stroke[]>('strokes')) || []
      this.created = (await this.ctx.storage.get<boolean>('created')) || false
      const storedChatHistory = (await this.ctx.storage.get<ChatMessage[]>('chatHistory')) || []
      this.chatHistory.setMessages(storedChatHistory)

      // Migration: If we have strokes but no created flag, assume it's a legacy room
      if (!this.created && this.strokes.length > 0) {
        this.created = true
        await this.storagePutWithRetry('created', true)
      }
      this.initialized = true
    }
  }

  private async storagePutWithRetry<T>(key: string, value: T, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.ctx.storage.put(key, value)
        return
      } catch (e) {
        if (i === retries - 1) {
          console.error(`Failed to store ${key} after ${retries} attempts:`, e)
          throw e
        }
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 100))
      }
    }
  }

  private async storageDeleteWithRetry(key: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.ctx.storage.delete(key)
        return
      } catch (e) {
        if (i === retries - 1) {
          console.error(`Failed to delete ${key} after ${retries} attempts:`, e)
          throw e
        }
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 100))
      }
    }
  }

  private scheduleStorageWrite() {
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
    }

    this.storageWriteTimer = setTimeout(() => {
      this.storageWriteTimer = null
      // Using ctx.waitUntil to ensure the promise completes even if the DO is evicted
      this.ctx.waitUntil(
        this.storagePutWithRetry('strokes', this.strokes).catch((e) =>
          console.error('Background storage save failed:', e)
        )
      )
    }, this.storageWriteDelay)
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized()
    const url = new URL(request.url)

    if (url.pathname === '/create' && request.method === 'POST') {
      this.created = true
      await this.storagePutWithRetry('created', true)
      return new Response('Created', { status: 200 })
    }

    if (url.pathname === '/ws') {
      // Optional: Reject WebSocket if room not created?
      // For now we allow it but maybe we should auto-create on join?
      // Or strict: if not created, 404.
      // The issue specifically mentioned the info endpoint, but consistency suggests strictness.
      // However, making /ws strict might break direct joins if the create flow fails or if we want to allow "join to create"?
      // The prompt suggests: "prevent users from 'activating' a random room just by joining".
      // Let's enforce strictness for WS too, but effectively handleJoin does initialization.
      // Actually, let's stick to the minimal scope requested: Fix the INFO endpoint 404s.
      // But verify if we should block WS. Logic: "clients cannot detect bad/expired room codes".
      // If WS allows connection, client thinks it works.
      // Let's check `created` in WS connection.

      if (!this.created) {
        // Should we support handling join for legacy rooms that might be empty?
        // We did the migration check in ensureInitialized.
        // If strokes are empty and created is false, it's truly a non-existent room.
        return new Response('Room not found', { status: 404 })
      }

      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/info') {
      if (!this.created) {
        return new Response('Not found', { status: 404 })
      }
      const players = this.getPlayers()
      return Response.json({
        playerCount: players.length,
        strokeCount: this.strokes.length,
      })
    }

    return new Response('Not found', { status: 404 })
  }

  private getPlayers(): Player[] {
    const players: Player[] = []
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
      if (attachment?.player) {
        players.push(attachment.player)
      }
    }
    return players
  }

  private getPlayerIdForSocket(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    return attachment?.playerId ?? null
  }

  /**
   * Validates a point object
   */
  private isValidPoint(point: unknown): point is Point {
    if (!point || typeof point !== 'object') {
      return false
    }

    const p = point as Record<string, unknown>
    return (
      typeof p.x === 'number' &&
      Number.isFinite(p.x) &&
      Math.abs(p.x) <= MAX_COORDINATE_VALUE &&
      typeof p.y === 'number' &&
      Number.isFinite(p.y) &&
      Math.abs(p.y) <= MAX_COORDINATE_VALUE
    )
  }

  /**
   * Validates a player name
   */
  private isValidPlayerName(name: unknown): name is string {
    return isValidPlayerNameUtil(name)
  }

  /**
   * Validates a color string
   */
  private isValidColor(color: unknown): color is string {
    if (typeof color !== 'string') {
      return false
    }
    return color.length > 0 && color.length <= MAX_COLOR_LENGTH
  }

  /**
   * Validates a size value
   */
  private isValidSize(size: unknown): size is number {
    if (typeof size !== 'number') {
      return false
    }
    return Number.isFinite(size) && size >= MIN_STROKE_SIZE && size <= MAX_STROKE_SIZE
  }

  /**
   * Validates a stroke ID (should be a non-empty string, reasonable length)
   */
  private isValidStrokeId(strokeId: unknown): strokeId is string {
    if (typeof strokeId !== 'string') {
      return false
    }
    return strokeId.length > 0 && strokeId.length <= 100
  }

  /**
   * Validates and sanitizes stroke data from client
   * Returns validated Stroke object or null if invalid
   */
  private validateAndCreateStroke(strokeData: unknown, playerId: string): Stroke | null {
    if (!strokeData || typeof strokeData !== 'object') {
      console.warn('Invalid stroke data: not an object')
      return null
    }

    const data = strokeData as Record<string, unknown>

    // Validate points array
    const points = data.points
    if (!Array.isArray(points)) {
      console.warn('Invalid stroke data: points is not an array')
      return null
    }

    if (points.length === 0 || points.length > MAX_STROKE_POINTS) {
      console.warn(`Invalid stroke data: points array length ${points.length} exceeds limits`)
      return null
    }

    // Validate each point
    for (let i = 0; i < points.length; i++) {
      if (!this.isValidPoint(points[i])) {
        console.warn(`Invalid stroke data: point at index ${i} is invalid`)
        return null
      }
    }

    // Validate color
    if (!this.isValidColor(data.color)) {
      console.warn('Invalid stroke data: color is invalid')
      return null
    }

    // Validate size
    if (!this.isValidSize(data.size)) {
      console.warn('Invalid stroke data: size is invalid')
      return null
    }

    // Return validated stroke with server-generated ID
    return {
      id: crypto.randomUUID(), // Server generates ID to prevent spoofing
      playerId,
      points,
      color: data.color,
      size: data.size,
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Parse message - client error if this fails
    let data: Message
    try {
      let messageStr: string
      if (typeof message === 'string') {
        messageStr = message
      } else {
        messageStr = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(message)
      }
      data = JSON.parse(messageStr)
    } catch (e) {
      console.warn('Invalid message format from client:', e)
      return
    }

    // Handle message - server error if this fails
    try {
      switch (data.type) {
        case 'join':
          await this.handleJoin(ws, data as Message & { name: string })
          break
        case 'stroke':
          await this.handleStroke(ws, data as Message & { stroke: Stroke })
          break
        case 'stroke-update':
          await this.handleStrokeUpdate(ws, data as Message & { strokeId: string; point: Point })
          break
        case 'clear':
          await this.handleClear(ws)
          break
        case 'chat':
          await this.handleChat(ws, data as Message & { content: string })
          break
      }
    } catch (e) {
      console.error('Handler error for message type:', data.type, e)
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.handleLeave(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.handleLeave(ws)
  }

  private async handleJoin(ws: WebSocket, data: Message & { name: string }) {
    // Validate player name
    const name = this.isValidPlayerName(data.name) ? data.name : 'Anonymous'

    const playerId = crypto.randomUUID()
    const existingPlayers = this.getPlayers()
    const color = COLORS[existingPlayers.length % COLORS.length]

    const player: Player = {
      id: playerId,
      name,
      color,
    }

    // Store player info as WebSocket attachment
    const attachment: WebSocketAttachment = { playerId, player }
    ws.serializeAttachment(attachment)

    // Clean up any leftover cleanup flag (reconnection scenario)
    this.cleanedPlayers.delete(playerId)

    // First player becomes the host
    if (this.hostPlayerId === null) {
      this.hostPlayerId = playerId
    }

    // Send current state to the new player (include existing players)
    await this.ensureInitialized()

    ws.send(
      JSON.stringify({
        type: 'init',
        playerId,
        player,
        players: [...existingPlayers, player],
        strokes: this.strokes,
        chatHistory: this.chatHistory.getMessages(),
      })
    )

    // Notify others about the new player
    this.broadcast(
      {
        type: 'player-joined',
        player,
      },
      ws
    )
  }

  private handleLeave(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Prevent duplicate broadcasts
    if (this.cleanedPlayers.has(playerId)) {
      return
    }
    this.cleanedPlayers.add(playerId)

    // Transfer host ownership if the host leaves
    if (playerId === this.hostPlayerId) {
      const players = this.getPlayers().filter((p) => p.id !== playerId)
      // Assign host to the next player if available
      this.hostPlayerId = players.length > 0 ? players[0].id : null
    }

    this.broadcast({
      type: 'player-left',
      playerId,
    })

    // Clean up rate limiting data
    this.playerLastMessageTime.delete(playerId)
    this.playerMessageCount.delete(playerId)
    this.playerStrokeCount.delete(playerId)
    this.playerLastStrokeWindowTime.delete(playerId)

    // Clean up the flag after a short delay (in case socket is reused)
    setTimeout(() => this.cleanedPlayers.delete(playerId), 1000)
  }

  /**
   * Checks and updates rate limits for a player.
   * @param playerId The player ID
   * @param isNewStroke Whether this message counts as a new stroke
   * @returns true if allowed, false if rate limited
   */
  private checkRateLimit(playerId: string, isNewStroke: boolean): boolean {
    const now = Date.now()

    // 1. Total message rate limit (all types: join, stroke, update, chat, clear)
    const lastMsgWindowStart = this.playerLastMessageTime.get(playerId) || 0
    if (now - lastMsgWindowStart > this.RATE_LIMIT_WINDOW) {
      this.playerLastMessageTime.set(playerId, now)
      this.playerMessageCount.set(playerId, 1)
    } else {
      const currentMessageCount = this.playerMessageCount.get(playerId) || 0
      if (currentMessageCount >= this.MAX_MESSAGES_PER_WINDOW) {
        return false
      }
      this.playerMessageCount.set(playerId, currentMessageCount + 1)
    }

    // 2. Stroke-specific rate limit (only for NEW strokes)
    if (isNewStroke) {
      const lastStrokeWindowStart = this.playerLastStrokeWindowTime.get(playerId) || 0
      if (now - lastStrokeWindowStart > this.RATE_LIMIT_WINDOW) {
        this.playerLastStrokeWindowTime.set(playerId, now)
        this.playerStrokeCount.set(playerId, 1)
      } else {
        const currentStrokeCount = this.playerStrokeCount.get(playerId) || 0
        if (currentStrokeCount >= this.MAX_STROKES_PER_WINDOW) {
          // If we block the stroke, we should probably "refund" the message count
          // but for simplicity and strictness we treat the blocked attempt as a message
          return false
        }
        this.playerStrokeCount.set(playerId, currentStrokeCount + 1)
      }
    }

    return true
  }

  private async handleStroke(ws: WebSocket, data: Message & { stroke: Stroke }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Rate limiting check for new strokes (more restrictive than updates)
    if (!this.checkRateLimit(playerId, true)) {
      console.warn(`Rate limit exceeded for player ${playerId}`)
      return
    }

    await this.ensureInitialized()

    // Validate and create stroke
    const stroke = this.validateAndCreateStroke(data.stroke, playerId)
    if (!stroke) {
      console.warn(`Invalid stroke data received from player ${playerId}`)
      return
    }

    this.strokes.push(stroke)
    // Schedule debounced storage write
    this.scheduleStorageWrite()

    this.broadcast(
      {
        type: 'stroke',
        stroke,
      },
      ws
    )
  }

  private async handleStrokeUpdate(
    ws: WebSocket,
    data: Message & { strokeId: string; point: Point }
  ) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Rate limiting check
    if (!this.checkRateLimit(playerId, false)) {
      console.warn(`Rate limit exceeded for player ${playerId}`)
      return
    }

    // Validate strokeId
    if (!this.isValidStrokeId(data.strokeId)) {
      console.warn(`Invalid strokeId received from player ${playerId}`)
      return
    }

    // Validate incoming point data
    if (!this.isValidPoint(data.point)) {
      console.warn(`Invalid point data received from player ${playerId}`)
      return
    }

    await this.ensureInitialized()

    const stroke = this.strokes.find((s) => s.id === data.strokeId && s.playerId === playerId)
    if (stroke) {
      // Check if stroke has reached maximum points
      if (stroke.points.length >= MAX_STROKE_POINTS) {
        console.warn(`Stroke ${data.strokeId} has reached maximum points limit`)
        return
      }

      stroke.points.push(data.point)

      // Schedule debounced storage write
      this.scheduleStorageWrite()

      this.broadcast(
        {
          type: 'stroke-update',
          strokeId: data.strokeId,
          point: data.point,
        },
        ws
      )
    }
  }

  private async handleClear(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Only host can clear
    if (playerId !== this.hostPlayerId) {
      console.warn(`Player ${playerId} attempted to clear canvas but is not the host`)
      return
    }

    // Cancel pending storage write to avoid racing with the delete
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }

    try {
      await this.storageDeleteWithRetry('strokes')
      this.strokes = []

      this.broadcast({
        type: 'clear',
      })
    } catch (e) {
      console.error(`Player ${playerId} failed to clear strokes:`, e)
    }
  }

  private async handleChat(ws: WebSocket, data: Message & { content: string }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Get player info from socket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (!attachment?.player) return

    // Rate limiting check (reuse existing pattern)
    if (!this.checkRateLimit(playerId, false)) {
      console.warn(`Chat rate limit exceeded for player ${playerId}`)
      return
    }

    // Validate message content
    const content = data.content
    if (!validateMessageContent(content)) {
      return
    }

    // Truncate if too long
    const sanitizedContent = sanitizeMessage(content)

    const now = Date.now()
    const chatMessage: ChatMessage = {
      id: crypto.randomUUID(),
      playerId,
      playerName: attachment.player.name,
      playerColor: attachment.player.color,
      content: sanitizedContent,
      timestamp: now,
    }

    // Add to history (keep last N messages)
    this.chatHistory.addMessage(chatMessage)
    await this.storagePutWithRetry('chatHistory', this.chatHistory.getMessages())

    // Broadcast to all players including sender
    this.broadcast({
      type: 'chat',
      message: chatMessage,
    })
  }

  private broadcast(message: object, exclude?: WebSocket) {
    const data = JSON.stringify(message)
    const deadSockets: WebSocket[] = []

    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(data)
        } catch (error) {
          // Only ignore InvalidStateError (connection closed between getting socket and sending)
          if (error instanceof DOMException && error.name === 'InvalidStateError') {
            deadSockets.push(ws)
            continue
          }
          console.error('Unexpected broadcast error:', error)
        }
      }
    }

    // Close dead connections to prevent accumulation
    for (const deadWs of deadSockets) {
      try {
        deadWs.close()
      } catch {
        // Ignore errors when closing
      }
    }
  }
}
