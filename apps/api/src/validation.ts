import { MAX_CHAT_MESSAGE_LENGTH, MAX_PLAYER_NAME_LENGTH } from './constants'

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
  return name.length > 0 && name.length <= MAX_PLAYER_NAME_LENGTH
}
