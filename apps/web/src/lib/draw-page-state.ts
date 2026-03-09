import type {
  FillOperation,
  GameStatus,
  PaletteColor,
  Player,
  Point,
  RoundResult,
  ScoreEntry,
  Stroke,
  Winner,
} from './types'

export type UndoItem =
  | { type: 'stroke'; strokeId: string; stroke: Stroke }
  | { type: 'fill'; fillId: string; fill: FillOperation }

export type PendingRedoFillInfo = { item: UndoItem; timestamp: number }

export type PendingOptimisticFillInfo = { tempId: string; timestamp: number }

export function pushBoundedUndo(
  undoStack: UndoItem[],
  item: UndoItem,
  maxDepth: number
): UndoItem[] {
  return [...undoStack.slice(-(maxDepth - 1)), item]
}

export function rebuildUndoStack(
  strokes: Stroke[],
  fills: FillOperation[],
  currentDrawerId: string
): UndoItem[] {
  // Filter operations by the current drawer's ID and sort by timestamp
  const drawerStrokes = strokes
    .filter((s) => s.playerId === currentDrawerId)
    .map((s) => ({ type: 'stroke' as const, strokeId: s.id, stroke: s }))

  const drawerFills = fills
    .filter((f) => f.playerId === currentDrawerId)
    .map((f) => ({ type: 'fill' as const, fillId: f.id, fill: f }))

  // Combine and sort by timestamp to maintain chronological order
  const allOperations = [...drawerStrokes, ...drawerFills].sort((a, b) => {
    const aTimestamp = a.type === 'stroke' ? a.stroke.timestamp : a.fill.timestamp
    const bTimestamp = b.type === 'stroke' ? b.stroke.timestamp : b.fill.timestamp
    return aTimestamp - bTimestamp
  })

  return allOperations
}

export function updateStrokePoint(strokes: Stroke[], strokeId: string, point: Point): Stroke[] {
  const index = strokes.findIndex((stroke) => stroke.id === strokeId)
  if (index === -1) {
    return strokes
  }

  const next = [...strokes]
  const stroke = next[index]
  next[index] = { ...stroke, points: [...stroke.points, point] }
  return next
}

export function applyUndoState(
  undoStack: UndoItem[],
  redoStack: UndoItem[],
  strokes: Stroke[],
  fills: FillOperation[]
): {
  undoStack: UndoItem[]
  redoStack: UndoItem[]
  strokes: Stroke[]
  fills: FillOperation[]
  action: { type: 'undo-stroke'; strokeId: string } | { type: 'undo-fill'; fillId: string } | null
} {
  if (undoStack.length === 0) {
    return { undoStack, redoStack, strokes, fills, action: null }
  }

  const item = undoStack[undoStack.length - 1]
  const nextUndo = undoStack.slice(0, -1)
  const nextRedo = [...redoStack, item]

  if (item.type === 'stroke') {
    return {
      undoStack: nextUndo,
      redoStack: nextRedo,
      strokes: strokes.filter((stroke) => stroke.id !== item.strokeId),
      fills,
      action: { type: 'undo-stroke', strokeId: item.strokeId },
    }
  }

  return {
    undoStack: nextUndo,
    redoStack: nextRedo,
    strokes,
    fills: fills.filter((fill) => fill.id !== item.fillId),
    action: { type: 'undo-fill', fillId: item.fillId },
  }
}

export function applyRedoState(
  redoStack: UndoItem[],
  undoStack: UndoItem[],
  strokes: Stroke[],
  fills: FillOperation[]
): {
  redoStack: UndoItem[]
  undoStack: UndoItem[]
  strokes: Stroke[]
  fills: FillOperation[]
  action:
    | { type: 'send-stroke'; stroke: Stroke }
    | { type: 'send-fill'; x: number; y: number; color: PaletteColor }
    | null
} {
  if (redoStack.length === 0) {
    return { redoStack, undoStack, strokes, fills, action: null }
  }

  const item = redoStack[redoStack.length - 1]
  const nextRedo = redoStack.slice(0, -1)

  if (item.type === 'stroke') {
    // Note: Unlike fill redo, stroke redo reuses the original stroke ID.
    // We do NOT optimistically add to strokes or undoStack here because:
    // 1. The server broadcasts 'stroke' to ALL players (including sender) for redo
    // 2. The onStroke handler will add the stroke when echoed back
    // 3. This avoids race conditions with pending 'stroke-removed' broadcasts
    return {
      redoStack: nextRedo,
      undoStack,
      strokes,
      fills,
      action: { type: 'send-stroke', stroke: item.stroke },
    }
  }

  // Note: undoStack is NOT updated here for fills - the server generates a new fill ID
  // and the onFill handler will add the new fill to state/undo stack when echoed back
  return {
    redoStack: nextRedo,
    undoStack,
    strokes,
    fills,
    action: {
      type: 'send-fill',
      x: item.fill.x,
      y: item.fill.y,
      color: item.fill.color,
    },
  }
}

export function syncUndoStrokeTimestamp(
  undoStack: UndoItem[],
  strokeId: string,
  timestamp: number
): UndoItem[] {
  let changed = false
  const nextUndo = undoStack.map((item) => {
    if (
      item.type !== 'stroke' ||
      item.strokeId !== strokeId ||
      item.stroke.timestamp === timestamp
    ) {
      return item
    }

    changed = true
    return {
      type: 'stroke' as const,
      strokeId: item.strokeId,
      stroke: {
        ...item.stroke,
        timestamp,
      },
    }
  })

  return changed ? nextUndo : undoStack
}

export function rollbackPendingRedoMarker(
  pendingRedoStrokes: Map<string, UndoItem>,
  pendingRedoFills: Map<string, PendingRedoFillInfo>,
  strokeId?: string,
  fillNonce?: string
): {
  pendingRedoStrokes: Map<string, UndoItem>
  pendingRedoFills: Map<string, PendingRedoFillInfo>
} {
  const nextPendingRedoStrokes = new Map(pendingRedoStrokes)
  const nextPendingRedoFills = new Map(pendingRedoFills)

  if (strokeId) {
    nextPendingRedoStrokes.delete(strokeId)
  }

  if (fillNonce) {
    nextPendingRedoFills.delete(fillNonce)
  }

  return {
    pendingRedoStrokes: nextPendingRedoStrokes,
    pendingRedoFills: nextPendingRedoFills,
  }
}

export function discardPendingOptimisticFills(
  fills: FillOperation[],
  undoStack: UndoItem[],
  pendingOptimisticFills: Map<string, PendingOptimisticFillInfo>
): {
  fills: FillOperation[]
  undoStack: UndoItem[]
  pendingOptimisticFills: Map<string, PendingOptimisticFillInfo>
} {
  if (pendingOptimisticFills.size === 0) {
    return { fills, undoStack, pendingOptimisticFills }
  }

  const tempIds = new Set(Array.from(pendingOptimisticFills.values(), (pending) => pending.tempId))

  return {
    fills: fills.filter((fill) => !tempIds.has(fill.id)),
    undoStack: undoStack.filter((item) => !(item.type === 'fill' && tempIds.has(item.fillId))),
    pendingOptimisticFills: new Map(),
  }
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    target.getAttribute('role') === 'textbox'
  )
}

export function getDrawerDisplayName(
  currentDrawerId: string | null,
  players: Player[],
  scores: Record<string, ScoreEntry>
): string {
  if (!currentDrawerId) {
    return ''
  }

  const drawer = players.find((player) => player.id === currentDrawerId)
  if (drawer) {
    return drawer.name
  }

  return scores[currentDrawerId]?.name || 'Unknown'
}

export function getTimeRemainingSeconds(
  roundEndTime: number | null | undefined,
  now = Date.now()
): number {
  if (!roundEndTime) {
    return 0
  }
  return Math.max(0, Math.ceil((roundEndTime - now) / 1000))
}

export function deriveWinnersIfGameOver(
  status: string,
  scores: Record<string, ScoreEntry>,
  deriveGameWinners: (scores: Record<string, ScoreEntry>) => Winner[]
): Winner[] {
  if (status === 'game-over') {
    return deriveGameWinners(scores)
  }
  return []
}

export function buildRoundStartState(
  roundNumber: number,
  totalRounds: number,
  drawerId: string,
  drawerName: string,
  word: string | undefined,
  wordLength: number,
  endTime: number
): {
  roundNumber: number
  totalRounds: number
  currentDrawerId: string
  currentDrawerName: string
  currentWord: string | undefined
  wordLength: number
  timeRemaining: number
  gameStatus: GameStatus
  lastRoundResult: RoundResult | null
  undoStack: UndoItem[]
  redoStack: UndoItem[]
  correctGuessNotification: { playerName: string; score: number } | null
} {
  return {
    roundNumber,
    totalRounds,
    currentDrawerId: drawerId,
    currentDrawerName: drawerName,
    currentWord: word,
    wordLength,
    timeRemaining: getTimeRemainingSeconds(endTime),
    gameStatus: 'playing',
    lastRoundResult: null,
    undoStack: [],
    redoStack: [],
    correctGuessNotification: null,
  }
}

export function buildRoundEndState(
  word: string,
  result: RoundResult,
  scores: Record<string, ScoreEntry>
): {
  lastRevealedWord: string
  lastRoundResult: RoundResult
  scores: Record<string, ScoreEntry>
  gameStatus: GameStatus
  currentWord: undefined
  currentDrawerId: null
  currentDrawerName: ''
  wordLength: 0
} {
  return {
    lastRevealedWord: word,
    lastRoundResult: result,
    scores,
    gameStatus: 'round-end',
    currentWord: undefined,
    currentDrawerId: null,
    currentDrawerName: '',
    wordLength: 0,
  }
}

export function buildGameOverState(
  scores: Record<string, ScoreEntry>,
  winners: Winner[]
): {
  scores: Record<string, ScoreEntry>
  gameWinners: Winner[]
  gameStatus: GameStatus
  currentDrawerId: null
  currentWord: undefined
} {
  return {
    scores,
    gameWinners: winners,
    gameStatus: 'game-over',
    currentDrawerId: null,
    currentWord: undefined,
  }
}

export function buildGameResetState(): {
  gameStatus: GameStatus
  gameWinners: Winner[]
  lastRoundResult: RoundResult | null
  scores: Record<string, ScoreEntry>
  currentDrawerId: null
  currentWord: undefined
  lastRevealedWord: ''
  roundNumber: 0
  totalRounds: 0
  strokes: Stroke[]
  fills: FillOperation[]
  undoStack: UndoItem[]
  redoStack: UndoItem[]
  correctGuessNotification: { playerName: string; score: number } | null
  systemNotification: string | null
} {
  return {
    gameStatus: 'lobby',
    gameWinners: [],
    lastRoundResult: null,
    scores: {},
    currentDrawerId: null,
    currentWord: undefined,
    lastRevealedWord: '',
    roundNumber: 0,
    totalRounds: 0,
    strokes: [],
    fills: [],
    undoStack: [],
    redoStack: [],
    correctGuessNotification: null,
    systemNotification: null,
  }
}

export function createCorrectGuessNotification(
  playerName: string,
  score: number
): { playerName: string; score: number } {
  return { playerName, score }
}

export function clearCorrectGuessNotification(): null {
  return null
}
