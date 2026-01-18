import { describe, expect, test } from 'bun:test'
import { MAX_CHAT_MESSAGE_LENGTH, MAX_PLAYER_NAME_LENGTH, MAX_CHAT_HISTORY } from './constants'
import { validateMessageContent, sanitizeMessage, isValidPlayerName } from './validation'
import { ChatHistory } from './chat-history'

// Test ChatMessage validation constants and logic (extracted from room.ts)

describe('Chat Message Validation', () => {
  describe('Message content validation', () => {
    test('should accept valid message content', () => {
      const content = 'Hello, this is a test message!'
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(true)
    })

    test('should reject empty message content', () => {
      const content = ''
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(false)
    })

    test('should reject whitespace-only message content', () => {
      const content = '   '
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(false)
    })

    test('should reject tabs and newlines-only message content', () => {
      const content = '\t\n\r'
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(false)
    })

    test('should accept message with leading/trailing whitespace', () => {
      const content = '  Hello world  '
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(true)
    })

    test('should reject non-string message content', () => {
      const content = 123
      const isValid = validateMessageContent(content)
      expect(isValid).toBe(false)
    })

    test('should truncate overly long messages', () => {
      const longContent = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 100)
      const sanitizedContent = sanitizeMessage(longContent)
      expect(sanitizedContent.length).toBe(MAX_CHAT_MESSAGE_LENGTH)
      expect(sanitizedContent).toBe('a'.repeat(MAX_CHAT_MESSAGE_LENGTH))
    })

    test('should preserve messages under max length', () => {
      const content = 'Short message'
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent).toBe(content)
    })

    test('should trim leading whitespace from messages', () => {
      const content = '   Hello world'
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent).toBe('Hello world')
    })

    test('should trim trailing whitespace from messages', () => {
      const content = 'Hello world   '
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent).toBe('Hello world')
    })

    test('should trim both leading and trailing whitespace from messages', () => {
      const content = '   Hello world   '
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent).toBe('Hello world')
    })

    test('should handle mixed whitespace characters', () => {
      const content = '\t\n  Hello world  \r\n'
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent).toBe('Hello world')
    })

    test('should trim before truncating long messages', () => {
      const content = '   '.repeat(100) + 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH)
      const sanitizedContent = sanitizeMessage(content)
      expect(sanitizedContent.length).toBe(MAX_CHAT_MESSAGE_LENGTH)
      expect(sanitizedContent).toBe('a'.repeat(MAX_CHAT_MESSAGE_LENGTH))
    })
  })

  describe('ChatMessage structure', () => {
    test('should create valid chat message object', () => {
      const now = Date.now()
      const chatMessage = {
        id: crypto.randomUUID(),
        playerId: 'player-123',
        playerName: 'TestUser',
        playerColor: '#FF6B6B',
        content: sanitizeMessage('Hello world!'),
        timestamp: now,
      }

      expect(chatMessage.id).toBeDefined()
      expect(chatMessage.id.length).toBeGreaterThan(0)
      expect(chatMessage.playerId).toBe('player-123')
      expect(chatMessage.playerName).toBe('TestUser')
      expect(chatMessage.playerColor).toBe('#FF6B6B')
      expect(chatMessage.content).toBe('Hello world!')
      expect(chatMessage.timestamp).toBe(now)
    })

    test('should validate player name length', () => {
      const validName = 'ValidUsername'
      const isValid = isValidPlayerName(validName)

      expect(isValid).toBe(true)
    })

    test('should reject overly long player names', () => {
      const longName = 'a'.repeat(MAX_PLAYER_NAME_LENGTH + 1)
      const isValid = isValidPlayerName(longName)

      expect(isValid).toBe(false)
    })
  })

  describe('Chat history management', () => {
    test('should maintain chat history under limit', () => {
      const history = new ChatHistory()

      for (let i = 0; i < 30; i++) {
        history.addMessage({
          id: `msg-${i}`,
          playerId: 'p1',
          playerName: 'User',
          playerColor: '#000',
          content: `Message ${i}`,
          timestamp: Date.now(),
        })
      }

      expect(history.getMessages().length).toBeLessThanOrEqual(MAX_CHAT_HISTORY)
    })

    test('should remove oldest messages when limit exceeded', () => {
      const history = new ChatHistory()
      const totalAdded = MAX_CHAT_HISTORY + 10

      // Add more than MAX_CHAT_HISTORY messages
      for (let i = 0; i < totalAdded; i++) {
        history.addMessage({
          id: `msg-${i}`,
          playerId: 'p1',
          playerName: 'User',
          playerColor: '#000',
          content: `Message ${i}`,
          timestamp: Date.now(),
        })
      }

      const messages = history.getMessages()
      const firstExpectedIndex = totalAdded - MAX_CHAT_HISTORY

      expect(messages.length).toBe(MAX_CHAT_HISTORY)
      expect(messages[0].id).toBe(`msg-${firstExpectedIndex}`)
      expect(messages[messages.length - 1].id).toBe(`msg-${totalAdded - 1}`)
    })
  })

  describe('Message broadcast format', () => {
    test('should create correct broadcast message format', () => {
      const chatMessage = {
        id: 'msg-abc',
        playerId: 'player-1',
        playerName: 'Alice',
        playerColor: '#4ECDC4',
        content: 'Test message',
        timestamp: 1704067200000,
      }

      const broadcastMessage = {
        type: 'chat',
        message: chatMessage,
      }

      expect(broadcastMessage.type).toBe('chat')
      expect(broadcastMessage.message).toEqual(chatMessage)

      const serialized = JSON.stringify(broadcastMessage)
      const parsed = JSON.parse(serialized)

      expect(parsed.type).toBe('chat')
      expect(parsed.message.content).toBe('Test message')
    })
  })
})
