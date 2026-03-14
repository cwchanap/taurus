<script lang="ts">
  import { browser } from '$app/environment'
  import Canvas from '$lib/components/Canvas.svelte'
  import Toolbar from '$lib/components/Toolbar.svelte'
  import PlayerList from '$lib/components/PlayerList.svelte'
  import ChatBox from '$lib/components/ChatBox.svelte'
  import Lobby from '$lib/components/Lobby.svelte'
  import GameHeader from '$lib/components/GameHeader.svelte'
  import Scoreboard from '$lib/components/Scoreboard.svelte'
  import { GameWebSocket } from '$lib/websocket'
  import { deriveGameWinners } from '$lib/game-winners'
  import {
    applyRedoState,
    applyUndoState,
    buildGameOverState,
    buildGameResetState,
    buildRoundEndState,
    buildRoundStartState,
    clearCorrectGuessNotification,
    createCorrectGuessNotification,
    discardPendingOptimisticFills,
    discardPendingOptimisticStrokes,
    deriveWinnersIfGameOver,
    getRedoInFlightCount,
    getDrawerDisplayName,
    isSameUndoItem,
    getTimeRemainingSeconds,
    isEditableKeyboardTarget,
    pushBoundedUndo,
    rebuildUndoStack,
    rollbackPendingRedoMarker,
    syncUndoStrokeTimestamp,
    updateStrokePoint,
  } from '$lib/draw-page-state'
  import { onMount, onDestroy } from 'svelte'
  import type { Player, ChatMessage, GameStatus, RoundResult, Winner, ScoreEntry } from '$lib/types'
  import type { Stroke, Point, FillOperation, PaletteColor } from '@repo/types'

  type Tool = 'pencil' | 'eraser' | 'fill'

  type UndoItem = import('$lib/draw-page-state').UndoItem

  const MAX_UNDO_DEPTH = 20

  // API URL - configurable via VITE_API_URL environment variable
  const API_URL =
    import.meta.env.VITE_API_URL ||
    (browser ? (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin) : '')

  let pageState = $state<'lobby' | 'game'>('lobby')
  let roomId = $state('')
  let playerName = $state('')
  let playerId = $state('')
  let players = $state<Player[]>([])
  let strokes = $state<Stroke[]>([])
  let chatMessages = $state<ChatMessage[]>([])
  let isLoading = $state(false)
  let isConnected = $state(false)
  let errorMessage = $state('')
  let isHost = $state(false)

  // Game state
  let gameStatus = $state<GameStatus>('lobby')
  let currentDrawerId = $state<string | null>(null)
  let currentDrawerName = $state('')
  let currentWord = $state<string | undefined>()
  let wordLength = $state(0)
  let roundNumber = $state(0)
  let totalRounds = $state(0)
  let timeRemaining = $state(0)
  let scores = $state<Record<string, ScoreEntry>>({})
  let lastRevealedWord = $state('')
  let lastRoundResult = $state<RoundResult | null>(null)
  let gameWinners = $state<Winner[]>([])
  let correctGuessNotification = $state<{ playerName: string; score: number } | null>(null)
  let systemNotification = $state<string | null>(null)
  let systemNotificationTimeoutId: ReturnType<typeof setTimeout> | null = null

  let color = $state<PaletteColor>('#4ECDC4')
  let brushSize = $state(8)
  let tool = $state<Tool>('pencil')
  let fills = $state<FillOperation[]>([])
  let undoStack = $state<UndoItem[]>([])
  let redoStack = $state<UndoItem[]>([])
  let redoInProgress = $state(false)
  // Track the specific nonce/strokeId of the in-progress redo to prevent duplicate submissions
  let inProgressRedoNonce = $state<string | null>(null)
  let inProgressRedoStrokeId = $state<string | null>(null)
  let pendingRedoFills = $state<Map<string, { item: UndoItem; timestamp: number }>>(new Map())
  let pendingRedoStrokes = $state<Map<string, UndoItem>>(new Map())
  let pendingUndoStrokes = $state<Map<string, UndoItem>>(new Map())
  let pendingUndoFills = $state<Map<string, UndoItem>>(new Map())
  // Track optimistic strokes pending server confirmation (strokeId -> stroke)
  let pendingOptimisticStrokes = $state<Map<string, Stroke>>(new Map())
  // Track optimistic fills pending server confirmation (nonce -> { tempId, timestamp })
  let pendingOptimisticFills = $state<Map<string, { tempId: string; timestamp: number }>>(new Map())

  let ws: GameWebSocket | null = null
  let canvasComponent = $state<Canvas>()
  let correctGuessTimeoutId: ReturnType<typeof setTimeout> | null = null
  let redoTimeoutId: ReturnType<typeof setTimeout> | null = null
  let optimisticFillCleanupId: ReturnType<typeof setInterval> | null = null

  // Clear redoInProgress flag after timeout if no acknowledgment received
  // This handles cases where server silently drops the redo (e.g., round ended)
  const REDO_ACK_TIMEOUT_MS = 5000
  // Timeout for cleaning up orphaned optimistic fills (server silent rejections)
  const OPTIMISTIC_FILL_TIMEOUT_MS = 5000
  // Interval for checking orphaned fills
  const OPTIMISTIC_FILL_CLEANUP_INTERVAL_MS = 1000

  // Helper functions for reactive Map mutations
  // In Svelte 5, mutating a Map inside $state() with .set()/.delete() doesn't trigger reactivity.
  // These helpers return new Map instances to trigger updates.
  function mapSet<T>(map: Map<string, T>, key: string, value: T): Map<string, T> {
    const newMap = new Map(map)
    newMap.set(key, value)
    return newMap
  }

  function mapDelete<T>(map: Map<string, T>, key: string): Map<string, T> {
    const newMap = new Map(map)
    newMap.delete(key)
    return newMap
  }

  function mapSetRedoInfo(
    map: Map<string, { item: UndoItem; timestamp: number }>,
    key: string,
    value: { item: UndoItem; timestamp: number }
  ): Map<string, { item: UndoItem; timestamp: number }> {
    const newMap = new Map(map)
    newMap.set(key, value)
    return newMap
  }

  function mapSetOptimisticInfo(
    map: Map<string, { tempId: string; timestamp: number }>,
    key: string,
    value: { tempId: string; timestamp: number }
  ): Map<string, { tempId: string; timestamp: number }> {
    const newMap = new Map(map)
    newMap.set(key, value)
    return newMap
  }

  // Derived state
  const isCurrentDrawer = $derived(playerId === currentDrawerId)
  const canDraw = $derived(gameStatus === 'playing' && isCurrentDrawer)
  const canStartGame = $derived(isHost && gameStatus === 'lobby' && players.length >= 2)
  const undoInFlightCount = $derived(pendingUndoStrokes.size + pendingUndoFills.size)
  const redoInFlightCount = $derived(
    getRedoInFlightCount(redoInProgress, pendingRedoStrokes, pendingRedoFills)
  )
  const topUndoItemHasTempId = $derived(() => {
    const top = undoStack[undoStack.length - 1]
    return top?.type === 'fill' && top.fillId.startsWith('temp-fill-')
  })
  const canUndo = $derived(
    canDraw && undoStack.length > 0 && !topUndoItemHasTempId && undoInFlightCount === 0
  )
  const canRedo = $derived(canDraw && redoStack.length > redoInFlightCount && !redoInProgress)

  async function createRoom() {
    isLoading = true
    errorMessage = ''

    try {
      const res = await fetch(`${API_URL}/api/rooms`, { method: 'POST' })

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error')
        throw new Error(`Server error (${res.status}): ${errorText}`)
      }

      let data
      try {
        data = await res.json()
      } catch {
        throw new Error('Invalid response from server')
      }

      if (!data.roomId) {
        throw new Error('Server did not return a room ID')
      }

      roomId = data.roomId
      connectToRoom()
    } catch (e) {
      console.error('Failed to create room:', e)
      errorMessage = e instanceof Error ? e.message : 'Failed to create room. Please try again.'
      isLoading = false
    }
  }

  function joinRoom(code: string) {
    roomId = code
    isLoading = true
    errorMessage = ''
    connectToRoom()
  }

  function connectToRoom() {
    if (ws) ws.disconnect()
    ws = new GameWebSocket(API_URL, roomId, playerName)

    ws.on({
      onConnectionChange: (connected) => {
        isConnected = connected
        // Clear redo lock on connection changes to allow retry after reconnection
        if (!connected) {
          clearRedoLock()
        }
      },
      onConnectionFailed: (reason) => {
        errorMessage = reason
        // Clear redo lock on permanent connection failure to allow user action
        clearRedoLock()
      },
      onServerError: (message, action) => {
        errorMessage = message
        const isDrawingAction =
          action === 'undo-stroke' ||
          action === 'undo-fill' ||
          action === 'fill' ||
          action === 'stroke' ||
          action === 'stroke-update'
        if (isDrawingAction) {
          clearRedoLock()
          pendingRedoStrokes = new Map()
          pendingRedoFills = new Map()
          pendingUndoStrokes = new Map()
          pendingUndoFills = new Map()
          const nextStrokes = discardPendingOptimisticStrokes(
            strokes,
            undoStack,
            pendingOptimisticStrokes
          )
          strokes = nextStrokes.strokes
          undoStack = nextStrokes.undoStack
          pendingOptimisticStrokes = nextStrokes.pendingOptimisticStrokes
          const next = discardPendingOptimisticFills(fills, undoStack, pendingOptimisticFills)
          fills = next.fills
          undoStack = next.undoStack
          pendingOptimisticFills = next.pendingOptimisticFills
        } else {
          // Non-drawing errors (chat rate limit, clear, etc.) — only release the redo lock
          // to avoid getting stuck, but don't discard in-flight drawing state
          clearRedoLock()
        }
      },
      onInit: (
        id,
        player,
        playerList,
        strokeList,
        fillList,
        chatHistory,
        hostFlag,
        initialGameState
      ) => {
        playerId = id
        players = playerList
        isHost = hostFlag
        // Clear canvas before applying new state to avoid desync
        canvasComponent?.clearCanvas()
        strokes = strokeList
        fills = fillList
        // Rebuild undo stack from restored operations if we're the current drawer
        // This preserves undo capability after reconnection
        undoStack =
          id === initialGameState.currentDrawerId
            ? rebuildUndoStack(strokeList, fillList, initialGameState.currentDrawerId)
            : []
        redoStack = []
        redoInProgress = false
        pendingRedoFills = new Map()
        pendingRedoStrokes = new Map()
        pendingUndoStrokes = new Map()
        pendingUndoFills = new Map()
        pendingOptimisticStrokes = new Map()
        pendingOptimisticFills = new Map()
        chatMessages = chatHistory
        // Initialize game state from server
        gameStatus = initialGameState.status
        currentDrawerId = initialGameState.currentDrawerId
        roundNumber = initialGameState.currentRound
        totalRounds = initialGameState.totalRounds
        scores = initialGameState.scores
        gameWinners = deriveWinnersIfGameOver(
          initialGameState.status,
          initialGameState.scores,
          deriveGameWinners
        )
        timeRemaining = getTimeRemainingSeconds(initialGameState.roundEndTime)
        currentDrawerName = getDrawerDisplayName(currentDrawerId, players, scores)

        wordLength = initialGameState.wordLength ?? 0
        currentWord =
          initialGameState.currentWord !== undefined ? initialGameState.currentWord : undefined

        pageState = 'game'
        isLoading = false
      },
      onHostChange: (newHostId) => {
        isHost = newHostId === playerId
      },
      onPlayerJoined: (player) => {
        players = [...players, player]
      },
      onPlayerLeft: (id) => {
        players = players.filter((p) => p.id !== id)
      },
      onStroke: (stroke) => {
        // Deduplicate by stroke id - new strokes are already added optimistically
        // via handleStrokeStart, but redo strokes need to be added here
        const existingIndex = strokes.findIndex((s) => s.id === stroke.id)
        if (existingIndex !== -1) {
          const serverStrokeMetadata = {
            timestamp: stroke.timestamp,
            ...(stroke.seq !== undefined ? { seq: stroke.seq } : {}),
          }
          // Update with server ordering metadata to ensure correct z-ordering
          strokes[existingIndex] = { ...strokes[existingIndex], ...serverStrokeMetadata }
          strokes = [...strokes]
          undoStack = syncUndoStrokeTimestamp(undoStack, stroke.id, serverStrokeMetadata)
          // Server confirmed this optimistic stroke
          pendingOptimisticStrokes = mapDelete(pendingOptimisticStrokes, stroke.id)
        } else {
          strokes = [...strokes, stroke]
          canvasComponent?.addRemoteStroke(stroke)
          // Check if this stroke came from a redo
          const redoItem = pendingRedoStrokes.get(stroke.id)
          if (redoItem && redoItem.type === 'stroke') {
            pendingRedoStrokes = mapDelete(pendingRedoStrokes, stroke.id)
            // Clear the in-progress flag as we've received server confirmation
            clearRedoLock()
            // Remove the confirmed redo entry from redoStack to prevent repeated redos
            redoStack = redoStack.filter((item) => !isSameUndoItem(item, redoItem))
            // Insert redo stroke at correct position using seq ?? timestamp to match
            // the server's getOperationOrder() comparator, so same-millisecond ops
            // are disambiguated correctly.
            const newItem: UndoItem = { type: 'stroke', strokeId: stroke.id, stroke }
            const incomingOrder = stroke.seq ?? stroke.timestamp
            const insertIndex = undoStack.findIndex((item) => {
              const itemOrder =
                item.type === 'stroke'
                  ? (item.stroke.seq ?? item.stroke.timestamp)
                  : (item.fill.seq ?? item.fill.timestamp)
              return itemOrder > incomingOrder
            })
            if (insertIndex === -1) {
              undoStack = pushBoundedUndo(undoStack, newItem, MAX_UNDO_DEPTH)
            } else {
              // Insert at position to maintain chronological order
              // Cap from the end to preserve newest entries
              undoStack = [
                ...undoStack.slice(0, insertIndex),
                newItem,
                ...undoStack.slice(insertIndex),
              ]
              if (undoStack.length > MAX_UNDO_DEPTH) {
                undoStack = undoStack.slice(undoStack.length - MAX_UNDO_DEPTH)
              }
            }
          }
        }
      },
      onStrokeUpdate: (strokeId, point) => {
        const index = strokes.findIndex((s) => s.id === strokeId)
        if (index !== -1) {
          canvasComponent?.updateRemoteStroke(strokeId, point)
          strokes[index].points.push(point)
        }
      },
      onStrokeRemoved: (strokeId) => {
        strokes = strokes.filter((s) => s.id !== strokeId)
        // Check if this is a pending undo operation
        const pendingItem = pendingUndoStrokes.get(strokeId)
        if (pendingItem) {
          // Server confirmed the undo - commit the state changes
          undoStack = undoStack.filter((item) => item !== pendingItem)
          redoStack = pushBoundedUndo(redoStack, pendingItem, MAX_UNDO_DEPTH)
          pendingUndoStrokes = mapDelete(pendingUndoStrokes, strokeId)
        }
      },
      onFill: (fill) => {
        if (isCurrentDrawer) {
          // Check if this fill came from a redo - if so, don't clear redoStack
          // Use nonce for unique matching instead of coordinates to handle repeated fills
          const redoFillInfo = fill.nonce ? pendingRedoFills.get(fill.nonce) : undefined
          if (redoFillInfo) {
            // Redo echo: insert at chronological position, remove from redoStack
            pendingRedoFills = mapDelete(pendingRedoFills, fill.nonce!)
            // Clear the in-progress flag as we've received server confirmation
            clearRedoLock()
            // Remove the confirmed redo entry from redoStack to prevent repeated redos
            redoStack = redoStack.filter((item) => !isSameUndoItem(item, redoFillInfo.item))

            // Check if this fill was already applied optimistically (has nonce)
            const existingOptimisticFill = fill.nonce
              ? fills.find((f) => f.nonce === fill.nonce && f.id.startsWith('temp-fill-'))
              : undefined

            if (existingOptimisticFill) {
              // Replace optimistic fill with server fill in the fills array
              fills = fills.map((f) => (f.nonce === fill.nonce ? fill : f))
              // Update undo stack to use server's fill ID instead of temporary ID
              undoStack = undoStack.map((item) => {
                if (item.type === 'fill' && item.fillId === existingOptimisticFill.id) {
                  return { type: 'fill' as const, fillId: fill.id, fill }
                }
                return item
              })
              // Clean up from pending optimistic fills map
              if (fill.nonce) {
                pendingOptimisticFills = mapDelete(pendingOptimisticFills, fill.nonce)
              }
            } else {
              // New fill from redo that wasn't optimistically added
              fills = [...fills, fill]
              const newItem: UndoItem = { type: 'fill', fillId: fill.id, fill }
              // Use seq ?? timestamp to match server's getOperationOrder() comparator.
              const incomingOrder = fill.seq ?? fill.timestamp
              const insertIndex = undoStack.findIndex((item) => {
                const itemOrder =
                  item.type === 'stroke'
                    ? (item.stroke.seq ?? item.stroke.timestamp)
                    : (item.fill.seq ?? item.fill.timestamp)
                return itemOrder > incomingOrder
              })
              if (insertIndex === -1) {
                undoStack = pushBoundedUndo(undoStack, newItem, MAX_UNDO_DEPTH)
              } else {
                // Insert at position to maintain chronological order
                // Cap from the end to preserve newest entries
                undoStack = [
                  ...undoStack.slice(0, insertIndex),
                  newItem,
                  ...undoStack.slice(insertIndex),
                ]
                if (undoStack.length > MAX_UNDO_DEPTH) {
                  undoStack = undoStack.slice(undoStack.length - MAX_UNDO_DEPTH)
                }
              }
            }
          } else {
            // Check if this fill was already applied optimistically
            const existingOptimisticFill = fill.nonce
              ? fills.find((f) => f.nonce === fill.nonce && f.id.startsWith('temp-fill-'))
              : undefined

            if (existingOptimisticFill) {
              // Replace optimistic fill with server fill
              fills = fills.map((f) => (f.nonce === fill.nonce ? fill : f))
              // Update undo stack to use server's fill ID
              undoStack = undoStack.map((item) => {
                if (item.type === 'fill' && item.fillId === existingOptimisticFill.id) {
                  return { type: 'fill' as const, fillId: fill.id, fill }
                }
                return item
              })
              // Clear redo history only after the fill has been confirmed by the server
              redoStack = []
              // Clean up from pending optimistic fills map
              if (fill.nonce) {
                pendingOptimisticFills = mapDelete(pendingOptimisticFills, fill.nonce)
              }
            } else {
              // Deduplicate by server fill id (for non-optimistic fills from other players)
              const alreadyApplied = fills.some((f) => f.id === fill.id)
              if (!alreadyApplied) {
                fills = [...fills, fill]
                // New fill: push once to undo stack and clear redo stack
                undoStack = pushBoundedUndo(
                  undoStack,
                  { type: 'fill', fillId: fill.id, fill },
                  MAX_UNDO_DEPTH
                )
                redoStack = []
              }
            }
          }
        } else {
          // Non-drawer: just add the fill if not already present
          const alreadyApplied = fills.some((f) => f.id === fill.id)
          if (!alreadyApplied) {
            fills = [...fills, fill]
          }
        }
      },
      onFillRemoved: (fillId) => {
        fills = fills.filter((f) => f.id !== fillId)
        // Check if this is a pending undo operation
        const pendingItem = pendingUndoFills.get(fillId)
        if (pendingItem) {
          // Server confirmed the undo - commit the state changes
          undoStack = undoStack.filter((item) => item !== pendingItem)
          redoStack = pushBoundedUndo(redoStack, pendingItem, MAX_UNDO_DEPTH)
          pendingUndoFills = mapDelete(pendingUndoFills, fillId)
        }
      },
      onClear: () => {
        strokes = []
        fills = []
        undoStack = []
        redoStack = []
        clearRedoLock()
        pendingRedoFills = new Map()
        pendingRedoStrokes = new Map()
        pendingUndoStrokes = new Map()
        pendingUndoFills = new Map()
        pendingOptimisticStrokes = new Map()
        pendingOptimisticFills = new Map()
        canvasComponent?.clearCanvas()
      },
      onChat: (message) => {
        chatMessages = [...chatMessages, message]
      },
      onSystemMessage: (content) => {
        systemNotification = content
        if (systemNotificationTimeoutId) {
          clearTimeout(systemNotificationTimeoutId)
        }
        // Clear notification after a few seconds
        systemNotificationTimeoutId = setTimeout(() => {
          systemNotification = null
          systemNotificationTimeoutId = null
        }, 4000)
      },
      // Game event handlers
      onGameStarted: (rounds, drawerOrder, initialScores) => {
        totalRounds = rounds
        scores = initialScores
        gameStatus = 'starting'
      },
      onRoundStart: (round, rounds, drawerId, drawerNameVal, word, wordLen, endTime) => {
        const next = buildRoundStartState(
          round,
          rounds,
          drawerId,
          drawerNameVal,
          word,
          wordLen,
          endTime
        )
        roundNumber = next.roundNumber
        totalRounds = next.totalRounds
        currentDrawerId = next.currentDrawerId
        currentDrawerName = next.currentDrawerName
        currentWord = next.currentWord
        wordLength = next.wordLength
        timeRemaining = next.timeRemaining
        gameStatus = next.gameStatus
        lastRoundResult = next.lastRoundResult
        undoStack = next.undoStack
        redoStack = next.redoStack
        clearRedoLock()
        pendingRedoStrokes = new Map()
        pendingRedoFills = new Map()
        pendingUndoStrokes = new Map()
        pendingUndoFills = new Map()
        pendingOptimisticStrokes = new Map()
        pendingOptimisticFills = new Map()
        // Clear any pending correct-guess timeout before resetting notification
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
          correctGuessTimeoutId = null
        }
        correctGuessNotification = next.correctGuessNotification
      },
      onRoundEnd: (word, result, newScores) => {
        const next = buildRoundEndState(word, result, newScores)
        lastRevealedWord = next.lastRevealedWord
        lastRoundResult = next.lastRoundResult
        scores = next.scores
        gameStatus = next.gameStatus
        currentWord = next.currentWord
        currentDrawerId = next.currentDrawerId
        currentDrawerName = next.currentDrawerName
        wordLength = next.wordLength ?? 0
      },
      onGameOver: (finalScores, winners) => {
        const next = buildGameOverState(finalScores, winners)
        scores = next.scores
        gameWinners = next.gameWinners
        gameStatus = next.gameStatus
        currentDrawerId = next.currentDrawerId
        currentWord = next.currentWord
      },
      onCorrectGuess: (guesserId, guesserName, score, remaining) => {
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
        }
        correctGuessNotification = createCorrectGuessNotification(guesserName, score)
        // Clear notification after a few seconds
        correctGuessTimeoutId = setTimeout(() => {
          correctGuessNotification = clearCorrectGuessNotification()
          correctGuessTimeoutId = null
        }, 3000)
      },
      onTick: (remaining) => {
        timeRemaining = remaining
      },
      onGameReset: () => {
        if (correctGuessTimeoutId) {
          clearTimeout(correctGuessTimeoutId)
          correctGuessTimeoutId = null
        }
        if (systemNotificationTimeoutId) {
          clearTimeout(systemNotificationTimeoutId)
          systemNotificationTimeoutId = null
        }

        const next = buildGameResetState()
        gameStatus = next.gameStatus
        gameWinners = next.gameWinners
        lastRoundResult = next.lastRoundResult
        scores = next.scores
        currentDrawerId = next.currentDrawerId
        currentWord = next.currentWord
        lastRevealedWord = next.lastRevealedWord
        roundNumber = next.roundNumber
        totalRounds = next.totalRounds
        strokes = next.strokes
        fills = next.fills
        undoStack = next.undoStack
        redoStack = next.redoStack
        clearRedoLock()
        correctGuessNotification = next.correctGuessNotification
        systemNotification = next.systemNotification
        pendingRedoStrokes = new Map()
        pendingRedoFills = new Map()
        pendingUndoStrokes = new Map()
        pendingUndoFills = new Map()
        pendingOptimisticStrokes = new Map()
        pendingOptimisticFills = new Map()
        canvasComponent?.clearCanvas()
      },
    })

    ws.connect()
  }

  onMount(() => {
    // Start cleanup interval for orphaned optimistic fills after component mount
    optimisticFillCleanupId = setInterval(() => {
      const now = Date.now()
      const expiredNonces: string[] = []
      const expiredFills: { tempId: string }[] = []

      // Find expired pending fills
      for (const [nonce, pending] of pendingOptimisticFills.entries()) {
        if (now - pending.timestamp > OPTIMISTIC_FILL_TIMEOUT_MS) {
          expiredNonces.push(nonce)
          expiredFills.push(pending)
        }
      }

      // Remove expired fills and update pendingOptimisticFills reactively
      if (expiredNonces.length > 0) {
        // Remove the orphaned optimistic fills from fills and undoStack
        for (const pending of expiredFills) {
          fills = fills.filter((f) => f.id !== pending.tempId)
          undoStack = undoStack.filter(
            (item) => !(item.type === 'fill' && item.fillId === pending.tempId)
          )
          console.warn(
            `Canvas: Cleaned up orphaned optimistic fill ${pending.tempId} (server never confirmed)`
          )
        }

        // Remove expired entries from pendingOptimisticFills
        // Create a new Map excluding expired nonces to trigger reactivity
        const newMap = new Map<string, { tempId: string; timestamp: number }>()
        for (const [nonce, pending] of pendingOptimisticFills.entries()) {
          if (!expiredNonces.includes(nonce)) {
            newMap.set(nonce, pending)
          }
        }
        pendingOptimisticFills = newMap
      }
    }, OPTIMISTIC_FILL_CLEANUP_INTERVAL_MS)
  })

  onDestroy(() => {
    ws?.disconnect()
    if (correctGuessTimeoutId) {
      clearTimeout(correctGuessTimeoutId)
    }
    if (systemNotificationTimeoutId) {
      clearTimeout(systemNotificationTimeoutId)
    }
    if (redoTimeoutId) {
      clearTimeout(redoTimeoutId)
    }
    if (optimisticFillCleanupId) {
      clearInterval(optimisticFillCleanupId)
      optimisticFillCleanupId = null
    }
  })

  function handleStrokeStart(stroke: Stroke) {
    strokes = [...strokes, stroke]
    pendingOptimisticStrokes = mapSet(pendingOptimisticStrokes, stroke.id, stroke)
    const sent = ws?.sendStroke(stroke)
    if (sent === false) {
      console.error('Canvas: Failed to send stroke — WebSocket not open')
      strokes = strokes.filter((s) => s.id !== stroke.id)
      pendingOptimisticStrokes = mapDelete(pendingOptimisticStrokes, stroke.id)
      return
    }
    // New stroke clears redo stack and pushes to undo
    redoStack = []
    undoStack = pushBoundedUndo(
      undoStack,
      { type: 'stroke', strokeId: stroke.id, stroke },
      MAX_UNDO_DEPTH
    )
  }

  function handleStrokeUpdate(strokeId: string, point: Point) {
    strokes = updateStrokePoint(strokes, strokeId, point)
    const sent = ws?.sendStrokeUpdate(strokeId, point)
    if (sent === false) {
      console.error('Canvas: Failed to send stroke update — WebSocket not open')
      strokes = strokes.filter((s) => s.id !== strokeId)
      undoStack = undoStack.filter(
        (item) => !(item.type === 'stroke' && item.strokeId === strokeId)
      )
      pendingOptimisticStrokes = mapDelete(pendingOptimisticStrokes, strokeId)
      return
    }
    // Update the undo stack entry with the full stroke to ensure redo restores complete stroke
    const undoIndex = undoStack.findIndex(
      (item) => item.type === 'stroke' && item.strokeId === strokeId
    )
    if (undoIndex !== -1) {
      const fullStroke = strokes.find((s) => s.id === strokeId)
      if (fullStroke) {
        const item = undoStack[undoIndex]
        if (item.type === 'stroke') {
          undoStack[undoIndex] = { type: 'stroke', strokeId: item.strokeId, stroke: fullStroke }
        }
      }
    }
  }

  function handleFill(x: number, y: number, fillColor: PaletteColor) {
    // Generate unique nonce for optimistic update tracking
    const nonce = crypto.randomUUID()
    // Create temporary ID for optimistic fill (will be replaced by server ID)
    const tempId = `temp-fill-${nonce}`

    // Create optimistic fill operation
    const optimisticFill: FillOperation = {
      id: tempId,
      playerId,
      x,
      y,
      color: fillColor,
      timestamp: Date.now(),
      nonce,
    }

    // Optimistically add fill to local state
    fills = [...fills, optimisticFill]

    // New user action — discard the abandoned redo branch immediately,
    // matching the behaviour of handleStrokeStart.
    redoStack = []

    // Add to undo stack optimistically
    undoStack = pushBoundedUndo(
      undoStack,
      { type: 'fill', fillId: tempId, fill: optimisticFill },
      MAX_UNDO_DEPTH
    )

    // Track this optimistic fill for cleanup if server never confirms
    pendingOptimisticFills = mapSetOptimisticInfo(pendingOptimisticFills, nonce, {
      tempId,
      timestamp: Date.now(),
    })

    // Send fill message to server with nonce for correlation
    const sent = ws?.sendFill(x, y, fillColor, nonce)
    if (sent === false) {
      console.error('Canvas: Failed to send fill — WebSocket not open')
      // Remove optimistic fill on failure to prevent desync
      fills = fills.filter((f) => f.id !== tempId)
      undoStack = undoStack.filter((item) => !(item.type === 'fill' && item.fillId === tempId))
      pendingOptimisticFills = mapDelete(pendingOptimisticFills, nonce)
      return
    }
  }

  function handleUndo() {
    const next = applyUndoState(undoStack, redoStack, strokes, fills)

    // Check if there's an action to send
    if (!next.action) {
      // No action needed (empty stack), nothing to commit
      return
    }

    // Send undo message to server
    let sendSucceeded = false
    if (next.action?.type === 'undo-stroke') {
      sendSucceeded = ws?.sendUndoStroke(next.action.strokeId) ?? false
      if (sendSucceeded) {
        // Track as pending undo - server will confirm with stroke-removed
        const item = undoStack[undoStack.length - 1]
        if (item) {
          pendingUndoStrokes = mapSet(pendingUndoStrokes, next.action.strokeId, item)
        }
      }
    } else if (next.action?.type === 'undo-fill') {
      sendSucceeded = ws?.sendUndoFill(next.action.fillId) ?? false
      if (sendSucceeded) {
        // Track as pending undo - server will confirm with fill-removed
        const item = undoStack[undoStack.length - 1]
        if (item) {
          pendingUndoFills = mapSet(pendingUndoFills, next.action.fillId, item)
        }
      }
    }

    if (!sendSucceeded) {
      console.error('handleUndo: Failed to send undo action to server, preserving undo stack')
    }
    // NOTE: We do NOT commit state changes here. We wait for server confirmation
    // via onStrokeRemoved/onFillRemoved handlers to prevent desync when server
    // rejects the undo (e.g., round ended, sender is not the drawer)
  }

  function handleRedo() {
    // Prevent duplicate redo submissions while waiting for server acknowledgment
    if (redoInProgress) {
      console.log('handleRedo: Redo already in progress, ignoring duplicate request')
      return
    }

    // Capture the item BEFORE applyRedoState removes it from the stack
    const item = redoStack[redoStack.length - 1]
    const next = applyRedoState(redoStack, undoStack, strokes, fills)

    // Check if there's an action to send
    if (!next.action) {
      // No action needed (empty stack), nothing to commit
      return
    }

    let sendSucceeded = false
    let failedRedoStrokeId: string | undefined
    let failedRedoFillNonce: string | undefined
    if (item.type === 'stroke' && next.action?.type === 'send-stroke') {
      // Track the UndoItem from redoStack so onStroke can remove it when confirmed
      pendingRedoStrokes = mapSet(pendingRedoStrokes, next.action.stroke.id, item)
      failedRedoStrokeId = next.action.stroke.id
      inProgressRedoStrokeId = next.action.stroke.id
      sendSucceeded = ws?.sendStroke(next.action.stroke) ?? false
    } else if (item.type === 'fill' && next.action?.type === 'send-fill') {
      // Generate unique nonce for this redo fill to distinguish from other fills
      // with same coordinates/color
      const nonce = crypto.randomUUID()
      // Track the UndoItem from redoStack and timestamp for ordering
      pendingRedoFills = mapSetRedoInfo(pendingRedoFills, nonce, { item, timestamp: Date.now() })
      failedRedoFillNonce = nonce
      inProgressRedoNonce = nonce
      sendSucceeded = ws?.sendFill(next.action.x, next.action.y, next.action.color, nonce) ?? false
    }

    if (!sendSucceeded) {
      const rollback = rollbackPendingRedoMarker(
        pendingRedoStrokes,
        pendingRedoFills,
        failedRedoStrokeId,
        failedRedoFillNonce
      )
      pendingRedoStrokes = rollback.pendingRedoStrokes
      pendingRedoFills = rollback.pendingRedoFills
      console.error('handleRedo: Failed to send redo action to server, preserving redo stack')
      redoInProgress = false
      inProgressRedoNonce = null
      inProgressRedoStrokeId = null
      return
    }

    // Set flag to prevent duplicate submissions while waiting for server acknowledgment
    redoInProgress = true

    // Set timeout to clear the flag if no acknowledgment is received
    // This handles cases where server silently drops the redo (e.g., round ended)
    if (redoTimeoutId) {
      clearTimeout(redoTimeoutId)
    }
    redoTimeoutId = setTimeout(() => {
      console.warn('handleRedo: No acknowledgment received from server, rolling back pending redo')
      // Rollback the specific pending redo item instead of just unlocking
      const rollback = rollbackPendingRedoMarker(
        pendingRedoStrokes,
        pendingRedoFills,
        inProgressRedoStrokeId ?? undefined,
        inProgressRedoNonce ?? undefined
      )
      pendingRedoStrokes = rollback.pendingRedoStrokes
      pendingRedoFills = rollback.pendingRedoFills
      // Return the item to redoStack so it can be retried
      if (
        item &&
        (inProgressRedoNonce || inProgressRedoStrokeId) &&
        !redoStack.some((redoItem) => isSameUndoItem(redoItem, item))
      ) {
        redoStack = pushBoundedUndo(redoStack, item, MAX_UNDO_DEPTH)
      }
      redoInProgress = false
      inProgressRedoNonce = null
      inProgressRedoStrokeId = null
      redoTimeoutId = null
    }, REDO_ACK_TIMEOUT_MS)

    // NOTE: We do NOT commit redoStack/undoStack changes here. We wait for server
    // confirmation via onStroke/onFill handlers to prevent desync when server
    // rejects the redo (e.g., round ended, sender is not the drawer)
    // The onStroke/onFill handlers will remove the item from redoStack when confirmed
  }

  function clearRedoLock() {
    if (redoTimeoutId) {
      clearTimeout(redoTimeoutId)
      redoTimeoutId = null
    }
    redoInProgress = false
    inProgressRedoNonce = null
    inProgressRedoStrokeId = null
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!canDraw) return

    // Skip if target is an editable element
    if (isEditableKeyboardTarget(event.target)) {
      return
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey
    const key = event.key.toLowerCase()

    if (ctrlOrCmd && event.shiftKey && key === 'z') {
      event.preventDefault()
      handleRedo()
    } else if (ctrlOrCmd && !event.shiftKey && key === 'z') {
      event.preventDefault()
      // Check canUndo to prevent duplicate undo requests while one is in flight
      if (canUndo) {
        handleUndo()
      }
    }
  }

  function handleClear() {
    const sent = ws?.sendClear() ?? false
    if (!sent) {
      console.error('handleClear: WebSocket not open, clear was not sent to server')
    }
  }

  function handleSendMessage(content: string) {
    ws?.sendChat(content)
  }

  function handleStartGame() {
    ws?.sendStartGame()
  }

  function handlePlayAgain() {
    // Inform server to reset the game - server will broadcast game-reset
    const sent = ws?.sendResetGame() ?? false
    if (!sent) {
      console.error('handlePlayAgain: WebSocket not open, reset-game was not sent to server')
    }
  }
</script>

<svelte:head>
  <title>Draw Together</title>
  <meta
    name="description"
    content="A multiplayer drawing game - draw together with friends in real-time!"
  />
</svelte:head>

<svelte:window onkeydown={handleKeyDown} />

{#if pageState === 'lobby'}
  <Lobby
    {playerName}
    onPlayerNameChange={(name) => (playerName = name)}
    onCreateRoom={createRoom}
    onJoinRoom={joinRoom}
    {isLoading}
    {errorMessage}
  />
{:else}
  <div class="game-container">
    <header class="page-header">
      <h1 class="game-title">🎨 Draw Together</h1>
      <div class="room-info">
        <span class="room-label">Room:</span>
        <span class="room-code">{roomId}</span>
        <span class="connection-status" class:connected={isConnected}></span>
        {#if errorMessage}
          <span class="error-badge">{errorMessage}</span>
        {/if}
      </div>
    </header>

    <!-- Game Header for active game -->
    {#if gameStatus === 'playing' || gameStatus === 'round-end'}
      <GameHeader
        status={gameStatus}
        {currentWord}
        {wordLength}
        {timeRemaining}
        {currentDrawerName}
        {isCurrentDrawer}
        {roundNumber}
        {totalRounds}
      />
    {/if}

    <!-- Correct guess notification -->
    {#if correctGuessNotification}
      <div class="correct-guess-notification">
        ✅ {correctGuessNotification.playerName} guessed correctly! +{correctGuessNotification.score}
        pts
      </div>
    {/if}

    <!-- System notification -->
    {#if systemNotification}
      <div class="system-notification">{systemNotification}</div>
    {/if}

    <!-- Round end overlay -->
    {#if gameStatus === 'round-end' && lastRoundResult}
      <div class="round-overlay">
        <div class="round-result">
          <h2>Round Over!</h2>
          <p class="revealed-word">The word was: <strong>{lastRevealedWord}</strong></p>
          <p>Next round starting soon...</p>
        </div>
      </div>
    {/if}

    <!-- Game over overlay -->
    {#if gameStatus === 'game-over'}
      <div class="game-over-overlay">
        <div class="game-over-content">
          <h2>🎉 Game Over!</h2>
          {#if gameWinners.length > 0}
            <div class="winners-list">
              <h3>{gameWinners.length > 1 ? 'Winners' : 'Winner'}</h3>
              {#each gameWinners as winner}
                <p class="winner">
                  <strong>{winner.playerName}</strong> with {winner.score} points!
                </p>
              {/each}
            </div>
          {:else}
            <p>No winner this time.</p>
          {/if}
          {#if isHost}
            <button class="play-again-btn" onclick={handlePlayAgain}>Play Again</button>
          {:else}
            <p class="waiting">Waiting for host to start a new game...</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="game-layout">
      <aside class="sidebar left">
        <Toolbar
          {color}
          {brushSize}
          {tool}
          {canUndo}
          {canRedo}
          onColorChange={(c) => (color = c)}
          onBrushSizeChange={(s) => (brushSize = s)}
          onToolChange={(t) => (tool = t)}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          disabled={!canDraw}
          clearDisabled={gameStatus === 'playing' ? !isCurrentDrawer : !isHost}
        />

        <!-- Start Game button for host -->
        {#if gameStatus === 'lobby'}
          <div class="start-game-section">
            {#if canStartGame}
              <button class="start-game-btn" onclick={handleStartGame}> 🚀 Start Game </button>
            {:else if isHost}
              <p class="waiting-text">Need at least 2 players to start</p>
            {:else}
              <p class="waiting-text">Waiting for host to start...</p>
            {/if}
          </div>
        {/if}
      </aside>

      <main class="canvas-area">
        <Canvas
          bind:this={canvasComponent}
          {color}
          {brushSize}
          {tool}
          {strokes}
          {fills}
          {playerId}
          disabled={!canDraw}
          onStrokeStart={handleStrokeStart}
          onStrokeUpdate={handleStrokeUpdate}
          onFill={handleFill}
        />
        <!-- Cannot draw indicator -->
        {#if gameStatus === 'playing' && !isCurrentDrawer}
          <div class="cannot-draw-indicator">👀 You're guessing! Type your answer in chat.</div>
        {/if}
      </main>

      <aside class="sidebar right">
        {#if gameStatus !== 'lobby'}
          <Scoreboard {scores} {players} {currentDrawerId} currentPlayerId={playerId} />
        {:else}
          <PlayerList {players} currentPlayerId={playerId} />
        {/if}
        <ChatBox
          messages={chatMessages}
          currentPlayerId={playerId}
          onSendMessage={handleSendMessage}
        />
      </aside>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family:
      'Inter',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: white;
    min-height: 100vh;
  }

  .game-container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: rgb(0 0 0 / 0.2);
    border-bottom: 1px solid rgb(255 255 255 / 0.05);
  }

  .game-title {
    font-size: 24px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .room-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .room-label {
    color: rgb(255 255 255 / 0.5);
    font-size: 14px;
  }

  .room-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 2px;
    padding: 6px 12px;
    background: rgb(255 255 255 / 0.1);
    border-radius: 8px;
  }

  .connection-status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff6b6b;
    margin-left: 8px;
  }

  .connection-status.connected {
    background: #4ecdc4;
    box-shadow: 0 0 10px #4ecdc4;
  }

  .error-badge {
    padding: 4px 12px;
    background: rgb(255 107 107 / 0.15);
    border: 1px solid rgb(255 107 107 / 0.3);
    border-radius: 8px;
    color: #ff6b6b;
    font-size: 12px;
    margin-left: 8px;
  }

  .game-layout {
    flex: 1;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 24px;
    padding: 24px;
  }

  .sidebar {
    width: 200px;
  }

  .canvas-area {
    min-height: 500px;
    display: flex;
    flex-direction: column;
    position: relative;
  }

  .start-game-section {
    margin-top: 16px;
    padding: 16px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 12px;
    text-align: center;
  }

  .start-game-btn {
    width: 100%;
    padding: 14px 20px;
    font-size: 16px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .start-game-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgb(78 205 196 / 0.4);
  }

  .waiting-text {
    font-size: 13px;
    color: rgb(255 255 255 / 0.5);
    margin: 0;
  }

  .correct-guess-notification {
    position: fixed;
    top: 100px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: linear-gradient(135deg, rgb(78 205 196 / 0.9), rgb(69 183 209 / 0.9));
    border-radius: 12px;
    font-weight: 600;
    z-index: 100;
    animation: slideDown 0.3s ease;
  }

  .system-notification {
    position: fixed;
    top: 160px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 24px;
    background: linear-gradient(135deg, rgb(255 193 7 / 0.9), rgb(255 152 0 / 0.9));
    border-radius: 12px;
    font-weight: 600;
    z-index: 100;
    animation: slideDown 0.3s ease;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .round-overlay,
  .game-over-overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .round-result,
  .game-over-content {
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    padding: 40px 60px;
    border-radius: 20px;
    text-align: center;
    border: 1px solid rgb(255 255 255 / 0.1);
  }

  .round-result h2,
  .game-over-content h2 {
    margin: 0 0 16px;
    font-size: 28px;
  }

  .revealed-word {
    font-size: 20px;
    color: #4ecdc4;
  }

  .winner {
    font-size: 20px;
    color: #ffeaa7;
  }

  .play-again-btn {
    margin-top: 20px;
    padding: 14px 32px;
    font-size: 16px;
    font-weight: 700;
    color: white;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .play-again-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgb(78 205 196 / 0.4);
  }

  .waiting {
    color: rgb(255 255 255 / 0.5);
    font-size: 14px;
  }

  .cannot-draw-indicator {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: rgb(0 0 0 / 0.6);
    border-radius: 10px;
    font-size: 14px;
    color: rgb(255 255 255 / 0.8);
  }
</style>
