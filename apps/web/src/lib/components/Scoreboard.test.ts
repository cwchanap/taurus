// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/svelte'
import Scoreboard from './Scoreboard.svelte'

afterEach(() => {
  cleanup()
})

describe('Scoreboard', () => {
  it('merges connected and disconnected players, sorts by score, and decorates ranks', () => {
    const { container } = render(Scoreboard, {
      scores: {
        'player-1': { name: 'Alice', score: 10 },
        'player-2': { name: 'Bob', score: 30 },
        'player-3': { name: 'Carol', score: 20 },
        'player-4': { name: 'Ghost', score: 40 },
      },
      players: [
        { id: 'player-1', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-2', name: 'Bob', color: '#4ECDC4' },
        { id: 'player-3', name: 'Carol', color: '#45B7D1' },
        { id: 'player-5', name: 'Newcomer', color: '#96CEB4' },
      ],
      currentDrawerId: 'player-2',
      currentPlayerId: 'player-3',
    })

    const rows = Array.from(container.querySelectorAll('.score-row')) as HTMLElement[]
    expect(rows).toHaveLength(5)

    const ranks = rows.map((row) => row.querySelector('.rank')?.textContent?.trim())
    expect(ranks).toEqual(['🥇', '🥈', '🥉', '4', '5'])

    expect(rows[0]?.textContent).toContain('Ghost')
    expect(rows[0]?.textContent).toContain('40')
    expect(
      (rows[0]?.querySelector('.player-indicator') as HTMLElement | null)?.style.backgroundColor
    ).toBe('rgb(136, 136, 136)')

    expect(rows[1]?.classList.contains('is-drawing')).toBe(true)
    expect(rows[1]?.textContent).toContain('Bob')
    expect(rows[1]?.textContent).toContain('🎨')

    expect(rows[2]?.classList.contains('is-you')).toBe(true)
    expect(rows[2]?.textContent).toContain('Carol')
    expect(rows[2]?.textContent).toContain('(you)')

    expect(rows[3]?.textContent).toContain('Alice')
    expect(rows[3]?.textContent).toContain('10')
    expect(rows[4]?.textContent).toContain('Newcomer')
    expect(rows[4]?.textContent).toContain('0')
  })

  it('renders an empty scoreboard when no scores or players are present', () => {
    const { container } = render(Scoreboard, {
      scores: {},
      players: [],
      currentDrawerId: null,
      currentPlayerId: 'player-1',
    })

    const rows = container.querySelectorAll('.score-row')
    expect(rows).toHaveLength(0)
  })

  it('uses default gray color for players not in the connected players list', () => {
    const { container } = render(Scoreboard, {
      scores: {
        'disconnected-1': { name: 'Ghost', score: 50 },
      },
      players: [],
      currentDrawerId: null,
      currentPlayerId: 'player-1',
    })

    const indicator = container.querySelector('.player-indicator') as HTMLElement | null
    expect(indicator?.style.backgroundColor).toBe('rgb(136, 136, 136)')
  })
})
