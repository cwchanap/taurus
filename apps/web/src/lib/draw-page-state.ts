import type {
  FillOperation,
  GameStatus,
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

export function pushBoundedUndo(
  undoStack: UndoItem[],
  item: UndoItem,
  maxDepth: number
): UndoItem[] {
  return [...undoStack.slice(-(maxDepth - 1)), item]
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
  strokes: Stroke[]
): {
  redoStack: UndoItem[]
  undoStack: UndoItem[]
  strokes: Stroke[]
  action:
    | { type: 'send-stroke'; stroke: Stroke }
    | { type: 'send-fill'; x: number; y: number; color: string }
    | null
} {
  if (redoStack.length === 0) {
    return { redoStack, undoStack, strokes, action: null }
  }

  const item = redoStack[redoStack.length - 1]
  const nextRedo = redoStack.slice(0, -1)

  if (item.type === 'stroke') {
    return {
      redoStack: nextRedo,
      undoStack: [...undoStack, item],
      strokes: [...strokes, item.stroke],
      action: { type: 'send-stroke', stroke: item.stroke },
    }
  }

  return {
    redoStack: nextRedo,
    undoStack,
    strokes,
    action: {
      type: 'send-fill',
      x: item.fill.x,
      y: item.fill.y,
      color: item.fill.color,
    },
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

export function createSystemNotification(content: string): string {
  return content
}

export function clearSystemNotification(): null {
  return null
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
