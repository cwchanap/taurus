import { MAX_CHAT_MESSAGE_LENGTH, MAX_PLAYER_NAME_LENGTH } from './constants'

/**
 * Validates chat message content
 */
export function validateMessageContent(content: unknown): content is string {
  return typeof content === 'string' && content.length > 0
}

/**
 * Sanitizes chat message content (truncates if necessary)
 */
export function sanitizeMessage(content: string): string {
  return content.slice(0, MAX_CHAT_MESSAGE_LENGTH)
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
