import { describe, expect, test } from 'bun:test'
import { validateStroke } from './validation'

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

  test('should generate new ID if client ID is collision', () => {
    const existingIds = new Set(['stroke-1'])

    // Input has ID 'stroke-1' which is in existingIds
    const result = validateStroke(validStrokeData, playerId, existingIds)

    expect(result).not.toBeNull()
    expect(result?.id).not.toBe('stroke-1')
    expect(result?.id?.length).toBeGreaterThan(0) // UUID
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
})
