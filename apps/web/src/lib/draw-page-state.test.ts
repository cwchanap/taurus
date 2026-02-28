import { describe, it, expect } from 'vitest'
import type { FillOperation, ScoreEntry, Stroke } from './types'
import {
  applyRedoState,
  applyUndoState,
  buildGameOverState,
  buildGameResetState,
  buildRoundEndState,
  buildRoundStartState,
  clearCorrectGuessNotification,
  clearSystemNotification,
  createCorrectGuessNotification,
  createSystemNotification,
  deriveWinnersIfGameOver,
  getDrawerDisplayName,
  getTimeRemainingSeconds,
  isEditableKeyboardTarget,
  pushBoundedUndo,
  updateStrokePoint,
  type UndoItem,
} from './draw-page-state'

describe('draw-page-state helpers', () => {
  it('pushBoundedUndo keeps max depth', () => {
    const stroke = {
      id: 's3',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#000',
      size: 4,
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
        color: '#000',
        size: 4,
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
      color: '#000',
      size: 4,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#fff',
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

    const fillResult = applyUndoState([{ type: 'fill', fillId: 'f1', fill }], [], [stroke], [fill])
    expect(fillResult.action).toEqual({ type: 'undo-fill', fillId: 'f1' })
    expect(fillResult.fills).toHaveLength(0)
  })

  it('applyRedoState handles stroke and fill redo branches', () => {
    const stroke: Stroke = {
      id: 's1',
      playerId: 'p1',
      points: [{ x: 1, y: 1 }],
      color: '#000',
      size: 4,
    }
    const fill: FillOperation = {
      id: 'f1',
      playerId: 'p1',
      x: 10,
      y: 10,
      color: '#fff',
      timestamp: Date.now(),
    }

    const strokeRedo = applyRedoState([{ type: 'stroke', strokeId: 's1', stroke }], [], [])
    expect(strokeRedo.action).toEqual({ type: 'send-stroke', stroke })
    expect(strokeRedo.strokes).toHaveLength(1)

    const fillRedo = applyRedoState([{ type: 'fill', fillId: 'f1', fill }], [], [])
    expect(fillRedo.action).toEqual({ type: 'send-fill', x: 10, y: 10, color: '#fff' })
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

    expect(deriveWinnersIfGameOver('game-over', scores, derive)).toHaveLength(1)
    expect(deriveWinnersIfGameOver('playing', scores, derive)).toEqual([])
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

  it('creates and clears notifications via helper transitions', () => {
    expect(createSystemNotification('Round started')).toBe('Round started')
    expect(clearSystemNotification()).toBeNull()

    expect(createCorrectGuessNotification('Alice', 42)).toEqual({ playerName: 'Alice', score: 42 })
    expect(clearCorrectGuessNotification()).toBeNull()
  })
})
