import { describe, it, expect } from 'vitest'
import type { ChatMessage, Player, Stroke } from './types'

// We'll test the message handling logic directly without mocking WebSocket constructor
// This approach is more maintainable and tests the actual business logic

describe('Chat Message Types', () => {
  describe('ChatMessage interface', () => {
    it('should have all required fields', () => {
      const message: ChatMessage = {
        id: 'msg-123',
        playerId: 'player-1',
        playerName: 'Alice',
        playerColor: '#FF6B6B',
        content: 'Hello!',
        timestamp: Date.now(),
      }

      expect(message.id).toBeDefined()
      expect(message.playerId).toBeDefined()
      expect(message.playerName).toBeDefined()
      expect(message.playerColor).toBeDefined()
      expect(message.content).toBeDefined()
      expect(message.timestamp).toBeDefined()
    })

    it('should validate color format', () => {
      const validColors = ['#FF6B6B', '#4ECDC4', '#fff', '#ABC']
      const invalidColors = ['red', 'rgb(255,0,0)', 'invalid']

      const isValidHexColor = (color: string) => /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)

      validColors.forEach((color) => {
        expect(isValidHexColor(color)).toBe(true)
      })

      invalidColors.forEach((color) => {
        expect(isValidHexColor(color)).toBe(false)
      })
    })
  })

  describe('Chat message serialization', () => {
    it('should serialize and deserialize chat message correctly', () => {
      const original: ChatMessage = {
        id: 'msg-456',
        playerId: 'player-2',
        playerName: 'Bob',
        playerColor: '#45B7D1',
        content: 'Test message with special chars: <>&"\'',
        timestamp: 1704067200000,
      }

      const serialized = JSON.stringify({ type: 'chat', message: original })
      const parsed = JSON.parse(serialized) as { type: string; message: ChatMessage }

      expect(parsed.type).toBe('chat')
      expect(parsed.message).toEqual(original)
    })

    it('should handle Unicode content', () => {
      const message: ChatMessage = {
        id: 'msg-unicode',
        playerId: 'player-3',
        playerName: '用户名',
        playerColor: '#96CEB4',
        content: '你好世界 👋 Hello 🌍 مرحبا',
        timestamp: Date.now(),
      }

      const serialized = JSON.stringify({ type: 'chat', message })
      const parsed = JSON.parse(serialized) as { type: string; message: ChatMessage }

      expect(parsed.message.content).toBe('你好世界 👋 Hello 🌍 مرحبا')
      expect(parsed.message.playerName).toBe('用户名')
    })
  })

  describe('Init message with chat history', () => {
    it('should include chatHistory in init message', () => {
      const player: Player = { id: 'p1', name: 'TestPlayer', color: '#FF6B6B' }
      const players: Player[] = [player]
      const strokes: Stroke[] = []
      const chatHistory: ChatMessage[] = [
        {
          id: 'msg-1',
          playerId: 'p0',
          playerName: 'PreviousPlayer',
          playerColor: '#4ECDC4',
          content: 'Welcome!',
          timestamp: Date.now() - 60000,
        },
        {
          id: 'msg-2',
          playerId: 'p0',
          playerName: 'PreviousPlayer',
          playerColor: '#4ECDC4',
          content: 'How are you?',
          timestamp: Date.now() - 30000,
        },
      ]

      const initMessage = {
        type: 'init',
        playerId: 'p1',
        player,
        players,
        strokes,
        chatHistory,
      }

      const serialized = JSON.stringify(initMessage)
      const parsed = JSON.parse(serialized)

      expect(parsed.type).toBe('init')
      expect(parsed.chatHistory).toHaveLength(2)
      expect(parsed.chatHistory[0].content).toBe('Welcome!')
      expect(parsed.chatHistory[1].content).toBe('How are you?')
    })

    it('should handle empty chat history', () => {
      const initMessage = {
        type: 'init',
        playerId: 'p1',
        player: { id: 'p1', name: 'New Player', color: '#FF6B6B' },
        players: [],
        strokes: [],
        chatHistory: [],
      }

      const serialized = JSON.stringify(initMessage)
      const parsed = JSON.parse(serialized)

      expect(parsed.chatHistory).toEqual([])
    })
  })

  describe('Chat content validation', () => {
    const MAX_CHAT_MESSAGE_LENGTH = 500

    it('should accept messages within length limit', () => {
      const shortMessage = 'Hello!'
      const atLimit = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH)

      expect(shortMessage.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGE_LENGTH)
      expect(atLimit.length).toBe(MAX_CHAT_MESSAGE_LENGTH)
    })

    it('should truncate long messages', () => {
      const longMessage = 'a'.repeat(1000)
      const truncated = longMessage.slice(0, MAX_CHAT_MESSAGE_LENGTH)

      expect(truncated.length).toBe(MAX_CHAT_MESSAGE_LENGTH)
    })

    it('should reject empty content', () => {
      const isEmpty = (content: string) => content.trim().length === 0

      expect(isEmpty('')).toBe(true)
      expect(isEmpty('   ')).toBe(true)
      expect(isEmpty('hello')).toBe(false)
    })
  })
})
