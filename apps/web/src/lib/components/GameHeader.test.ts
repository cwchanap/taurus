// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import GameHeader from './GameHeader.svelte'

afterEach(() => {
  cleanup()
})

describe('GameHeader', () => {
  it('renders masked word and urgent timer details for guessers', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 5,
      timeRemaining: 9.4,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 2,
      totalRounds: 4,
    })

    expect(screen.getByText('Round 2/4')).toBeTruthy()
    expect(screen.getByText('_ _ _ _ _')).toBeTruthy()
    expect(screen.getByText('(5 letters)')).toBeTruthy()
    expect(screen.getByText('0:09')).toBeTruthy()
    expect(screen.getByText('🎨 Bob is drawing')).toBeTruthy()
    expect(container.querySelector('.timer-display')?.classList.contains('urgent')).toBe(true)
  })

  it('renders the current word and warning timer for the active drawer', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: 'cat',
      wordLength: 3,
      timeRemaining: 25,
      currentDrawerName: 'Alice',
      isCurrentDrawer: true,
      roundNumber: 1,
      totalRounds: 3,
    })

    expect(screen.getByText('Draw:')).toBeTruthy()
    expect(screen.getByText('cat')).toBeTruthy()
    expect(screen.getByText("🎨 You're drawing!")).toBeTruthy()
    expect(container.querySelector('.timer-display')?.classList.contains('warning')).toBe(true)
  })

  it('renders the round-over state with a fallback drawer name', () => {
    const { container } = render(GameHeader, {
      status: 'round-end',
      currentWord: undefined,
      wordLength: 0,
      timeRemaining: 0,
      currentDrawerName: '',
      isCurrentDrawer: false,
      roundNumber: 3,
      totalRounds: 3,
    })

    expect(screen.getByText('Round Over')).toBeTruthy()
    expect(screen.getByText('🎨 Someone is drawing')).toBeTruthy()
    expect(container.querySelector('.timer-display')?.classList.contains('round-over')).toBe(true)
  })
})
