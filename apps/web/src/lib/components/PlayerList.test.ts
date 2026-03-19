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
})
