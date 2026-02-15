import { describe, expect, it } from 'vitest'
import { deriveGameWinners } from './game-winners'

describe('deriveGameWinners', () => {
  it('returns empty array when no scores are present', () => {
    expect(deriveGameWinners({})).toEqual([])
  })

  it('returns single winner with highest score', () => {
    const winners = deriveGameWinners({
      p1: { name: 'Alice', score: 100 },
      p2: { name: 'Bob', score: 80 },
    })

    expect(winners).toEqual([
      {
        playerId: 'p1',
        playerName: 'Alice',
        score: 100,
      },
    ])
  })

  it('returns all tied winners with highest score', () => {
    const winners = deriveGameWinners({
      p1: { name: 'Alice', score: 120 },
      p2: { name: 'Bob', score: 120 },
      p3: { name: 'Cara', score: 90 },
    })

    expect(winners).toEqual([
      {
        playerId: 'p1',
        playerName: 'Alice',
        score: 120,
      },
      {
        playerId: 'p2',
        playerName: 'Bob',
        score: 120,
      },
    ])
  })
})
