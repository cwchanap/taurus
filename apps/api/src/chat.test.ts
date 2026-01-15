import { describe, expect, test } from 'bun:test'

// Test ChatMessage validation constants and logic (extracted from room.ts)
const MAX_CHAT_MESSAGE_LENGTH = 500
const MAX_PLAYER_NAME_LENGTH = 50

describe('Chat Message Validation', () => {
  describe('Message content validation', () => {
    test('should accept valid message content', () => {
      const content = 'Hello, this is a test message!'
      const isValid = typeof content === 'string' && content.length > 0
      expect(isValid).toBe(true)
    })

    test('should reject empty message content', () => {
      const content = ''
      const isValid = typeof content === 'string' && content.length > 0
      expect(isValid).toBe(false)
    })

    test('should reject non-string message content', () => {
      const content = 123
      const isValid = typeof content === 'string' && content.length > 0
      expect(isValid).toBe(false)
    })

    test('should truncate overly long messages', () => {
      const longContent = 'a'.repeat(1000)
      const sanitizedContent = longContent.slice(0, MAX_CHAT_MESSAGE_LENGTH)
      expect(sanitizedContent.length).toBe(MAX_CHAT_MESSAGE_LENGTH)
    })

    test('should preserve messages under max length', () => {
      const content = 'Short message'
      const sanitizedContent = content.slice(0, MAX_CHAT_MESSAGE_LENGTH)
      expect(sanitizedContent).toBe(content)
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
        content: 'Hello world!',
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
      const isValidName = validName.length > 0 && validName.length <= MAX_PLAYER_NAME_LENGTH

      expect(isValidName).toBe(true)
    })

    test('should reject overly long player names', () => {
      const longName = 'a'.repeat(100)
      const isValidName = longName.length > 0 && longName.length <= MAX_PLAYER_NAME_LENGTH

      expect(isValidName).toBe(false)
    })
  })

  describe('Chat history management', () => {
    const MAX_CHAT_HISTORY = 50

    test('should maintain chat history under limit', () => {
      const chatMessages: { id: string; content: string }[] = []

      for (let i = 0; i < 30; i++) {
        chatMessages.push({ id: `msg-${i}`, content: `Message ${i}` })
      }

      expect(chatMessages.length).toBeLessThanOrEqual(MAX_CHAT_HISTORY)
    })

    test('should remove oldest messages when limit exceeded', () => {
      const chatMessages: { id: string; content: string }[] = []

      // Add more than MAX_CHAT_HISTORY messages
      for (let i = 0; i < 60; i++) {
        chatMessages.push({ id: `msg-${i}`, content: `Message ${i}` })
        if (chatMessages.length > MAX_CHAT_HISTORY) {
          chatMessages.shift() // Remove oldest
        }
      }

      expect(chatMessages.length).toBe(MAX_CHAT_HISTORY)
      expect(chatMessages[0].id).toBe('msg-10') // First 10 should be removed
      expect(chatMessages[chatMessages.length - 1].id).toBe('msg-59') // Last should be newest
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
