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

  it('renders nothing when status is lobby', () => {
    const { container } = render(GameHeader, {
      status: 'lobby',
      currentWord: undefined,
      wordLength: 0,
      timeRemaining: 60,
      currentDrawerName: 'Alice',
      isCurrentDrawer: false,
      roundNumber: 0,
      totalRounds: 3,
    })

    expect(container.querySelector('.game-header')).toBeNull()
  })

  it('renders nothing when status is starting', () => {
    const { container } = render(GameHeader, {
      status: 'starting',
      currentWord: undefined,
      wordLength: 0,
      timeRemaining: 0,
      currentDrawerName: '',
      isCurrentDrawer: false,
      roundNumber: 0,
      totalRounds: 3,
    })

    expect(container.querySelector('.game-header')).toBeNull()
  })

  it('shows masked word placeholder for guesser when word length is positive', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 3,
      timeRemaining: 45,
      currentDrawerName: 'Carol',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 2,
    })

    expect(screen.getByText('_ _ _')).toBeTruthy()
  })

  it('shows no masked word when word length is zero for guesser', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 0,
      timeRemaining: 30,
      currentDrawerName: 'Dave',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 2,
    })

    expect(container.querySelector('.word.masked')).toBeNull()
  })

  it('applies warning timer class when time is between 11 and 30 seconds', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: 'apple',
      wordLength: 5,
      timeRemaining: 20,
      currentDrawerName: 'Eve',
      isCurrentDrawer: true,
      roundNumber: 2,
      totalRounds: 3,
    })

    expect(container.querySelector('.timer-display')?.classList.contains('warning')).toBe(true)
  })

  it('applies warning class at exactly 30 seconds (boundary)', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: 'apple',
      wordLength: 5,
      timeRemaining: 30,
      currentDrawerName: 'Eve',
      isCurrentDrawer: true,
      roundNumber: 2,
      totalRounds: 3,
    })

    expect(container.querySelector('.timer-display')?.classList.contains('warning')).toBe(true)
    expect(container.querySelector('.timer-display')?.classList.contains('urgent')).toBe(false)
  })

  it('applies urgent class at exactly 10 seconds (boundary)', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: 'apple',
      wordLength: 5,
      timeRemaining: 10,
      currentDrawerName: 'Eve',
      isCurrentDrawer: true,
      roundNumber: 2,
      totalRounds: 3,
    })

    expect(container.querySelector('.timer-display')?.classList.contains('urgent')).toBe(true)
    expect(container.querySelector('.timer-display')?.classList.contains('warning')).toBe(false)
  })

  it('shows 0:00 timer when timeRemaining is exactly zero', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 4,
      timeRemaining: 0,
      currentDrawerName: 'Alice',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 3,
    })

    expect(screen.getByText('0:00')).toBeTruthy()
  })

  it('shows no timer class when time remaining is above 30 seconds', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: 'elephant',
      wordLength: 8,
      timeRemaining: 55,
      currentDrawerName: 'Alice',
      isCurrentDrawer: true,
      roundNumber: 1,
      totalRounds: 2,
    })

    const timerDisplay = container.querySelector('.timer-display')
    expect(timerDisplay?.classList.contains('warning')).toBe(false)
    expect(timerDisplay?.classList.contains('urgent')).toBe(false)
    expect(timerDisplay?.classList.contains('round-over')).toBe(false)
  })

  it('shows fallback dash when currentWord is undefined for drawer', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 5,
      timeRemaining: 45,
      currentDrawerName: 'Alice',
      isCurrentDrawer: true,
      roundNumber: 2,
      totalRounds: 3,
    })

    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders Choosing word... with round-over timer class when status is word-choice', () => {
    const { container } = render(GameHeader, {
      status: 'word-choice',
      currentWord: undefined,
      wordLength: 0,
      timeRemaining: 0,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 2,
      totalRounds: 4,
    })

    expect(screen.getByText('Choosing word...')).toBeTruthy()
    expect(container.querySelector('.timer-display')?.classList.contains('round-over')).toBe(true)
    expect(container.querySelector('.timer-display')?.classList.contains('urgent')).toBe(false)
  })

  it('renders hintString in place of maskedWord when provided', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 5,
      timeRemaining: 30,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 3,
      hintString: 'a _ _ l e',
    })

    expect(screen.getByText('a _ _ l e')).toBeTruthy()
    // Masked word should NOT appear when hintString is set
    expect(screen.queryByText('_ _ _ _ _')).toBeNull()
  })

  it('shows correct letter count when hintString contains spaces (multi-word target)', () => {
    const { container } = render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 7, // "hot dog" is 7 chars including space
      timeRemaining: 30,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 3,
      hintString: '_ _ _   _ _ _', // space preserved in hint
    })

    // Use textContent since innerText collapses consecutive spaces
    const maskedEl = container.querySelector('.word.masked')
    expect(maskedEl).toBeTruthy()
    expect(maskedEl?.textContent).toBe('_ _ _   _ _ _')
    // Letter count should exclude the space: 6 letters, not 7
    expect(screen.getByText('(6 letters)')).toBeTruthy()
  })

  it('shows correct letter count when hintString contains hyphens', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 9, // "ice-cream" is 9 chars including hyphen
      timeRemaining: 30,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 3,
      hintString: '_ _ _ - _ _ _ _ _',
    })

    expect(screen.getByText('_ _ _ - _ _ _ _ _')).toBeTruthy()
    // Letter count should exclude hyphen: 8 letters, not 9
    expect(screen.getByText('(8 letters)')).toBeTruthy()
  })

  it('falls back to wordLength for letter count when no hintString', () => {
    render(GameHeader, {
      status: 'playing',
      currentWord: undefined,
      wordLength: 5,
      timeRemaining: 30,
      currentDrawerName: 'Bob',
      isCurrentDrawer: false,
      roundNumber: 1,
      totalRounds: 3,
    })

    // No hintString → falls back to wordLength
    expect(screen.getByText('(5 letters)')).toBeTruthy()
  })
})
