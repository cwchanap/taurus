import { describe, expect, test } from 'bun:test'
import {
  validateStroke,
  validateFill,
  isValidStrokeId,
  isValidColor,
  isValidSize,
  isValidPlayerName,
} from './validation'
import {
  MAX_STROKE_SIZE,
  MIN_STROKE_SIZE,
  MAX_COLOR_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  PALETTE_COLORS,
} from './constants'

const VALID_FILL_COLOR = PALETTE_COLORS[0]

describe('validateFill', () => {
  test('accepts integer coordinates and valid palette color', () => {
    const result = validateFill({ x: 100, y: 200, color: VALID_FILL_COLOR })
    expect(result).not.toBeNull()
    expect(result?.x).toBe(100)
    expect(result?.y).toBe(200)
    expect(result?.color).toBe(VALID_FILL_COLOR)
  })

  test('accepts and floors fractional coordinates', () => {
    const result = validateFill({ x: 100.7, y: 200.3, color: VALID_FILL_COLOR })
    expect(result).not.toBeNull()
    expect(result?.x).toBe(100)
    expect(result?.y).toBe(200)
  })

  test('accepts fractional coordinates at boundary (just below max)', () => {
    const result = validateFill({
      x: MAX_CANVAS_WIDTH - 0.5,
      y: MAX_CANVAS_HEIGHT - 0.5,
      color: VALID_FILL_COLOR,
    })
    expect(result).not.toBeNull()
    expect(result?.x).toBe(MAX_CANVAS_WIDTH - 1)
    expect(result?.y).toBe(MAX_CANVAS_HEIGHT - 1)
  })

  test('rejects x >= MAX_CANVAS_WIDTH', () => {
    expect(validateFill({ x: MAX_CANVAS_WIDTH, y: 0, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects y >= MAX_CANVAS_HEIGHT', () => {
    expect(validateFill({ x: 0, y: MAX_CANVAS_HEIGHT, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects negative x', () => {
    expect(validateFill({ x: -1, y: 0, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects negative y', () => {
    expect(validateFill({ x: 0, y: -0.5, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects non-finite x (NaN, Infinity)', () => {
    expect(validateFill({ x: NaN, y: 0, color: VALID_FILL_COLOR })).toBeNull()
    expect(validateFill({ x: Infinity, y: 0, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects non-finite y', () => {
    expect(validateFill({ x: 0, y: NaN, color: VALID_FILL_COLOR })).toBeNull()
    expect(validateFill({ x: 0, y: -Infinity, color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects non-number coordinates', () => {
    expect(validateFill({ x: '10', y: 0, color: VALID_FILL_COLOR })).toBeNull()
    expect(validateFill({ x: 0, y: '10', color: VALID_FILL_COLOR })).toBeNull()
  })

  test('rejects color not in palette', () => {
    expect(validateFill({ x: 0, y: 0, color: '#000000' })).toBeNull()
    expect(validateFill({ x: 0, y: 0, color: 'red' })).toBeNull()
  })

  test('rejects null or non-object input', () => {
    expect(validateFill(null)).toBeNull()
    expect(validateFill('string')).toBeNull()
    expect(validateFill(42)).toBeNull()
  })
})

describe('isValidStrokeId', () => {
  test('should reject whitespace-only strings', () => {
    expect(isValidStrokeId('   ')).toBe(false)
    expect(isValidStrokeId('\t\n')).toBe(false)
    expect(isValidStrokeId('  \n  ')).toBe(false)
  })

  test('should accept valid IDs after trimming', () => {
    expect(isValidStrokeId('  valid-id  ')).toBe(true)
    expect(isValidStrokeId('\ttrimmed\n')).toBe(true)
  })
})

describe('validateStroke', () => {
  const validStrokeData = {
    id: 'stroke-1',
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ],
    color: '#000000',
    size: 5,
  }
  const playerId = 'player-1'

  test('should allow valid stroke with unique ID', () => {
    const result = validateStroke(validStrokeData, playerId)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('stroke-1')
    expect(result?.playerId).toBe(playerId)
  })

  test('should reject stroke if client ID collides with existing ID', () => {
    const existingIds = new Set(['stroke-1'])

    // Input has ID 'stroke-1' which is in existingIds - should be rejected
    const result = validateStroke(validStrokeData, playerId, existingIds)

    expect(result).toBeNull()
  })

  test('should allow same ID if not in existing IDs', () => {
    const existingIds = new Set(['other-stroke'])

    const result = validateStroke(validStrokeData, playerId, existingIds)

    expect(result).not.toBeNull()
    expect(result?.id).toBe('stroke-1')
  })

  test('should generate ID if none provided', () => {
    const noIdData = {
      points: validStrokeData.points,
      color: validStrokeData.color,
      size: validStrokeData.size,
    }

    const result = validateStroke(noIdData, playerId)

    expect(result).not.toBeNull()
    expect(result?.id).toBeDefined()
    expect(result?.id?.length).toBeGreaterThan(0)
  })

  test('should handle collision for generated IDs', () => {
    // Spy on crypto.randomUUID to return a collision first, then a unique ID
    const originalRandomUUID = crypto.randomUUID
    let callCount = 0

    crypto.randomUUID = () => {
      callCount++
      if (callCount === 1) return 'stroke-1' // Collision
      return 'unique-id' // Success
    }

    try {
      const existingIds = new Set(['stroke-1'])
      // Input has no ID, so it will generate one
      const noIdData = {
        points: validStrokeData.points,
        color: validStrokeData.color,
        size: validStrokeData.size,
      }

      const result = validateStroke(noIdData, playerId, existingIds)

      expect(callCount).toBe(2) // Should have called twice (collision, then retry)
      expect(result).not.toBeNull()
      expect(result?.id).toBe('unique-id')
    } finally {
      crypto.randomUUID = originalRandomUUID
    }
  })

  test('should reject null input', () => {
    expect(validateStroke(null, 'player-1')).toBeNull()
  })

  test('should reject non-object input', () => {
    expect(validateStroke('not-an-object', 'player-1')).toBeNull()
    expect(validateStroke(42, 'player-1')).toBeNull()
  })

  test('should reject stroke with empty points', () => {
    const data = { points: [], color: '#000000', size: 5 }
    expect(validateStroke(data, 'player-1')).toBeNull()
  })

  test('should reject stroke with invalid color', () => {
    const data = { points: [{ x: 0, y: 0 }], color: '', size: 5 }
    expect(validateStroke(data, 'player-1')).toBeNull()
  })

  test('should reject stroke with invalid size', () => {
    const data = { points: [{ x: 0, y: 0 }], color: '#000', size: -1 }
    expect(validateStroke(data, 'player-1')).toBeNull()
  })
})

describe('isValidColor', () => {
  test('accepts valid color strings', () => {
    expect(isValidColor('#000000')).toBe(true)
    expect(isValidColor('red')).toBe(true)
    expect(isValidColor('rgb(0,0,0)')).toBe(true)
  })

  test('rejects non-string values', () => {
    expect(isValidColor(null)).toBe(false)
    expect(isValidColor(undefined)).toBe(false)
    expect(isValidColor(42)).toBe(false)
  })

  test('rejects empty or whitespace-only strings', () => {
    expect(isValidColor('')).toBe(false)
    expect(isValidColor('   ')).toBe(false)
  })

  test('rejects strings exceeding max length', () => {
    expect(isValidColor('a'.repeat(MAX_COLOR_LENGTH + 1))).toBe(false)
  })

  test('accepts string at max length', () => {
    expect(isValidColor('a'.repeat(MAX_COLOR_LENGTH))).toBe(true)
  })
})

describe('isValidSize', () => {
  test('accepts valid sizes', () => {
    expect(isValidSize(5)).toBe(true)
    expect(isValidSize(MIN_STROKE_SIZE)).toBe(true)
    expect(isValidSize(MAX_STROKE_SIZE)).toBe(true)
  })

  test('rejects non-number values', () => {
    expect(isValidSize(null)).toBe(false)
    expect(isValidSize('5')).toBe(false)
    expect(isValidSize(undefined)).toBe(false)
  })

  test('rejects out-of-range sizes', () => {
    expect(isValidSize(0)).toBe(false)
    expect(isValidSize(MIN_STROKE_SIZE - 0.01)).toBe(false)
    expect(isValidSize(MAX_STROKE_SIZE + 1)).toBe(false)
  })

  test('rejects non-finite numbers', () => {
    expect(isValidSize(NaN)).toBe(false)
    expect(isValidSize(Infinity)).toBe(false)
    expect(isValidSize(-Infinity)).toBe(false)
  })
})

describe('isValidPlayerName', () => {
  test('should accept valid names', () => {
    expect(isValidPlayerName('Player1')).toBe(true)
    expect(isValidPlayerName('  trimmed  ')).toBe(true) // whitespace ok, trimmed is valid
  })

  test('should reject non-string values', () => {
    expect(isValidPlayerName(null)).toBe(false)
    expect(isValidPlayerName(undefined)).toBe(false)
    expect(isValidPlayerName(42)).toBe(false)
  })

  test('should reject empty or whitespace-only strings', () => {
    expect(isValidPlayerName('')).toBe(false)
    expect(isValidPlayerName('   ')).toBe(false)
    expect(isValidPlayerName('\t\n')).toBe(false)
  })

  test('should reject names exceeding trimmed max length', () => {
    expect(isValidPlayerName('a'.repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBe(false)
  })

  test('should accept name at max length', () => {
    expect(isValidPlayerName('a'.repeat(MAX_PLAYER_NAME_LENGTH))).toBe(true)
  })

  test('should reject names exceeding overflow limit (MAX * 2)', () => {
    // 101 chars > 100 (MAX_PLAYER_NAME_LENGTH * 2)
    expect(isValidPlayerName('a'.repeat(MAX_PLAYER_NAME_LENGTH * 2 + 1))).toBe(false)
  })

  test('should accept names at overflow limit boundary with valid trimmed length', () => {
    // 100 chars passes overflow check, but still needs trimmed.length <= 50
    // This name has 50 real chars + 50 spaces = 100 total
    const name = 'a'.repeat(MAX_PLAYER_NAME_LENGTH) + ' '.repeat(MAX_PLAYER_NAME_LENGTH)
    expect(isValidPlayerName(name)).toBe(true)
  })

  test('should reject whitespace-padded names where trimmed exceeds max', () => {
    // 51 real chars + 49 spaces = 100 total (passes overflow check)
    // But trimmed.length = 51 > 50, so rejected
    const name = 'a'.repeat(MAX_PLAYER_NAME_LENGTH + 1) + ' '.repeat(MAX_PLAYER_NAME_LENGTH - 1)
    expect(isValidPlayerName(name)).toBe(false)
  })
})
