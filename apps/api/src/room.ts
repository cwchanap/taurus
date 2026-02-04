import { DurableObject } from 'cloudflare:workers'
import type { Player, Stroke, ChatMessage } from '@repo/types'
import { ChatHistory } from './chat-history'

interface Point {
  x: number
  y: number
}

interface Message {
  type: string
  [key: string]: unknown
}

interface WebSocketAttachment {
  playerId: string
  player: Player
}

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
  MAX_STROKE_POINTS,
  ROUND_DURATION_MS,
  MIN_PLAYERS_TO_START,
  DRAWER_BONUS_SCORE,
} from './constants'
import { getRandomWordExcluding } from './vocabulary'
import {
  type GameState,
  type PlayingState,
  type RoundEndState,
  createInitialGameState,
  scoresToRecord,
  type RoundResult,
} from './game-types'
import {
  validateMessageContent,
  sanitizeMessage,
  isValidPlayerName,
  isValidPoint,
  isValidStrokeId,
  validateStroke,
} from './validation'
import {
  calculateCorrectGuessScore,
  handlePlayerLeaveInActiveGame,
  findNextDrawer,
  clearTimers,
  type TimerContainer,
} from './game-logic'

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

  // Game state
  private gameState: GameState = createInitialGameState()
  private roundTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private roundEndTimer: ReturnType<typeof setTimeout> | null = null
  private gameEndTimer: ReturnType<typeof setTimeout> | null = null

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
        case 'start-game':
          await this.handleStartGame(ws)
          break
        case 'reset-game':
          await this.handleResetGame(ws)
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
    const name = isValidPlayerName(data.name) ? data.name.trim() : 'Anonymous'

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

    // If a game is in progress, add the player to the scores map so their name is captured
    if (this.gameState.status !== 'lobby' && !this.gameState.scores.has(playerId)) {
      this.gameState.scores.set(playerId, { score: 0, name: player.name })
    }

    // Add late joiners to roundGuessers to avoid early round end
    if (this.gameState.status === 'playing') {
      this.gameState.roundGuessers.add(playerId)
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
        isHost: playerId === this.hostPlayerId,
        gameState: {
          status: this.gameState.status,
          currentRound: this.gameState.currentRound,
          totalRounds: this.gameState.totalRounds,
          currentDrawerId: this.gameState.currentDrawerId,
          roundEndTime: this.gameState.roundEndTime,
          currentWord:
            playerId === this.gameState.currentDrawerId ? this.gameState.currentWord : undefined,
          wordLength: this.gameState.wordLength ?? undefined,
          scores: scoresToRecord(this.gameState.scores),
        },
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

      if (this.hostPlayerId) {
        this.broadcast({
          type: 'host-change',
          newHostId: this.hostPlayerId,
        })
      }
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

    // Handle game state when player leaves during active game
    if (this.gameState.status === 'playing' || this.gameState.status === 'round-end') {
      const remainingPlayers = this.getPlayers().filter((p) => p.id !== playerId)
      const remainingPlayerIds = remainingPlayers.map((p) => p.id)

      const result = handlePlayerLeaveInActiveGame(playerId, this.gameState, remainingPlayerIds)

      this.gameState = result.updatedGameState

      if (result.shouldEndGame) {
        this.endGame()
        return
      }

      if (result.shouldEndRound) {
        this.endRound(true)
      }
    }

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

    // During active game, only the current drawer can draw
    if (this.gameState.status === 'playing' && playerId !== this.gameState.currentDrawerId) {
      return
    }

    // Rate limiting check for new strokes (more restrictive than updates)
    if (!this.checkRateLimit(playerId, true)) {
      console.warn(`Rate limit exceeded for player ${playerId}`)
      return
    }

    await this.ensureInitialized()

    // Validate and create stroke
    const existingStrokeIds = new Set(this.strokes.map((s) => s.id))
    const stroke = validateStroke(data.stroke, playerId, existingStrokeIds)
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

    // During active game, only the current drawer can draw
    if (this.gameState.status === 'playing' && playerId !== this.gameState.currentDrawerId) {
      return
    }

    // Rate limiting check
    if (!this.checkRateLimit(playerId, false)) {
      console.warn(`Rate limit exceeded for player ${playerId}`)
      return
    }

    // Validate strokeId
    if (!isValidStrokeId(data.strokeId)) {
      console.warn(`Invalid strokeId received from player ${playerId}`)
      return
    }

    // Validate incoming point data
    if (!isValidPoint(data.point)) {
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

    // Check for correct guess during active game
    if (this.gameState.status === 'playing' && this.gameState.currentWord) {
      const isCorrectWord =
        sanitizedContent.toLowerCase() === this.gameState.currentWord.toLowerCase()

      if (isCorrectWord) {
        // If drawer or already correct, suppress message to avoid leaking word
        if (
          playerId === this.gameState.currentDrawerId ||
          this.gameState.correctGuessers.has(playerId)
        ) {
          return
        }

        // Handle first-time correct guess
        this.handleCorrectGuess(playerId, attachment.player.name)
        // Don't broadcast the correct answer to prevent revealing it
        return
      }
    }

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

  // ==================== GAME LOGIC ====================

  /**
   * Handle start-game message from host
   */
  private async handleStartGame(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Only host can start the game
    if (playerId !== this.hostPlayerId) {
      console.warn(`Player ${playerId} attempted to start game but is not the host`)
      return
    }

    // Can only start from lobby
    if (this.gameState.status !== 'lobby') {
      console.warn(`Cannot start game: game is already in status ${this.gameState.status}`)
      return
    }

    const players = this.getPlayers()
    if (players.length < MIN_PLAYERS_TO_START) {
      console.warn(`Cannot start game: need at least ${MIN_PLAYERS_TO_START} players`)
      return
    }

    // Initialize game state
    const playerIds = players.map((p) => p.id)
    // Shuffle player order for drawing
    // Shuffle player order for drawing (Fisher-Yates)
    const shuffledOrder = [...playerIds]
    for (let i = shuffledOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]]
    }

    this.gameState = {
      status: 'lobby',
      currentRound: 0,
      totalRounds: shuffledOrder.length,
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      drawerOrder: shuffledOrder,
      scores: new Map(playerIds.map((id) => [id, { score: 0, name: this.getPlayerName(id) }])),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
    }

    // Broadcast game started
    this.broadcast({
      type: 'game-started',
      totalRounds: this.gameState.totalRounds,
      drawerOrder: this.gameState.drawerOrder,
      scores: scoresToRecord(this.gameState.scores),
    })

    // Start first round
    this.startRound()
  }

  /**
   * Handle reset-game message from host
   */
  private async handleResetGame(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Only host can reset the game
    if (playerId !== this.hostPlayerId) {
      console.warn(`Player ${playerId} attempted to reset game but is not the host`)
      return
    }

    // Clear any active timers before resetting state
    this.clearTimers()

    // Reset to lobby state
    this.gameState = createInitialGameState()

    // Clear strokes and storage to prevent stale canvas on next game
    this.strokes = []
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.ctx.waitUntil(this.storageDeleteWithRetry('strokes'))

    // Broadcast reset to all players
    this.broadcast({
      type: 'game-reset',
    })
  }

  /**
   * Start a new round
   */
  private startRound() {
    // Get next connected drawer
    let drawerId: string | null = null
    let drawerName = ''
    const connectedPlayers = new Set(this.getPlayers().map((p) => p.id))

    // Find next valid drawer
    const { drawerId: nextDrawerId, roundNumber } = findNextDrawer(
      this.gameState.currentRound,
      this.gameState.drawerOrder,
      connectedPlayers
    )

    if (nextDrawerId) {
      drawerId = nextDrawerId
      drawerName = this.getPlayerName(nextDrawerId)
      this.gameState.currentRound = roundNumber
    }

    if (!drawerId) {
      this.endGame()
      return
    }

    // Pick a random word
    const word = getRandomWordExcluding(this.gameState.usedWords)
    this.gameState.usedWords.add(word)

    // Set round state
    const now = Date.now()

    // Transition to PlayingState
    // We cast to PlayingState because we are providing all required fields
    this.gameState = {
      ...this.gameState,
      status: 'playing',
      currentDrawerId: drawerId,
      currentWord: word,
      wordLength: word.length,
      roundStartTime: now,
      roundEndTime: now + ROUND_DURATION_MS,
      correctGuessers: new Set(),
      roundGuessers: new Set(
        this.getPlayers()
          .map((p) => p.id)
          .filter((id) => id !== drawerId)
      ),
      roundGuesserScores: new Map(),
      endGameAfterCurrentRound:
        'endGameAfterCurrentRound' in this.gameState
          ? this.gameState.endGameAfterCurrentRound
          : false,
    } as PlayingState

    // Clear canvas for new round
    this.strokes = []
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.ctx.waitUntil(this.storageDeleteWithRetry('strokes'))

    // Broadcast round start to all players
    // Note: Send word only to the drawer
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
      if (attachment?.playerId) {
        ws.send(
          JSON.stringify({
            type: 'round-start',
            roundNumber: this.gameState.currentRound,
            totalRounds: this.gameState.totalRounds,
            drawerId,
            drawerName,
            word: attachment.playerId === drawerId ? word : undefined,
            wordLength: word.length,
            endTime: this.gameState.roundEndTime,
          })
        )
      }
    }

    // Broadcast canvas clear
    this.broadcast({ type: 'clear' })

    // Set round timer
    this.clearTimers()
    this.roundTimer = setTimeout(() => {
      this.endRound(false)
    }, ROUND_DURATION_MS)

    // Set tick timer for countdown
    this.tickTimer = setInterval(() => {
      const remaining = Math.max(0, (this.gameState.roundEndTime || 0) - Date.now())
      if (remaining > 0) {
        this.broadcast({
          type: 'tick',
          timeRemaining: Math.ceil(remaining / 1000),
        })
      }
    }, 1000)
  }

  /**
   * End the current round
   * @param skipToNext If true, immediately start next round (e.g., when drawer leaves)
   */
  private endRound(skipToNext: boolean) {
    this.clearTimers()

    if (this.gameState.status !== 'playing') return

    const drawerId = this.gameState.currentDrawerId
    const word = this.gameState.currentWord

    if (!drawerId || !word) return

    // Calculate drawer bonus if someone guessed correctly
    let drawerScore = 0
    if (this.gameState.correctGuessers.size > 0) {
      drawerScore = DRAWER_BONUS_SCORE * this.gameState.correctGuessers.size
      const scoreInfo = this.gameState.scores.get(drawerId)
      if (scoreInfo) {
        scoreInfo.score += drawerScore
      } else {
        // Fallback if drawer wasn't in scores for some reason
        this.gameState.scores.set(drawerId, {
          score: drawerScore,
          name: this.getPlayerName(drawerId),
        })
      }
    }

    // Build round result
    const result: RoundResult = {
      drawerId,
      drawerName: this.getPlayerName(drawerId),
      word,
      correctGuessers: Array.from(this.gameState.correctGuessers).map((id) => ({
        playerId: id,
        playerName: this.getPlayerName(id),
        score: this.gameState.roundGuesserScores.get(id) ?? 0,
      })),
      drawerScore,
    }

    // Broadcast round end
    this.broadcast({
      type: 'round-end',
      word,
      result,
      scores: scoresToRecord(this.gameState.scores),
    })

    // Update status temporarily
    // Update status temporarily
    this.gameState = {
      ...this.gameState,
      status: 'round-end',
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
    } as RoundEndState

    // Check if game should end
    const shouldEnd =
      this.gameState.currentRound >= this.gameState.totalRounds ||
      ('endGameAfterCurrentRound' in this.gameState && this.gameState.endGameAfterCurrentRound)

    if (shouldEnd) {
      // Give a short delay before showing final results
      if (this.gameEndTimer) {
        clearTimeout(this.gameEndTimer)
      }
      this.gameEndTimer = setTimeout(() => this.endGame(), 3000)
      return
    }

    // Start next round after delay (unless skipping)
    if (skipToNext) {
      this.startRound()
    } else {
      if (this.roundEndTimer) {
        clearTimeout(this.roundEndTimer)
      }
      this.roundEndTimer = setTimeout(() => {
        if (this.gameState.status === 'round-end') {
          this.startRound()
        }
      }, 5000) // 5 second break between rounds
    }
  }

  /**
   * End the game and broadcast final results
   */
  private endGame() {
    this.clearTimers()

    // Find winner
    // Find winners (handle ties)
    let winners: { playerId: string; playerName: string; score: number }[] = []
    let highestScore = -1
    const activePlayerIds = new Set(this.getPlayers().map((player) => player.id))

    for (const [playerId, scoreInfo] of this.gameState.scores) {
      if (!activePlayerIds.has(playerId)) {
        continue
      }

      if (scoreInfo.score > highestScore) {
        highestScore = scoreInfo.score
        winners = [
          {
            playerId,
            playerName: scoreInfo.name,
            score: scoreInfo.score,
          },
        ]
      } else if (scoreInfo.score === highestScore) {
        winners.push({
          playerId,
          playerName: scoreInfo.name,
          score: scoreInfo.score,
        })
      }
    }

    // Broadcast game over
    this.broadcast({
      type: 'game-over',
      finalScores: scoresToRecord(this.gameState.scores),
      winners,
    })

    // Reset to lobby state
    this.gameState = createInitialGameState()
  }

  /**
   * Handle a correct guess from a player
   */
  private handleCorrectGuess(playerId: string, playerName: string) {
    if (!this.gameState.roundEndTime || !this.gameState.currentWord) return

    // Mark player as having guessed correctly
    this.gameState.correctGuessers.add(playerId)

    // Calculate time-based score using extracted function
    const score = calculateCorrectGuessScore(this.gameState.roundEndTime)

    // Update player score
    const scoreInfo = this.gameState.scores.get(playerId)
    if (scoreInfo) {
      scoreInfo.score += score
    } else {
      this.gameState.scores.set(playerId, { score, name: playerName })
    }
    this.gameState.roundGuesserScores.set(playerId, score)

    // Calculate time remaining for notification
    const timeRemaining = Math.max(0, this.gameState.roundEndTime - Date.now())

    // Broadcast correct guess notification
    this.broadcast({
      type: 'correct-guess',
      playerId,
      playerName,
      score,
      timeRemaining: Math.ceil(timeRemaining / 1000),
    })

    // Check if all non-drawer players have guessed
    if (this.gameState.correctGuessers.size >= this.gameState.roundGuessers.size) {
      // Everyone guessed, end round early
      this.endRound(false)
    }
  }

  /**
   * Clear all game-related timers
   */
  private clearTimers() {
    clearTimers(this as unknown as TimerContainer)
  }

  /**
   * Get player name by ID
   */
  private getPlayerName(playerId: string): string {
    const players = this.getPlayers()
    const player = players.find((p) => p.id === playerId)
    return player?.name || 'Unknown'
  }
}
