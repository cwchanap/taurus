import { Stroke } from '@repo/types'

import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_COLOR_LENGTH,
  MAX_STROKE_SIZE,
  MIN_STROKE_SIZE,
  MAX_STROKE_POINTS,
  MAX_COORDINATE_VALUE,
} from './constants'

/**
 * Validates chat message content
 * Rejects empty strings and strings that contain only whitespace
 */
export function validateMessageContent(content: unknown): content is string {
  return typeof content === 'string' && content.trim().length > 0
}

/**
 * Sanitizes chat message content (trims whitespace and truncates if necessary)
 */
export function sanitizeMessage(content: string): string {
  return content.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH)
}

/**
 * Validates player name
 */
export function isValidPlayerName(name: unknown): name is string {
  if (typeof name !== 'string') {
    return false
  }
  // Prevent arbitrarily long whitespace-padded names
  if (name.length > MAX_PLAYER_NAME_LENGTH * 2) {
    return false
  }
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_PLAYER_NAME_LENGTH
}

interface Point {
  x: number
  y: number
}

/**
 * Validates a point object
 */
export function isValidPoint(point: unknown): point is Point {
  if (!point || typeof point !== 'object') {
    return false
  }

  const p = point as Record<string, unknown>
  return (
    typeof p.x === 'number' &&
    Number.isFinite(p.x) &&
    Math.abs(p.x) <= MAX_COORDINATE_VALUE &&
    typeof p.y === 'number' &&
    Number.isFinite(p.y) &&
    Math.abs(p.y) <= MAX_COORDINATE_VALUE
  )
}

/**
 * Validates a color string
 */
export function isValidColor(color: unknown): color is string {
  if (typeof color !== 'string') {
    return false
  }
  const trimmed = color.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_COLOR_LENGTH
}

/**
 * Validates a size value
 */
export function isValidSize(size: unknown): size is number {
  if (typeof size !== 'number') {
    return false
  }
  return Number.isFinite(size) && size >= MIN_STROKE_SIZE && size <= MAX_STROKE_SIZE
}

/**
 * Validates a stroke ID (should be a non-empty string, reasonable length)
 */
export function isValidStrokeId(strokeId: unknown): strokeId is string {
  if (typeof strokeId !== 'string') {
    return false
  }
  const trimmed = strokeId.trim()
  return trimmed.length > 0 && trimmed.length <= 100
}

/**
 * Validates and sanitizes stroke data from client
 * Returns validated Stroke object or null if invalid
 *
 * @param strokeData Raw data from client
 * @param playerId ID of the player sending the stroke
 * @param existingStrokeIds Optional set of existing stroke IDs to check for collisions
 */
export function validateStroke(
  strokeData: unknown,
  playerId: string,
  existingStrokeIds?: Set<string>
): Stroke | null {
  if (!strokeData || typeof strokeData !== 'object') {
    console.warn('Invalid stroke data: not an object')
    return null
  }

  const data = strokeData as Record<string, unknown>

  // Validate points array
  const points = data.points
  if (!Array.isArray(points)) {
    console.warn('Invalid stroke data: points is not an array')
    return null
  }

  if (points.length === 0 || points.length > MAX_STROKE_POINTS) {
    console.warn(`Invalid stroke data: points array length ${points.length} exceeds limits`)
    return null
  }

  // Validate each point
  for (let i = 0; i < points.length; i++) {
    if (!isValidPoint(points[i])) {
      console.warn(`Invalid stroke data: point at index ${i} is invalid`)
      return null
    }
  }

  // Validate color
  if (!isValidColor(data.color)) {
    console.warn('Invalid stroke data: color is invalid')
    return null
  }

  // Validate size
  if (!isValidSize(data.size)) {
    console.warn('Invalid stroke data: size is invalid')
    return null
  }

  // Return validated stroke with ID (reject client-provided ID if it collides with existing)
  const trimmedClientId = typeof data.id === 'string' ? data.id.trim() : data.id

  // Use client ID if valid and not colliding, otherwise reject
  let strokeId: string
  if (typeof trimmedClientId === 'string' && isValidStrokeId(trimmedClientId)) {
    if (existingStrokeIds?.has(trimmedClientId)) {
      // Reject collision - client ID already exists
      console.warn('Invalid stroke data: client-provided ID collides with existing stroke')
      return null
    }
    strokeId = trimmedClientId
  } else {
    // Use standard Web Crypto API (available in Workers and modern Node/browsers)
    strokeId = crypto.randomUUID()
  }

  // Ensure uniqueness: keep regenerating if we collide with existing IDs
  if (existingStrokeIds) {
    while (existingStrokeIds.has(strokeId)) {
      strokeId = crypto.randomUUID()
    }
  }

  return {
    id: strokeId,
    playerId,
    points: points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
    color: (data.color as string).trim(),
    size: data.size as number,
  }
}
