import { DurableObject } from 'cloudflare:workers'
import type { Player, Stroke, FillOperation, ChatMessage } from '@repo/types'
import { PALETTE_COLORS } from '@repo/types'
import { ChatHistory } from './chat-history'
import { gameStateToWire } from './game-types'

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
  GAME_END_TRANSITION_DELAY,
  ROUND_END_TRANSITION_DELAY,
  SKIP_ROUND_TRANSITION_DELAY,
} from './constants'
import { getRandomWordExcluding } from './vocabulary'
import {
  type GameState,
  type PlayingState,
  type RoundEndState,
  type GameOverState,
  createInitialGameState,
  scoresToRecord,
  type RoundResult,
  isPlayingState,
  gameStateToStorage,
  gameStateFromStorage,
  type StoredGameState,
} from './game-types'
import {
  validateMessageContent,
  sanitizeMessage,
  isValidPlayerName,
  isValidPoint,
  isValidStrokeId,
  isValidDrawingId,
  validateStroke,
  validateFill,
} from './validation'
import {
  calculateCorrectGuessScore,
  handlePlayerLeaveInActiveGame,
  findNextDrawer,
  clearTimers,
  isCorrectGuess,
  containsCurrentWord,
  type TimerContainer,
  checkMessageRateLimit,
  checkStrokeRateLimit,
  checkStrokeUpdateRateLimit,
  type RateLimitState,
} from './game-logic'

export class DrawingRoom extends DurableObject<CloudflareBindings> implements TimerContainer {
  private strokes: Stroke[] = []
  private fills: FillOperation[] = []
  private initialized = false
  private created = false
  private hostPlayerId: string | null = null
  private storageWriteTimer: ReturnType<typeof setTimeout> | null = null
  private storageWriteDelay = 1000 // 1s debounce balances persistence reliability with write frequency
  private strokeStorageQueue: Promise<void> = Promise.resolve() // Serialize stroke storage write/delete ops
  private pendingStrokeWrite: Promise<void> | null = null // Track latest in-flight stroke storage operation
  private fillStorageQueue: Promise<void> = Promise.resolve() // Serialize fill storage write/delete ops
  private pendingFillWrite: Promise<void> | null = null // Track latest in-flight fill storage operation
  private strokeStorageDirty = false
  private fillStorageDirty = false

  // Sliding window rate limiting
  private playerMessageTimestamps: Map<string, RateLimitState> = new Map()
  private playerStrokeTimestamps: Map<string, RateLimitState> = new Map()
  private playerStrokeUpdateTimestamps: Map<string, RateLimitState> = new Map()

  // Track players being cleaned up to prevent duplicate leave broadcasts
  private cleanedPlayers = new Set<string>()

  // Chat history manager
  private chatHistory = new ChatHistory()

  // Monotonic counter for stable cross-operation ordering (strokes vs fills)
  private operationSeq = 0

  // Game state
  private gameState: GameState = createInitialGameState()
  roundTimer: ReturnType<typeof setTimeout> | null = null
  tickTimer: ReturnType<typeof setInterval> | null = null
  roundEndTimer: ReturnType<typeof setTimeout> | null = null
  gameEndTimer: ReturnType<typeof setTimeout> | null = null

  private async ensureInitialized() {
    if (!this.initialized) {
      const storedStrokes = (await this.ctx.storage.get<Stroke[]>('strokes')) || []
      this.strokes = storedStrokes.map((stroke, index) => {
        const withTimestamp =
          typeof stroke.timestamp === 'number' && Number.isFinite(stroke.timestamp)
            ? stroke
            : { ...stroke, timestamp: index }

        // Normalize legacy colors that predate PALETTE_COLORS enforcement so that
        // undo/redo remains functional: redo re-sends the stored stroke color through
        // validateStroke(), which now rejects non-palette values.
        const color = (PALETTE_COLORS as readonly string[]).includes(withTimestamp.color as string)
          ? withTimestamp.color
          : ('#1a1a2e' as const) // fall back to darkest palette color

        return { ...withTimestamp, color }
      })
      this.fills = (await this.ctx.storage.get<FillOperation[]>('fills')) || []

      // Initialize seq counter above the max of any stored seq values so new operations
      // always sort after restored ones, even across Durable Object restarts.
      const maxStrokeSeq = Math.max(0, ...this.strokes.map((s) => s.seq ?? 0))
      const maxFillSeq = Math.max(0, ...this.fills.map((f) => f.seq ?? 0))
      this.operationSeq = Math.max(maxStrokeSeq, maxFillSeq)

      this.created = (await this.ctx.storage.get<boolean>('created')) || false
      const storedChatHistory = (await this.ctx.storage.get<ChatMessage[]>('chatHistory')) || []
      this.chatHistory.setMessages(storedChatHistory)

      // Restore hostPlayerId (may be null if no host assigned yet)
      this.hostPlayerId = (await this.ctx.storage.get<string>('hostPlayerId')) || null

      // Restore gameState if it was persisted
      const storedGameState = await this.ctx.storage.get<StoredGameState>('gameState')
      if (storedGameState) {
        try {
          this.gameState = gameStateFromStorage(storedGameState)
        } catch (e) {
          console.error('Failed to restore gameState from storage:', e)
          this.gameState = createInitialGameState()
        }
      }

      // Defensive: auto-set created flag if orphaned data exists without it
      if (
        !this.created &&
        (this.strokes.length > 0 ||
          this.fills.length > 0 ||
          this.chatHistory.getMessages().length > 0)
      ) {
        this.created = true
        await this.storagePutWithRetry('created', true)
      }

      // Set initialized flag BEFORE resuming game flow to prevent reentrancy
      // into ensureInitialized() if resumeGameFlowFromState() synchronously
      // triggers handlers like endRound()
      this.initialized = true

      // Always resume game flow if in an active state, regardless of socket count.
      // This handles cold Durable Object restarts where the first reconnect arrives
      // via /ws before any socket is accepted (getWebSockets() returns empty array).
      // Without this, games in 'playing' or 'round-end' states would remain stuck
      // indefinitely until another state-changing event occurs.
      if (this.gameState.status === 'playing' || this.gameState.status === 'round-end') {
        this.resumeGameFlowFromState()
      }
    }
  }

  /**
   * Reconstruct game timers from persisted state after Durable Object hibernation.
   * Called when the DO wakes with active WebSocket connections. Resumes round timers
   * based on stored roundEndTime so rounds can continue or end as expected.
   */
  private resumeGameFlowFromState() {
    if (this.gameState.status === 'playing') {
      const endTime = this.gameState.roundEndTime ?? 0
      const remainingMs = endTime - Date.now()

      if (remainingMs <= 0) {
        this.endRound(false)
        return
      }

      this.clearTimers()

      this.roundTimer = setTimeout(() => {
        this.endRound(false)
      }, remainingMs)

      this.tickTimer = setInterval(() => {
        const remaining = Math.max(0, (this.gameState.roundEndTime || 0) - Date.now())
        if (remaining > 0) {
          this.broadcast({
            type: 'tick',
            timeRemaining: Math.ceil(remaining / 1000),
          })
        }
      }, 1000)

      return
    }

    if (this.gameState.status === 'round-end') {
      const shouldEnd =
        this.gameState.currentRound >= this.gameState.totalRounds ||
        this.gameState.endGameAfterCurrentRound === true

      this.clearTimers()

      // Calculate remaining delay based on stored nextTransitionAt
      // Fall back to appropriate full delay if nextTransitionAt is missing
      const now = Date.now()
      const nextTransitionAt = (this.gameState as RoundEndState).nextTransitionAt
      const fallbackDelay = shouldEnd ? GAME_END_TRANSITION_DELAY : ROUND_END_TRANSITION_DELAY
      const remainingDelay = nextTransitionAt ? Math.max(0, nextTransitionAt - now) : fallbackDelay

      if (shouldEnd) {
        this.gameEndTimer = setTimeout(() => this.endGame(), remainingDelay)
      } else {
        this.roundEndTimer = setTimeout(() => {
          if (this.gameState.status === 'round-end') {
            this.startRound()
          }
        }, remainingDelay)
      }
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

  private async persistGameState(): Promise<void> {
    await this.storagePutWithRetry('gameState', gameStateToStorage(this.gameState))
  }

  private async persistHost(): Promise<void> {
    if (this.hostPlayerId) {
      await this.storagePutWithRetry('hostPlayerId', this.hostPlayerId)
    } else {
      await this.storageDeleteWithRetry('hostPlayerId')
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

  private enqueueStrokeStorageOperation(operation: () => Promise<void>): Promise<void> {
    const op = this.strokeStorageQueue.then(operation, operation)
    this.strokeStorageQueue = op.catch((e) => {
      console.error('Stroke storage queue operation failed, continuing queue:', e)
    })
    return op
  }

  private queueStrokeWrite(): Promise<void> {
    return this.enqueueStrokeStorageOperation(() =>
      this.storagePutWithRetry('strokes', this.strokes)
    )
  }

  private queueStrokeDelete(): Promise<void> {
    return this.enqueueStrokeStorageOperation(() => this.storageDeleteWithRetry('strokes'))
  }

  private enqueueFillStorageOperation(operation: () => Promise<void>): Promise<void> {
    const op = this.fillStorageQueue.then(operation, operation)
    this.fillStorageQueue = op.catch((e) => {
      console.error('Fill storage queue operation failed, continuing queue:', e)
    })
    return op
  }

  private queueFillWrite(): Promise<void> {
    return this.enqueueFillStorageOperation(() => this.storagePutWithRetry('fills', this.fills))
  }

  private queueFillDelete(): Promise<void> {
    return this.enqueueFillStorageOperation(() => this.storageDeleteWithRetry('fills'))
  }

  private scheduleStorageWrite(kind: 'strokes' | 'fills') {
    if (kind === 'strokes') {
      this.strokeStorageDirty = true
    } else {
      this.fillStorageDirty = true
    }

    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
    }

    this.storageWriteTimer = setTimeout(() => {
      try {
        this.storageWriteTimer = null
        const pendingWrites: Promise<void>[] = []

        if (this.strokeStorageDirty) {
          this.strokeStorageDirty = false
          this.pendingStrokeWrite = this.queueStrokeWrite()
            .catch((e) => {
              console.error('Background stroke storage save failed:', e)
              throw e
            })
            .finally(() => {
              this.pendingStrokeWrite = null
            })
          pendingWrites.push(this.pendingStrokeWrite)
        }

        if (this.fillStorageDirty) {
          this.fillStorageDirty = false
          this.pendingFillWrite = this.queueFillWrite()
            .catch((e) => {
              console.error('Background fill storage save failed:', e)
              throw e
            })
            .finally(() => {
              this.pendingFillWrite = null
            })
          pendingWrites.push(this.pendingFillWrite)
        }

        if (pendingWrites.length > 0) {
          this.ctx.waitUntil(
            Promise.all(pendingWrites)
              .then(() => undefined)
              .catch((e) => {
                console.error('Deferred canvas storage write failed permanently:', e)
              })
          )
        }
      } catch (e) {
        console.error('scheduleStorageWrite: Unexpected synchronous error in deferred write:', e)
      }
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
      // Rooms must be created via POST /api/rooms before WebSocket connections are accepted
      if (!this.created) {
        return new Response('Room not found', { status: 404 })
      }

      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
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
    // Ensure state is restored from storage after potential hibernation
    try {
      await this.ensureInitialized()
    } catch (e) {
      console.error('Failed to initialize room state from storage:', e)
      try {
        ws.send(
          JSON.stringify({ type: 'error', message: 'Room state unavailable. Please reconnect.' })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

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
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
      } catch {
        // Connection may be closed
      }
      return
    }

    // Handle message - each handler gets its own try-catch for targeted error responses
    const sendError = (msg: string) => {
      try {
        ws.send(JSON.stringify({ type: 'error', action: data.type, message: msg }))
      } catch {
        // Connection may be closed
      }
    }

    switch (data.type) {
      case 'join':
        try {
          await this.handleJoin(ws, data as Message & { name: string })
        } catch (e) {
          console.error('Handler error for join:', e)
          sendError('Failed to join room')
        }
        break
      case 'stroke':
        try {
          await this.handleStroke(ws, data as Message & { stroke: Stroke })
        } catch (e) {
          console.error('Handler error for stroke:', e)
          sendError('Failed to process stroke')
        }
        break
      case 'stroke-update':
        try {
          await this.handleStrokeUpdate(ws, data as Message & { strokeId: string; point: Point })
        } catch (e) {
          console.error('Handler error for stroke-update:', e)
          sendError('Failed to process stroke update')
        }
        break
      case 'clear':
        try {
          await this.handleClear(ws)
        } catch (e) {
          console.error('Handler error for clear:', e)
          sendError('Failed to clear canvas')
        }
        break
      case 'chat':
        try {
          await this.handleChat(ws, data as Message & { content: string })
        } catch (e) {
          console.error('Handler error for chat:', e)
          sendError('Failed to send message')
        }
        break
      case 'start-game':
        try {
          await this.handleStartGame(ws)
        } catch (e) {
          console.error('Handler error for start-game:', e)
          sendError('Failed to start game')
        }
        break
      case 'reset-game':
        try {
          await this.handleResetGame(ws)
        } catch (e) {
          console.error('Handler error for reset-game:', e)
          sendError('Failed to reset game')
        }
        break
      case 'undo-stroke':
        try {
          await this.handleUndoStroke(ws, data as Message & { strokeId: string })
        } catch (e) {
          console.error('Handler error for undo-stroke:', e)
          sendError('Failed to undo stroke')
        }
        break
      case 'undo-fill':
        try {
          await this.handleUndoFill(ws, data as Message & { fillId: string })
        } catch (e) {
          console.error('Handler error for undo-fill:', e)
          sendError('Failed to undo fill')
        }
        break
      case 'fill':
        try {
          await this.handleFill(ws, data as Message & { x: number; y: number; color: string })
        } catch (e) {
          console.error('Handler error for fill:', e)
          sendError('Failed to process fill')
        }
        break
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      await this.ensureInitialized()
    } catch (e) {
      console.error('ensureInitialized failed in webSocketClose:', e)
      // Must still run handleLeave even if init failed to clean up player state
    }
    this.handleLeave(ws)
  }

  async webSocketError(ws: WebSocket) {
    try {
      await this.ensureInitialized()
    } catch (e) {
      console.error('ensureInitialized failed in webSocketError:', e)
      // Must still run handleLeave even if init failed
    }
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
      await this.persistHost()
    }

    // If a game is in progress (but not game-over), add the player to the scores map
    // so their name is captured. Late joiners during game-over should not affect final scores.
    const isActiveGame = ['starting', 'playing', 'round-end'].includes(this.gameState.status)
    if (isActiveGame && !this.gameState.scores.has(playerId)) {
      this.gameState.scores.set(playerId, { score: 0, name: player.name })
    }

    // Add late joiners to roundGuessers so "all guessed" check doesn't trigger early round end.
    // They can guess but won't affect existing players' score calculations.
    if (this.gameState.status === 'playing') {
      this.gameState.roundGuessers.add(playerId)
      // Persist updated game state with late joiner data
      this.ctx.waitUntil(
        this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
      )
    }

    // Send current state to the new player (include existing players)
    await this.ensureInitialized()

    try {
      ws.send(
        JSON.stringify({
          type: 'init',
          playerId,
          player,
          players: [...existingPlayers, player],
          strokes: this.strokes,
          fills: this.fills,
          chatHistory: this.chatHistory.getMessages(),
          isHost: playerId === this.hostPlayerId,
          gameState: gameStateToWire(this.gameState, playerId === this.gameState.currentDrawerId),
        })
      )
    } catch (e) {
      if (e instanceof DOMException && e.name === 'InvalidStateError') {
        console.warn(`Failed to send init to player ${playerId}: socket already closed`)
        this.handleLeave(ws)
        return
      }
      console.error('Unexpected error sending init message:', e)
      throw e
    }

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
      // Persist host change to storage (fire and forget via waitUntil)
      this.ctx.waitUntil(
        this.persistHost().catch((e) => console.error('Failed to persist host:', e))
      )
    }

    this.broadcast({
      type: 'player-left',
      playerId,
    })

    // Clean up rate limiting data
    this.playerMessageTimestamps.delete(playerId)
    this.playerStrokeTimestamps.delete(playerId)
    this.playerStrokeUpdateTimestamps.delete(playerId)

    // Handle game state when player leaves during active game
    if (this.gameState.status === 'playing' || this.gameState.status === 'round-end') {
      const remainingPlayers = this.getPlayers().filter((p) => p.id !== playerId)
      const remainingPlayerIds = remainingPlayers.map((p) => p.id)

      const result = handlePlayerLeaveInActiveGame(playerId, this.gameState, remainingPlayerIds)

      this.gameState = result.updatedGameState

      // Clean up flag after a short delay to prevent race conditions with duplicate close events
      setTimeout(() => this.cleanedPlayers.delete(playerId), 1000)

      if (result.shouldEndGame) {
        // endGame() will persist the terminal state, so we don't schedule a pre-transition persist here
        this.endGame()
        return
      }

      if (result.shouldEndRound) {
        // endRound() will persist the terminal state, so we don't schedule a pre-transition persist here
        this.endRound(true)
        return
      }

      // Only persist game state if the game continues (not when ending game/round)
      // This prevents race conditions where pre-transition writes overwrite terminal state
      this.ctx.waitUntil(
        this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
      )

      // Check if all remaining guessers have guessed correctly (early round end)
      if (!result.shouldEndRound && isPlayingState(this.gameState)) {
        if (this.gameState.correctGuessers.size >= this.gameState.roundGuessers.size) {
          this.endRound(false)
        }
      }
    } else {
      // Clean up flag after a short delay to prevent race conditions with duplicate close events
      setTimeout(() => this.cleanedPlayers.delete(playerId), 1000)
    }
  }

  /**
   * Checks and updates rate limits for a player using tested pure functions.
   * @param playerId The player ID
   * @param isNewStroke Whether this message counts as a new stroke
   * @returns true if allowed, false if rate limited
   */
  private checkRateLimit(playerId: string, isNewStroke: boolean): boolean {
    const now = Date.now()

    if (isNewStroke) {
      let strokeState = this.playerStrokeTimestamps.get(playerId)
      if (!strokeState) {
        strokeState = { timestamps: [] }
      }

      const strokeResult = checkStrokeRateLimit(strokeState, now)
      if (!strokeResult.allowed) {
        return false
      }

      // Update stroke state
      this.playerStrokeTimestamps.set(playerId, strokeResult.updatedState)

      return true
    }

    // Chat/messages use their own independent quota
    let messageState = this.playerMessageTimestamps.get(playerId)
    if (!messageState) {
      messageState = { timestamps: [] }
    }

    const messageResult = checkMessageRateLimit(messageState, now)
    if (!messageResult.allowed) {
      return false
    }

    this.playerMessageTimestamps.set(playerId, messageResult.updatedState)

    return true
  }

  private async handleStroke(ws: WebSocket, data: Message & { stroke: Stroke }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Only allow drawing during active 'playing' state
    if (this.gameState.status !== 'playing') {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'stroke',
            message: 'Drawing failed: game is not in progress',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }
    // Only the current drawer can draw
    if (playerId !== this.gameState.currentDrawerId) {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'stroke',
            message: 'Drawing failed: only the current drawer can draw',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    // Rate limiting check for new strokes (more restrictive than updates)
    if (!this.checkRateLimit(playerId, true)) {
      console.warn(`Rate limit exceeded for player ${playerId}`)
      try {
        ws.send(JSON.stringify({ type: 'error', action: 'stroke', message: 'Rate limit exceeded' }))
      } catch {
        // Connection may be closed
      }
      return
    }

    await this.ensureInitialized()

    // Validate and create stroke
    const existingStrokeIds = new Set(this.strokes.map((s) => s.id))
    const rawStroke = validateStroke(data.stroke, playerId, existingStrokeIds)
    if (!rawStroke) {
      console.warn(`Invalid stroke data received from player ${playerId}`)
      return
    }
    const stroke: Stroke = { ...rawStroke, seq: ++this.operationSeq }

    this.strokes.push(stroke)
    // Schedule debounced storage write
    this.scheduleStorageWrite('strokes')

    // Broadcast to ALL players (including sender) so that:
    // 1. New strokes are echoed back for confirmation
    // 2. Redo strokes are properly synchronized (client doesn't optimistically add for redo)
    this.broadcast({
      type: 'stroke',
      stroke,
    })
  }

  private async handleStrokeUpdate(
    ws: WebSocket,
    data: Message & { strokeId: string; point: Point }
  ) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // Only allow drawing during active 'playing' state
    if (this.gameState.status !== 'playing') {
      return
    }
    // Only the current drawer can draw
    if (playerId !== this.gameState.currentDrawerId) {
      return
    }

    // Stroke-update uses its own rate limit (bypasses general message limit) since
    // point updates fire at 30-60 Hz during active drawing
    let strokeUpdateState = this.playerStrokeUpdateTimestamps.get(playerId)
    if (!strokeUpdateState) {
      strokeUpdateState = { timestamps: [] }
    }
    const now = Date.now()
    const strokeUpdateResult = checkStrokeUpdateRateLimit(strokeUpdateState, now)
    if (!strokeUpdateResult.allowed) {
      console.warn(`Stroke update rate limit exceeded for player ${playerId}`)
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
      } catch {
        // Connection may be closed
      }
      return
    }
    // Update stroke update state
    this.playerStrokeUpdateTimestamps.set(playerId, strokeUpdateResult.updatedState)

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

    const trimmedStrokeId = data.strokeId.trim()
    const stroke = this.strokes.find((s) => s.id === trimmedStrokeId && s.playerId === playerId)
    if (stroke) {
      // Check if stroke has reached maximum points
      if (stroke.points.length >= MAX_STROKE_POINTS) {
        console.warn(`Stroke ${trimmedStrokeId} has reached maximum points limit`)
        return
      }

      stroke.points.push(data.point)

      // Schedule debounced storage write
      this.scheduleStorageWrite('strokes')

      this.broadcast(
        {
          type: 'stroke-update',
          strokeId: trimmedStrokeId,
          point: data.point,
        },
        ws
      )
    }
  }

  private async handleClear(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    // During playing state, only the current drawer can clear
    // In lobby/other states, the host can clear
    const isDrawer =
      this.gameState.status === 'playing' && playerId === this.gameState.currentDrawerId
    if (this.gameState.status === 'playing') {
      if (!isDrawer) {
        console.warn(`Player ${playerId} attempted to clear canvas but is not the current drawer`)
        return
      }
    } else {
      if (playerId !== this.hostPlayerId) {
        console.warn(`Player ${playerId} attempted to clear canvas but is not the host`)
        return
      }
    }

    // Cancel pending storage write to avoid racing with the delete
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.strokeStorageDirty = false
    this.fillStorageDirty = false

    // Clear in-memory arrays immediately - broadcast happens after async storage ops
    // so we must clear before any player can see the cleared canvas
    this.strokes = []
    this.fills = []

    // Async storage deletion - errors will mark storage as dirty for retry
    const strokeDeletePromise = this.queueStrokeDelete().catch((e) => {
      console.error('Failed to delete strokes from storage:', e)
      // Re-mark as dirty so the next storage write will retry
      this.strokeStorageDirty = true
      this.scheduleStorageWrite('strokes')
    })

    const fillDeletePromise = this.queueFillDelete().catch((e) => {
      console.error('Failed to delete fills from storage:', e)
      // Re-mark as dirty so the next storage write will retry
      this.fillStorageDirty = true
      this.scheduleStorageWrite('fills')
    })

    this.ctx.waitUntil(strokeDeletePromise)
    this.ctx.waitUntil(fillDeletePromise)

    // Broadcast clear to all players after in-memory state is cleared
    this.broadcast({
      type: 'clear',
    })
  }

  private async handleUndoStroke(ws: WebSocket, data: Message & { strokeId: string }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    if (this.gameState.status !== 'playing') {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-stroke',
            message: 'Undo failed: game is not in progress',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    if (playerId !== this.gameState.currentDrawerId) {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-stroke',
            message: 'Undo failed: only the current drawer can undo',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    if (!isValidDrawingId(data.strokeId)) {
      console.warn(`Invalid strokeId in undo-stroke from player ${playerId}`)
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-stroke',
            message: 'Undo failed: invalid stroke ID',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    const trimmedId = data.strokeId.trim()
    const idx = this.strokes.findLastIndex((s) => s.id === trimmedId && s.playerId === playerId)
    if (idx === -1) {
      console.warn(`Stroke ${trimmedId} not found for undo by player ${playerId}`)
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-stroke',
            message: 'Undo failed: stroke not found. Canvas may be out of sync.',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    // Enforce LIFO semantics across strokes AND fills: only the most recent drawing operation can be undone
    const mostRecentStrokeIdx = this.strokes.findLastIndex((s) => s.playerId === playerId)
    const strokeToUndo = this.strokes[idx]
    const mostRecentFill = this.fills.findLast((f) => f.playerId === playerId)
    const hasNewerFill =
      mostRecentFill !== undefined &&
      (mostRecentFill.seq ?? mostRecentFill.timestamp) >=
        (strokeToUndo.seq ?? strokeToUndo.timestamp)
    if (idx !== mostRecentStrokeIdx || hasNewerFill) {
      console.warn(
        `Attempted to undo non-most-recent stroke ${trimmedId} by player ${playerId} (most recent stroke index: ${mostRecentStrokeIdx}, requested index: ${idx}, has newer fill: ${hasNewerFill})`
      )
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-stroke',
            message: 'Undo failed: can only undo the most recent operation',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    this.strokes.splice(idx, 1)
    this.scheduleStorageWrite('strokes')

    this.broadcast({ type: 'stroke-removed', strokeId: trimmedId })
  }

  private async handleUndoFill(ws: WebSocket, data: Message & { fillId: string }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    if (this.gameState.status !== 'playing') {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-fill',
            message: 'Undo failed: game is not in progress',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    if (playerId !== this.gameState.currentDrawerId) {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-fill',
            message: 'Undo failed: only the current drawer can undo',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    if (!isValidDrawingId(data.fillId)) {
      console.warn(`Invalid fillId in undo-fill from player ${playerId}`)
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-fill',
            message: 'Undo failed: invalid fill ID',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    const trimmedId = data.fillId.trim()
    const idx = this.fills.findLastIndex((f) => f.id === trimmedId && f.playerId === playerId)
    if (idx === -1) {
      console.warn(`Fill ${trimmedId} not found for undo by player ${playerId}`)
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-fill',
            message: 'Undo failed: fill not found. Canvas may be out of sync.',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    // Enforce LIFO semantics across strokes AND fills: only the most recent drawing operation can be undone
    const mostRecentFillIdx = this.fills.findLastIndex((f) => f.playerId === playerId)
    const fillToUndo = this.fills[idx]
    const mostRecentStroke = this.strokes.findLast((s) => s.playerId === playerId)
    const hasNewerStroke =
      mostRecentStroke !== undefined &&
      (mostRecentStroke.seq ?? mostRecentStroke.timestamp) >=
        (fillToUndo.seq ?? fillToUndo.timestamp)
    if (idx !== mostRecentFillIdx || hasNewerStroke) {
      console.warn(
        `Attempted to undo non-most-recent fill ${trimmedId} by player ${playerId} (most recent fill index: ${mostRecentFillIdx}, requested index: ${idx}, has newer stroke: ${hasNewerStroke})`
      )
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'undo-fill',
            message: 'Undo failed: can only undo the most recent operation',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    this.fills.splice(idx, 1)
    this.scheduleStorageWrite('fills')

    this.broadcast({ type: 'fill-removed', fillId: trimmedId })
  }

  private async handleFill(ws: WebSocket, data: Message & { x: number; y: number; color: string }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    if (this.gameState.status !== 'playing') {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'fill',
            message: 'Fill failed: game is not in progress',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }
    if (playerId !== this.gameState.currentDrawerId) {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            action: 'fill',
            message: 'Fill failed: only the current drawer can fill',
          })
        )
      } catch {
        // Connection may be closed
      }
      return
    }

    // Reuse the stroke rate limit bucket for fill operations
    if (!this.checkRateLimit(playerId, true)) {
      console.warn(`Rate limit exceeded for fill by player ${playerId}`)
      try {
        ws.send(JSON.stringify({ type: 'error', action: 'fill', message: 'Rate limit exceeded' }))
      } catch {
        // Connection may be closed
      }
      return
    }

    const validated = validateFill(data)
    if (!validated) {
      console.warn(`Invalid fill data from player ${playerId}`)
      return
    }

    const fill: FillOperation = {
      id: crypto.randomUUID(),
      playerId,
      x: validated.x,
      y: validated.y,
      color: validated.color,
      timestamp: Date.now(),
      seq: ++this.operationSeq,
    }

    this.fills.push(fill)
    this.scheduleStorageWrite('fills')

    const fillMessage = {
      type: 'fill',
      id: fill.id,
      playerId: fill.playerId,
      x: fill.x,
      y: fill.y,
      color: fill.color,
      timestamp: fill.timestamp,
    }
    const nonce = typeof data.nonce === 'string' && data.nonce.length <= 36 ? data.nonce : undefined

    if (nonce) {
      this.broadcast(fillMessage, ws)
      try {
        ws.send(JSON.stringify({ ...fillMessage, nonce }))
      } catch {
        // Connection may be closed
      }
      return
    }

    this.broadcast(fillMessage)
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
      try {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
      } catch {
        // Connection may be closed
      }
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
      const messageContainsWord = containsCurrentWord(sanitizedContent, this.gameState.currentWord)

      // Suppress messages from drawer or already-guessed players that contain the word
      if (
        messageContainsWord &&
        (playerId === this.gameState.currentDrawerId ||
          this.gameState.correctGuessers.has(playerId))
      ) {
        try {
          ws.send(
            JSON.stringify({
              type: 'system-message',
              content: 'Your message was suppressed to prevent revealing the answer word.',
            })
          )
        } catch {
          // Ignore send errors
        }
        return
      }

      // Check for exact-match correct guess (scoring)
      if (isCorrectGuess(sanitizedContent, this.gameState.currentWord)) {
        await this.handleCorrectGuess(playerId, attachment.player.name)
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
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
          console.error('Unexpected error closing dead socket:', e)
        }
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
    // Shuffle player order for drawing (Fisher-Yates)
    const shuffledOrder = [...playerIds]
    for (let i = shuffledOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffledOrder[i], shuffledOrder[j]] = [shuffledOrder[j], shuffledOrder[i]]
    }

    this.gameState = {
      status: 'starting',
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

    // Persist game state
    await this.persistGameState()

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

    // Only allow reset from game-over or lobby state
    if (this.gameState.status !== 'game-over' && this.gameState.status !== 'lobby') {
      console.warn(`Cannot reset game: game is currently in ${this.gameState.status} status`)
      return
    }

    // Clear any active timers before resetting state
    this.clearTimers()

    // Reset to lobby state
    this.gameState = createInitialGameState()

    // Persist reset game state
    await this.persistGameState()

    // Clear strokes/fills and storage to prevent stale canvas on next game
    // Clear in-memory arrays immediately before async storage deletion to prevent
    // race conditions where joining players receive stale data via handleJoin
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.strokeStorageDirty = false
    this.fillStorageDirty = false

    // Clear in-memory arrays immediately - handleJoin sends these directly in init payload
    // so we must clear before any player can join during the reset window
    this.strokes = []
    this.fills = []

    // Async storage deletion - errors will mark storage as dirty for retry
    const strokeDeletePromise = this.queueStrokeDelete().catch((e) => {
      console.error('Failed to delete strokes from storage:', e)
      // Re-mark as dirty so the next storage write will retry
      this.strokeStorageDirty = true
      this.scheduleStorageWrite('strokes')
    })

    const fillDeletePromise = this.queueFillDelete().catch((e) => {
      console.error('Failed to delete fills from storage:', e)
      // Re-mark as dirty so the next storage write will retry
      this.fillStorageDirty = true
      this.scheduleStorageWrite('fills')
    })

    this.ctx.waitUntil(strokeDeletePromise)
    this.ctx.waitUntil(fillDeletePromise)

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
          ? ((this.gameState as { endGameAfterCurrentRound?: boolean }).endGameAfterCurrentRound ??
            false)
          : false,
    } as PlayingState

    // Persist game state at round start
    this.ctx.waitUntil(
      this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
    )

    // Clear canvas for new round - clear in-memory arrays immediately to prevent
    // race conditions where new strokes/fills get added then wiped by async callback
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.strokeStorageDirty = false
    this.fillStorageDirty = false

    // Clear in-memory arrays immediately before async storage deletion
    // This prevents race conditions where new drawer actions could be added
    // and then wiped when the async delete callback runs later
    this.strokes = []
    this.fills = []

    // Async storage deletion - errors will mark storage as dirty for retry
    const strokeDeletePromise = this.queueStrokeDelete().catch((e) => {
      console.error('Failed to delete strokes from storage:', e)
      this.strokeStorageDirty = true
      this.scheduleStorageWrite('strokes')
    })

    const fillDeletePromise = this.queueFillDelete().catch((e) => {
      console.error('Failed to delete fills from storage:', e)
      this.fillStorageDirty = true
      this.scheduleStorageWrite('fills')
    })

    this.ctx.waitUntil(strokeDeletePromise)
    this.ctx.waitUntil(fillDeletePromise)

    // Broadcast round start to all players
    // Note: Send word only to the drawer
    const deadSockets: WebSocket[] = []
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
      if (attachment?.playerId) {
        try {
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
        } catch (error) {
          if (error instanceof DOMException && error.name === 'InvalidStateError') {
            deadSockets.push(ws)
            continue
          }
          console.error('Unexpected round-start send error:', error)
        }
      }
    }

    // Close dead connections to prevent accumulation
    for (const deadWs of deadSockets) {
      try {
        deadWs.close()
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'InvalidStateError')) {
          console.error('Unexpected error closing dead socket:', e)
        }
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

    // Transition to round-end state (awaits either next round or game end)
    this.gameState = {
      ...this.gameState,
      status: 'round-end',
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
    } as RoundEndState

    // Persist round-end state
    this.ctx.waitUntil(
      this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
    )

    // Check if game should end
    const shouldEnd =
      this.gameState.currentRound >= this.gameState.totalRounds ||
      (this.gameState.status === 'round-end' && this.gameState.endGameAfterCurrentRound)

    if (shouldEnd) {
      // Give a short delay before showing final results
      if (this.gameEndTimer) {
        clearTimeout(this.gameEndTimer)
      }
      // Store the target transition time for resume consistency
      const now = Date.now()
      ;(this.gameState as RoundEndState).nextTransitionAt = now + GAME_END_TRANSITION_DELAY
      // Persist with nextTransitionAt before setting timer (prevents rehydration timing issues)
      this.ctx.waitUntil(
        this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
      )
      this.gameEndTimer = setTimeout(() => this.endGame(), GAME_END_TRANSITION_DELAY)
      return
    }

    // Start next round after delay (unless skipping)
    if (skipToNext) {
      // Give a short delay so clients can see round results even when skipping
      if (this.roundEndTimer) {
        clearTimeout(this.roundEndTimer)
      }
      // Store the target transition time for resume consistency
      const now = Date.now()
      ;(this.gameState as RoundEndState).nextTransitionAt = now + SKIP_ROUND_TRANSITION_DELAY
      // Persist with nextTransitionAt before setting timer (prevents rehydration timing issues)
      this.ctx.waitUntil(
        this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
      )
      this.roundEndTimer = setTimeout(() => {
        if (this.gameState.status === 'round-end') {
          this.startRound()
        }
      }, SKIP_ROUND_TRANSITION_DELAY)
    } else {
      if (this.roundEndTimer) {
        clearTimeout(this.roundEndTimer)
      }
      // Store the target transition time for resume consistency
      const now = Date.now()
      ;(this.gameState as RoundEndState).nextTransitionAt = now + ROUND_END_TRANSITION_DELAY
      // Persist with nextTransitionAt before setting timer (prevents rehydration timing issues)
      this.ctx.waitUntil(
        this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
      )
      this.roundEndTimer = setTimeout(() => {
        if (this.gameState.status === 'round-end') {
          this.startRound()
        }
      }, ROUND_END_TRANSITION_DELAY)
    }
  }

  /**
   * End the game and broadcast final results
   */
  private endGame() {
    this.clearTimers()

    // Capture snapshot of scores at game end time
    // to preserve disconnected players' scores in final results
    const scoreSnapshot = new Map(this.gameState.scores)

    // Find winners (handle ties) using the snapshot
    let winners: { playerId: string; playerName: string; score: number }[] = []
    let highestScore = -1

    for (const [playerId, scoreInfo] of scoreSnapshot) {
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

    // Broadcast game over using the snapshot
    this.broadcast({
      type: 'game-over',
      finalScores: scoresToRecord(scoreSnapshot),
      winners,
    })

    // Clear strokes/fills to prevent stale canvas on next game
    if (this.storageWriteTimer) {
      clearTimeout(this.storageWriteTimer)
      this.storageWriteTimer = null
    }
    this.strokeStorageDirty = false
    this.fillStorageDirty = false

    // Clear in-memory state immediately to prevent stale data in handleJoin
    // Storage deletion happens asynchronously and failures are logged but don't
    // block state transition - we persist empty state later anyway
    this.strokes = []
    this.fills = []

    // Attempt storage deletion asynchronously (failures are logged but don't block)
    const strokeDeletePromise = this.queueStrokeDelete().catch((e) => {
      console.error('Failed to delete strokes from storage:', e)
      this.strokeStorageDirty = true
      this.scheduleStorageWrite('strokes')
    })

    const fillDeletePromise = this.queueFillDelete().catch((e) => {
      console.error('Failed to delete fills from storage:', e)
      this.fillStorageDirty = true
      this.scheduleStorageWrite('fills')
    })

    this.ctx.waitUntil(strokeDeletePromise)
    this.ctx.waitUntil(fillDeletePromise)

    // Set status to game-over (don't reset immediately) so new/reconnecting players see results
    // handleResetGame will be the sole path back to lobby
    this.gameState = {
      ...this.gameState,
      status: 'game-over',
      currentDrawerId: null,
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
    } as GameOverState

    // Persist game-over state to storage
    this.ctx.waitUntil(
      this.persistGameState().catch((e) => console.error('Failed to persist game state:', e))
    )
  }

  /**
   * Handle a correct guess from a player
   */
  private async handleCorrectGuess(playerId: string, playerName: string) {
    if (!this.gameState.roundEndTime || !this.gameState.currentWord) return

    // Prevent duplicate scoring - check if player already guessed correctly
    if (this.gameState.correctGuessers.has(playerId)) {
      return
    }

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

    // Persist updated scores to durable storage before broadcasting
    await this.persistGameState()

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
    clearTimers(this)
  }

  /**
   * Get player name by ID
   */
  private getPlayerName(playerId: string): string {
    // Check connected players first
    const players = this.getPlayers()
    const player = players.find((p) => p.id === playerId)
    if (player) return player.name

    // Fallback to scores map (stores name at time of score entry)
    return this.gameState.scores.get(playerId)?.name || 'Unknown'
  }
}
