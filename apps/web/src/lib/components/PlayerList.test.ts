// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/svelte'
import PlayerList from './PlayerList.svelte'

afterEach(() => {
  cleanup()
})

describe('PlayerList', () => {
  it('renders fallback initials and colors while highlighting the current player', () => {
    const { container } = render(PlayerList, {
      players: [
        { id: 'player-1', name: '   ', color: 'not-a-color' },
        { id: 'player-2', name: 'Alice', color: '#FF6B6B' },
      ],
      currentPlayerId: 'player-2',
    })

    const avatars = Array.from(container.querySelectorAll('.avatar')) as HTMLElement[]
    expect(avatars[0]?.textContent?.trim()).toBe('?')
    expect(avatars[0]?.style.backgroundColor).toBe('rgb(78, 205, 196)')
    expect(avatars[1]?.textContent?.trim()).toBe('A')

    const currentRow = container.querySelector('.player.current') as HTMLElement | null
    expect(currentRow).not.toBeNull()
    expect(currentRow?.textContent).toContain('Alice')
    expect(currentRow?.textContent).toContain('(you)')
  })

  it('renders no players when list is empty', () => {
    const { container } = render(PlayerList, {
      players: [],
      currentPlayerId: 'player-1',
    })

    const playerItems = container.querySelectorAll('.player')
    expect(playerItems).toHaveLength(0)
  })

  it('does not show (you) tag for other players', () => {
    const { container } = render(PlayerList, {
      players: [
        { id: 'player-1', name: 'Alice', color: '#FF6B6B' },
        { id: 'player-2', name: 'Bob', color: '#4ECDC4' },
      ],
      currentPlayerId: 'player-3',
    })

    expect(container.querySelector('.you')).toBeNull()
    expect(container.querySelector('.player.current')).toBeNull()
  })
})

it('shows (you) tag only for the current player when multiple players exist', () => {
  const { container } = render(PlayerList, {
    players: [
      { id: 'player-1', name: 'Alice', color: '#FF6B6B' },
      { id: 'player-2', name: 'Bob', color: '#4ECDC4' },
      { id: 'player-3', name: 'Carol', color: '#45B7D1' },
    ],
    currentPlayerId: 'player-2',
  })

  const currentRow = container.querySelector('.player.current')
  expect(currentRow?.textContent).toContain('Bob')
  expect(currentRow?.textContent).toContain('(you)')

  // Other rows should NOT have (you)
  const allRows = Array.from(container.querySelectorAll('.player'))
  const nonCurrentRows = allRows.filter((r) => !r.classList.contains('current'))
  nonCurrentRows.forEach((row) => {
    expect(row.textContent).not.toContain('(you)')
  })
})
