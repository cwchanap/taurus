import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { clearTimers, type TimerContainer } from './game-logic'

describe('Timer Cleanup', () => {
  let timers: {
    roundTimer: ReturnType<typeof setTimeout> | null
    tickTimer: ReturnType<typeof setInterval> | null
    roundEndTimer: ReturnType<typeof setTimeout> | null
    gameEndTimer: ReturnType<typeof setTimeout> | null
  }

  beforeEach(() => {
    timers = {
      roundTimer: null,
      tickTimer: null,
      roundEndTimer: null,
      gameEndTimer: null,
    }
  })

  afterEach(() => {
    // Clean up any timers created during tests
    if (timers.roundTimer) clearTimeout(timers.roundTimer)
    if (timers.tickTimer) clearInterval(timers.tickTimer)
    if (timers.roundEndTimer) clearTimeout(timers.roundEndTimer)
    if (timers.gameEndTimer) clearTimeout(timers.gameEndTimer)
  })

  // clearTimers is imported from game-logic

  test('clearTimers clears all four timer types', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    timers.tickTimer = setInterval(() => {}, 100)
    timers.roundEndTimer = setTimeout(() => {}, 5000)
    timers.gameEndTimer = setTimeout(() => {}, 10000)

    clearTimers(timers as TimerContainer)

    expect(timers.roundTimer).toBeNull()
    expect(timers.tickTimer).toBeNull()
    expect(timers.roundEndTimer).toBeNull()
    expect(timers.gameEndTimer).toBeNull()
  })

  test('double clear does not cause errors', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)

    clearTimers(timers as TimerContainer)
    expect(() => clearTimers(timers as TimerContainer)).not.toThrow()
  })

  test('clearing null timers does not cause errors', () => {
    expect(() => clearTimers(timers as TimerContainer)).not.toThrow()
  })

  test('clearing only some timers works', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    timers.tickTimer = setInterval(() => {}, 100)
    // roundEndTimer and gameEndTimer remain null

    clearTimers(timers as TimerContainer)

    expect(timers.roundTimer).toBeNull()
    expect(timers.tickTimer).toBeNull()
    expect(timers.roundEndTimer).toBeNull()
    expect(timers.gameEndTimer).toBeNull()
  })

  test('timers can be recreated after clearing', () => {
    timers.roundTimer = setTimeout(() => {}, 1000)
    clearTimers(timers as TimerContainer)

    timers.roundTimer = setTimeout(() => {}, 1000)
    expect(timers.roundTimer).not.toBe(null)

    clearTimers(timers as TimerContainer)
  })
})
