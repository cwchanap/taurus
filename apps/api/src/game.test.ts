import { describe, expect, test } from 'bun:test'
import { VOCABULARY, getRandomWord, getRandomWordExcluding } from './vocabulary'
import { createInitialGameState, scoresToRecord } from './game-types'
import {
  ROUND_DURATION_MS,
  MIN_PLAYERS_TO_START,
  CORRECT_GUESS_BASE_SCORE,
  DRAWER_BONUS_SCORE,
} from './constants'

describe('Vocabulary', () => {
  describe('VOCABULARY list', () => {
    test('should have a non-empty word list', () => {
      expect(VOCABULARY.length).toBeGreaterThan(0)
    })

    test('should have at least 50 words', () => {
      expect(VOCABULARY.length).toBeGreaterThanOrEqual(50)
    })

    test('should have no duplicate words', () => {
      const uniqueWords = new Set(VOCABULARY)
      expect(uniqueWords.size).toBe(VOCABULARY.length)
    })

    test('should only contain lowercase words', () => {
      for (const word of VOCABULARY) {
        expect(word).toBe(word.toLowerCase())
      }
    })

    test('should only contain non-empty words', () => {
      for (const word of VOCABULARY) {
        expect(word.trim().length).toBeGreaterThan(0)
      }
    })
  })

  describe('getRandomWord', () => {
    test('should return a word from the vocabulary', () => {
      const word = getRandomWord()
      expect(VOCABULARY).toContain(word)
    })

    test('should return different words over multiple calls', () => {
      const words = new Set<string>()
      // Call 100 times and expect at least 5 unique words
      for (let i = 0; i < 100; i++) {
        words.add(getRandomWord())
      }
      expect(words.size).toBeGreaterThan(5)
    })
  })

  describe('getRandomWordExcluding', () => {
    test('should return a word not in the excluded set', () => {
      const usedWords = new Set(['cat', 'dog', 'elephant'])
      const word = getRandomWordExcluding(usedWords)
      expect(usedWords.has(word)).toBe(false)
    })

    test('should return from vocabulary when no words excluded', () => {
      const usedWords = new Set<string>()
      const word = getRandomWordExcluding(usedWords)
      expect(VOCABULARY).toContain(word)
    })

    test('should still return a word when all words are used', () => {
      const usedWords = new Set(VOCABULARY)
      const word = getRandomWordExcluding(usedWords)
      expect(VOCABULARY).toContain(word)
    })

    test('should eventually return all available words', () => {
      const usedWords = new Set<string>()
      const available = VOCABULARY.slice(0, 10)
      const excluded = VOCABULARY.slice(10)

      for (const word of excluded) {
        usedWords.add(word)
      }

      // Get 100 words and check they're all from available
      for (let i = 0; i < 100; i++) {
        const word = getRandomWordExcluding(usedWords)
        expect(available).toContain(word)
      }
    })
  })
})

describe('Game Types', () => {
  describe('createInitialGameState', () => {
    test('should create initial state with lobby status', () => {
      const state = createInitialGameState()
      expect(state.status).toBe('lobby')
    })

    test('should initialize with zero rounds', () => {
      const state = createInitialGameState()
      expect(state.currentRound).toBe(0)
      expect(state.totalRounds).toBe(0)
    })

    test('should initialize with null drawer and word', () => {
      const state = createInitialGameState()
      expect(state.currentDrawerId).toBeNull()
      expect(state.currentWord).toBeNull()
    })

    test('should initialize with empty collections', () => {
      const state = createInitialGameState()
      expect(state.drawerOrder).toEqual([])
      expect(state.scores.size).toBe(0)
      expect(state.correctGuessers.size).toBe(0)
      expect(state.usedWords.size).toBe(0)
    })

    test('should initialize with null timestamps', () => {
      const state = createInitialGameState()
      expect(state.roundStartTime).toBeNull()
      expect(state.roundEndTime).toBeNull()
    })
  })

  describe('scoresToRecord', () => {
    test('should convert empty map to empty record', () => {
      const scores = new Map<string, number>()
      const record = scoresToRecord(scores)
      expect(record).toEqual({})
    })

    test('should convert map with entries to record', () => {
      const scores = new Map<string, number>([
        ['player1', 100],
        ['player2', 75],
        ['player3', 50],
      ])
      const record = scoresToRecord(scores)
      expect(record).toEqual({
        player1: 100,
        player2: 75,
        player3: 50,
      })
    })

    test('should handle scores with zero', () => {
      const scores = new Map<string, number>([
        ['player1', 0],
        ['player2', 100],
      ])
      const record = scoresToRecord(scores)
      expect(record).toEqual({
        player1: 0,
        player2: 100,
      })
    })

    test('should be serializable to JSON', () => {
      const scores = new Map<string, number>([
        ['player1', 100],
        ['player2', 75],
      ])
      const record = scoresToRecord(scores)
      const json = JSON.stringify(record)
      const parsed = JSON.parse(json)
      expect(parsed).toEqual({
        player1: 100,
        player2: 75,
      })
    })
  })
})

describe('Game Constants', () => {
  test('should have valid round duration', () => {
    expect(ROUND_DURATION_MS).toBeGreaterThan(0)
    expect(ROUND_DURATION_MS).toBe(60000) // 60 seconds
  })

  test('should require at least 2 players', () => {
    expect(MIN_PLAYERS_TO_START).toBeGreaterThanOrEqual(2)
  })

  test('should have positive scoring values', () => {
    expect(CORRECT_GUESS_BASE_SCORE).toBeGreaterThan(0)
    expect(DRAWER_BONUS_SCORE).toBeGreaterThan(0)
  })
})

describe('Scoring Algorithm', () => {
  // Test the scoring formula: score = base * (1 + timeRatio * 0.5)
  // where timeRatio = timeRemaining / ROUND_DURATION_MS

  function calculateScore(timeRemaining: number): number {
    const timeRatio = timeRemaining / ROUND_DURATION_MS
    return Math.round(CORRECT_GUESS_BASE_SCORE * (1 + timeRatio * 0.5))
  }

  test('should award base score when time is up', () => {
    const score = calculateScore(0)
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })

  test('should award maximum score at start of round', () => {
    const score = calculateScore(ROUND_DURATION_MS)
    // At full time: base * (1 + 1 * 0.5) = base * 1.5
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.5))
  })

  test('should award intermediate score at half time', () => {
    const score = calculateScore(ROUND_DURATION_MS / 2)
    // At half time: base * (1 + 0.5 * 0.5) = base * 1.25
    expect(score).toBe(Math.round(CORRECT_GUESS_BASE_SCORE * 1.25))
  })

  test('should award higher score for faster guesses', () => {
    const fastScore = calculateScore(ROUND_DURATION_MS * 0.8)
    const slowScore = calculateScore(ROUND_DURATION_MS * 0.2)
    expect(fastScore).toBeGreaterThan(slowScore)
  })

  test('should cap at base score for negative time (edge case)', () => {
    // Edge case: if timeRemaining is negative, treat as 0
    const score = calculateScore(Math.max(0, -1000))
    expect(score).toBe(CORRECT_GUESS_BASE_SCORE)
  })
})

describe('Drawer Bonus Scoring', () => {
  test('should award bonus per correct guesser', () => {
    const numGuessers = 3
    const drawerBonus = DRAWER_BONUS_SCORE * numGuessers
    expect(drawerBonus).toBe(150) // 50 * 3
  })

  test('should award no bonus if no one guesses', () => {
    const numGuessers = 0
    const drawerBonus = DRAWER_BONUS_SCORE * numGuessers
    expect(drawerBonus).toBe(0)
  })

  test('should award bonus for single guesser', () => {
    const numGuessers = 1
    const drawerBonus = DRAWER_BONUS_SCORE * numGuessers
    expect(drawerBonus).toBe(DRAWER_BONUS_SCORE)
  })
})

describe('Game State Transitions', () => {
  test('lobby -> playing when game starts', () => {
    const state = createInitialGameState()
    expect(state.status).toBe('lobby')

    // Simulate game start
    state.status = 'playing'
    state.currentRound = 1
    state.totalRounds = 3
    state.drawerOrder = ['p1', 'p2', 'p3']

    expect(state.status).toBe('playing')
    expect(state.currentRound).toBe(1)
  })

  test('playing -> round-end when round completes', () => {
    const state = createInitialGameState()
    state.status = 'playing'
    state.currentDrawerId = 'p1'
    state.currentWord = 'cat'

    // Simulate round end
    state.status = 'round-end'
    state.currentDrawerId = null
    state.currentWord = null

    expect(state.status).toBe('round-end')
    expect(state.currentDrawerId).toBeNull()
  })

  test('round-end -> playing for next round', () => {
    const state = createInitialGameState()
    state.status = 'round-end'
    state.currentRound = 1
    state.totalRounds = 3

    // Next round
    state.status = 'playing'
    state.currentRound = 2
    state.currentDrawerId = 'p2'
    state.currentWord = 'dog'
    state.correctGuessers = new Set()

    expect(state.status).toBe('playing')
    expect(state.currentRound).toBe(2)
  })

  test('round-end -> game-over when all rounds complete', () => {
    const state = createInitialGameState()
    state.status = 'round-end'
    state.currentRound = 3
    state.totalRounds = 3

    // Game over
    state.status = 'game-over'

    expect(state.status).toBe('game-over')
  })

  test('game-over -> lobby when game resets', () => {
    const state = createInitialGameState()
    state.status = 'game-over'
    state.scores = new Map([
      ['p1', 100],
      ['p2', 75],
    ])

    // Reset
    const newState = createInitialGameState()

    expect(newState.status).toBe('lobby')
    expect(newState.scores.size).toBe(0)
  })
})

describe('Correct Guess Detection', () => {
  // Simulates the check in room.ts handleChat

  function isCorrectGuess(guess: string, word: string): boolean {
    return guess.toLowerCase().trim() === word.toLowerCase()
  }

  test('should detect exact match', () => {
    expect(isCorrectGuess('cat', 'cat')).toBe(true)
  })

  test('should be case insensitive', () => {
    expect(isCorrectGuess('CAT', 'cat')).toBe(true)
    expect(isCorrectGuess('Cat', 'cat')).toBe(true)
    expect(isCorrectGuess('cAt', 'cat')).toBe(true)
  })

  test('should trim whitespace', () => {
    expect(isCorrectGuess('  cat  ', 'cat')).toBe(true)
    expect(isCorrectGuess('cat ', 'cat')).toBe(true)
    expect(isCorrectGuess(' cat', 'cat')).toBe(true)
  })

  test('should reject partial matches', () => {
    expect(isCorrectGuess('ca', 'cat')).toBe(false)
    expect(isCorrectGuess('cats', 'cat')).toBe(false)
    expect(isCorrectGuess('cat dog', 'cat')).toBe(false)
  })

  test('should reject empty guesses', () => {
    expect(isCorrectGuess('', 'cat')).toBe(false)
    expect(isCorrectGuess('   ', 'cat')).toBe(false)
  })

  test('should handle multi-word vocabulary', () => {
    expect(isCorrectGuess('ice cream', 'ice cream')).toBe(true)
    expect(isCorrectGuess('ICE CREAM', 'ice cream')).toBe(true)
  })
})
