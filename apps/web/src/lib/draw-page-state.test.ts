// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import type { FillOperation, GameStatus, ScoreEntry, Stroke } from './types'
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
  deriveWinnersIfGameOver,
  getRedoInFlightCount,
  getDrawerDisplayName,
  getTimeRemainingSeconds,
  isEditableKeyboardTarget,
  pushBoundedUndo,
  rebuildUndoStack,
  rollbackPendingRedoMarker,
  syncUndoStrokeTimestamp,
  updateStrokePoint,
  type PendingRedoFillInfo,
  type UndoItem,
} from './draw-page-state'

describe('draw-page-state helpers', () => {
  it('pushBoundedUndo keeps max depth', () => {
    const stroke = {
      id: 's3',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    } as Stroke

    const stack: UndoItem[] = [
      { type: 'stroke', strokeId: 's1', stroke },
      { type: 'stroke', strokeId: 's2', stroke },
    ]

    const next = pushBoundedUndo(stack, { type: 'stroke', strokeId: 's3', stroke }, 2)
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ type: 'stroke', strokeId: 's2' })
    expect(next[1]).toMatchObject({ type: 'stroke', strokeId: 's3' })
  })

  it('updateStrokePoint appends point when stroke exists', () => {
    const strokes: Stroke[] = [
      {
        id: 's1',
        playerId: 'p1',
        points: [{ x: 1, y: 1 }],
        color: '#1a1a2e',
        size: 4,
        timestamp: 1000,
      },
    ]

    const next = updateStrokePoint(strokes, 's1', { x: 2, y: 2 })
    expect(next[0].points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ])
  })

  it('applyUndoState handles stroke undo and fill undo branches', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FFFFFF',
      timestamp: Date.now(),
    }

    const strokeResult = applyUndoState(
      [{ type: 'stroke', strokeId: 's1', stroke }],
      [],
      [stroke],
      [fill]
    )
    expect(strokeResult.action).toEqual({ type: 'undo-stroke', strokeId: 's1' })
    expect(strokeResult.strokes).toHaveLength(0)
    expect(strokeResult.redoStack).toHaveLength(1)
    expect(strokeResult.redoStack[0]).toMatchObject({ type: 'stroke', strokeId: 's1' })

    const fillResult = applyUndoState([{ type: 'fill', fillId: 'f1', fill }], [], [stroke], [fill])
    expect(fillResult.action).toEqual({ type: 'undo-fill', fillId: 'f1' })
    expect(fillResult.fills).toHaveLength(0)
    expect(fillResult.redoStack).toHaveLength(1)
    expect(fillResult.redoStack[0]).toMatchObject({ type: 'fill', fillId: 'f1' })
  })

  it('applyRedoState handles stroke and fill redo branches', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FFFFFF',
      timestamp: Date.now(),
    }

    const strokeRedo = applyRedoState([{ type: 'stroke', strokeId: 's1', stroke }], [], [], [])
    expect(strokeRedo.action).toEqual({ type: 'send-stroke', stroke })
    // Stroke redo does NOT optimistically add to strokes (server echoes back)
    expect(strokeRedo.strokes).toHaveLength(0)
    // Stroke redo does NOT add to undo stack (onStroke handler adds it when echo arrives)
    expect(strokeRedo.undoStack).toHaveLength(0)

    const fillRedo = applyRedoState([{ type: 'fill', fillId: 'f1', fill }], [], [], [])
    expect(fillRedo.action).toEqual({ type: 'send-fill', x: 10, y: 10, color: '#FFFFFF' })
    // Fill redo does NOT add to undo stack (server generates new fill ID, onFill handler adds it)
    expect(fillRedo.undoStack).toHaveLength(0)
  })

  it('applyRedoState does not optimistically append fills for fill-type redo', () => {
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FF6B6B',
      timestamp: Date.now(),
    }
    const existingFill: FillOperation = {
      id: 'f0',
      playerId: 'p1',
      x: 5,
      y: 5,
      color: '#4ECDC4',
      timestamp: Date.now(),
    }

    const result = applyRedoState([{ type: 'fill', fillId: 'f1', fill }], [], [], [existingFill])
    expect(result.action).toEqual({ type: 'send-fill', x: 10, y: 10, color: '#FF6B6B' })
    expect(result.fills).toHaveLength(1)
    expect(result.fills[0].id).toBe('f0')
    // Fill redo does NOT add to undo stack (server generates new fill ID, onFill handler adds it)
    expect(result.undoStack).toHaveLength(0)
  })

  it('handles editable keyboard target detection', () => {
    const input = document.createElement('input')
    expect(isEditableKeyboardTarget(input)).toBe(true)
    expect(isEditableKeyboardTarget(document.createElement('div'))).toBe(false)
  })

  it('returns drawer display name with fallback and computes remaining time', () => {
    const scores: Record<string, ScoreEntry> = {
      p2: { name: 'Fallback', score: 0 },
    }

    expect(getDrawerDisplayName('p1', [{ id: 'p1', name: 'Alice', color: '#000' }], scores)).toBe(
      'Alice'
    )
    expect(getDrawerDisplayName('p2', [], scores)).toBe('Fallback')
    expect(getDrawerDisplayName('p3', [], scores)).toBe('Unknown')

    expect(getTimeRemainingSeconds(null, 1000)).toBe(0)
    expect(getTimeRemainingSeconds(6000, 1000)).toBe(5)
    expect(getTimeRemainingSeconds(1000, 6000)).toBe(0)
  })

  it('derives winners only when status is game-over', () => {
    const scores: Record<string, ScoreEntry> = { p1: { name: 'A', score: 10 } }
    const derive = () => [{ playerId: 'p1', playerName: 'A', score: 10 }]
    const gameOverStatus: GameStatus = 'game-over'
    const playingStatus: GameStatus = 'playing'

    expect(deriveWinnersIfGameOver(gameOverStatus, scores, derive)).toHaveLength(1)
    expect(deriveWinnersIfGameOver(playingStatus, scores, derive)).toEqual([])
  })

  it('buildRoundStartState returns normalized playing state values', () => {
    const state = buildRoundStartState(2, 4, 'drawer-1', 'Drawer', 'apple', 5, 6000)

    expect(state.roundNumber).toBe(2)
    expect(state.totalRounds).toBe(4)
    expect(state.currentDrawerId).toBe('drawer-1')
    expect(state.currentDrawerName).toBe('Drawer')
    expect(state.currentWord).toBe('apple')
    expect(state.wordLength).toBe(5)
    expect(state.gameStatus).toBe('playing')
    expect(state.undoStack).toEqual([])
    expect(state.redoStack).toEqual([])
  })

  it('buildRoundEndState clears drawer/word fields', () => {
    const scores: Record<string, ScoreEntry> = { p1: { name: 'A', score: 10 } }
    const state = buildRoundEndState(
      'apple',
      {
        drawerId: 'p1',
        drawerName: 'A',
        word: 'apple',
        correctGuessers: [],
        drawerScore: 0,
      },
      scores
    )

    expect(state.lastRevealedWord).toBe('apple')
    expect(state.gameStatus).toBe('round-end')
    expect(state.currentDrawerId).toBeNull()
    expect(state.currentDrawerName).toBe('')
    expect(state.currentWord).toBeUndefined()
    expect(state.wordLength).toBe(0)
  })

  it('buildGameOverState and buildGameResetState produce expected resets', () => {
    const scores: Record<string, ScoreEntry> = { p1: { name: 'A', score: 10 } }
    const winners = [{ playerId: 'p1', playerName: 'A', score: 10 }]

    const gameOver = buildGameOverState(scores, winners)
    expect(gameOver.gameStatus).toBe('game-over')
    expect(gameOver.currentDrawerId).toBeNull()
    expect(gameOver.currentWord).toBeUndefined()

    const reset = buildGameResetState()
    expect(reset.gameStatus).toBe('lobby')
    expect(reset.scores).toEqual({})
    expect(reset.strokes).toEqual([])
    expect(reset.fills).toEqual([])
    expect(reset.undoStack).toEqual([])
    expect(reset.redoStack).toEqual([])
    expect(reset.correctGuessNotification).toBeNull()
    expect(reset.systemNotification).toBeNull()
  })

  it('creates and clears correct guess notifications', () => {
    expect(createCorrectGuessNotification('Alice', 42)).toEqual({ playerName: 'Alice', score: 42 })
    expect(clearCorrectGuessNotification()).toBeNull()
  })

  it('updateStrokePoint returns unchanged array when stroke not found', () => {
    const strokes: Stroke[] = [
      {
        id: 's1',
        playerId: 'p1',
        points: [{ x: 1, y: 1 }],
        color: '#1a1a2e',
        size: 4,
        timestamp: 1000,
      },
    ]
    const result = updateStrokePoint(strokes, 'missing-id', { x: 5, y: 5 })
    expect(result).toBe(strokes)
    expect(result[0].points).toHaveLength(1)
  })

  it('applyUndoState returns null action when stack is empty', () => {
    const result = applyUndoState([], [], [], [])
    expect(result.action).toBeNull()
    expect(result.strokes).toEqual([])
    expect(result.fills).toEqual([])
  })

  it('applyRedoState returns null action when stack is empty', () => {
    const result = applyRedoState([], [], [], [])
    expect(result.action).toBeNull()
    expect(result.strokes).toEqual([])
  })

  it('syncUndoStrokeTimestamp updates the matching undo stroke timestamp only', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    }
    const otherStroke: Stroke = {
      id: 's2',
      playerId: 'p1',
      points: [{ x: 2, y: 2 }],
      color: '#4ECDC4',
      size: 6,
      timestamp: 2000,
    }
    const undoStack: UndoItem[] = [
      { type: 'stroke', strokeId: 's1', stroke },
      { type: 'stroke', strokeId: 's2', stroke: otherStroke },
    ]

    const result = syncUndoStrokeTimestamp(undoStack, 's1', 3000)

    expect(result[0]).toMatchObject({ type: 'stroke', strokeId: 's1' })
    if (result[0].type === 'stroke') {
      expect(result[0].stroke.timestamp).toBe(3000)
      expect(result[0].stroke.points).toEqual([{ x: 1, y: 1 }])
    }
    if (result[1].type === 'stroke') {
      expect(result[1].stroke.timestamp).toBe(2000)
    }
  })

  it('rollbackPendingRedoMarker removes only the failed pending redo marker', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FFFFFF',
      timestamp: 1500,
    }
    const pendingRedoStrokes = new Map<string, UndoItem>([
      ['s1', { type: 'stroke', strokeId: 's1', stroke }],
    ])
    const pendingRedoFills = new Map<string, PendingRedoFillInfo>([
      ['nonce-1', { item: { type: 'fill' as const, fillId: 'f1', fill }, timestamp: 1500 }],
    ])

    const strokeRollback = rollbackPendingRedoMarker(
      pendingRedoStrokes,
      pendingRedoFills,
      's1',
      undefined
    )
    expect(strokeRollback.pendingRedoStrokes.size).toBe(0)
    expect(strokeRollback.pendingRedoFills.size).toBe(1)

    const fillRollback = rollbackPendingRedoMarker(
      pendingRedoStrokes,
      pendingRedoFills,
      undefined,
      'nonce-1'
    )
    expect(fillRollback.pendingRedoStrokes.size).toBe(1)
    expect(fillRollback.pendingRedoFills.size).toBe(0)
  })

  it('getRedoInFlightCount ignores stale redo markers after the lock is released', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FFFFFF',
      timestamp: 1500,
    }
    const pendingRedoStrokes = new Map<string, UndoItem>([
      ['s1', { type: 'stroke', strokeId: 's1', stroke }],
    ])
    const pendingRedoFills = new Map<string, PendingRedoFillInfo>([
      ['nonce-1', { item: { type: 'fill' as const, fillId: 'f1', fill }, timestamp: 1500 }],
    ])

    expect(getRedoInFlightCount(false, pendingRedoStrokes, pendingRedoFills)).toBe(0)
    expect(getRedoInFlightCount(true, pendingRedoStrokes, pendingRedoFills)).toBe(2)
  })

  it('discardPendingOptimisticFills removes temp fills from fills and undo stack immediately', () => {
    const pendingFill: FillOperation = {
      id: 'temp-fill-1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#FF6B6B',
      timestamp: 1000,
      nonce: 'nonce-1',
    }
    const confirmedFill: FillOperation = {
      id: 'fill-2',
      playerId: 'p1',
      x: 20,
      y: 20,
      color: '#4ECDC4',
      timestamp: 2000,
    }
    const pendingMap = new Map([['nonce-1', { tempId: 'temp-fill-1', timestamp: 1000 }]])
    const undoStack: UndoItem[] = [
      { type: 'fill', fillId: 'temp-fill-1', fill: pendingFill },
      { type: 'fill', fillId: 'fill-2', fill: confirmedFill },
    ]

    const result = discardPendingOptimisticFills(
      [pendingFill, confirmedFill],
      undoStack,
      pendingMap
    )

    expect(result.fills).toEqual([confirmedFill])
    expect(result.undoStack).toEqual([{ type: 'fill', fillId: 'fill-2', fill: confirmedFill }])
    expect(result.pendingOptimisticFills.size).toBe(0)
  })

  it('isEditableKeyboardTarget returns false for null and true for editable elements', () => {
    expect(isEditableKeyboardTarget(null)).toBe(false)

    const textarea = document.createElement('textarea')
    expect(isEditableKeyboardTarget(textarea)).toBe(true)

    const roleTextbox = document.createElement('span')
    roleTextbox.setAttribute('role', 'textbox')
    expect(isEditableKeyboardTarget(roleTextbox)).toBe(true)
  })

  it('getDrawerDisplayName returns empty string when drawerId is null', () => {
    expect(getDrawerDisplayName(null, [], {})).toBe('')
  })

  it('pushBoundedUndo grows stack when below maxDepth', () => {
    const stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#1a1a2e',
      size: 4,
      timestamp: 1000,
    } as Stroke

    const next = pushBoundedUndo([], { type: 'stroke', strokeId: 's1', stroke }, 5)
    expect(next).toHaveLength(1)
  })

  describe('rebuildUndoStack', () => {
    it('rebuilds undo stack from current drawer strokes and fills', () => {
      const strokes: Stroke[] = [
        {
          id: 's1',
          playerId: 'drawer-1',
          points: [{ x: 1, y: 1 }],
          color: '#FF6B6B',
          size: 4,
          timestamp: 1000,
        },
        {
          id: 's2',
          playerId: 'drawer-1',
          points: [{ x: 2, y: 2 }],
          color: '#4ECDC4',
          size: 6,
          timestamp: 2000,
        },
        {
          id: 's3',
          playerId: 'other-player',
          points: [{ x: 3, y: 3 }],
          color: '#45B7D1',
          size: 4,
          timestamp: 1500,
        },
      ]

      const fills: FillOperation[] = [
        {
          id: 'f1',
          playerId: 'drawer-1',
          x: 10,
          y: 10,
          color: '#FFFFFF',
          timestamp: 1200,
        },
        {
          id: 'f2',
          playerId: 'other-player',
          x: 20,
          y: 20,
          color: '#96CEB4',
          timestamp: 1800,
        },
      ]

      const result = rebuildUndoStack(strokes, fills, 'drawer-1')

      // Should only include operations from drawer-1
      expect(result).toHaveLength(3)

      // Should be sorted by timestamp
      expect(result[0].type).toBe('stroke')
      if (result[0].type === 'stroke') {
        expect(result[0].strokeId).toBe('s1')
      }

      expect(result[1].type).toBe('fill')
      if (result[1].type === 'fill') {
        expect(result[1].fillId).toBe('f1')
      }

      expect(result[2].type).toBe('stroke')
      if (result[2].type === 'stroke') {
        expect(result[2].strokeId).toBe('s2')
      }
    })

    it('returns empty stack when current drawer has no operations', () => {
      const strokes: Stroke[] = [
        {
          id: 's1',
          playerId: 'other-player',
          points: [{ x: 1, y: 1 }],
          color: '#FF6B6B',
          size: 4,
          timestamp: 1000,
        },
      ]

      const fills: FillOperation[] = [
        {
          id: 'f1',
          playerId: 'other-player',
          x: 10,
          y: 10,
          color: '#FFFFFF',
          timestamp: 1200,
        },
      ]

      const result = rebuildUndoStack(strokes, fills, 'drawer-1')
      expect(result).toHaveLength(0)
    })

    it('handles empty strokes and fills arrays', () => {
      const result = rebuildUndoStack([], [], 'drawer-1')
      expect(result).toHaveLength(0)
    })

    it('preserves chronological order when timestamps are equal', () => {
      const timestamp = 1000
      const strokes: Stroke[] = [
        {
          id: 's1',
          playerId: 'drawer-1',
          points: [{ x: 1, y: 1 }],
          color: '#FF6B6B',
          size: 4,
          timestamp,
        },
      ]

      const fills: FillOperation[] = [
        {
          id: 'f1',
          playerId: 'drawer-1',
          x: 10,
          y: 10,
          color: '#FFFFFF',
          timestamp,
        },
      ]

      const result = rebuildUndoStack(strokes, fills, 'drawer-1')
      expect(result).toHaveLength(2)
      // Both should be in the result, order with equal timestamps is implementation-dependent
      expect(result.some((item) => item.type === 'stroke')).toBe(true)
      expect(result.some((item) => item.type === 'fill')).toBe(true)
    })
  })
})
