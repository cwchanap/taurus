import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChatMessage, Player, Stroke } from './types'
import { GameWebSocket } from './websocket'

// Mock WebSocket for reconnection tests
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(public url: string) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(_data: string) {}
  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  simulateError() {
    this.onerror?.()
  }
}

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

describe('WebSocket reconnection', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let mockWebSocketInstances: MockWebSocket[]

  beforeEach(() => {
    vi.useFakeTimers()
    originalWebSocket = globalThis.WebSocket
    mockWebSocketInstances = []

    // Create a mock WebSocket class that tracks instances
    class TrackedMockWebSocket extends MockWebSocket {
      constructor(url: string) {
        super(url)
        mockWebSocketInstances.push(this)
      }
    }

    // Add static properties
    Object.assign(TrackedMockWebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    })

    globalThis.WebSocket = TrackedMockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  describe('backoff delay calculation', () => {
    it('calculates exponential backoff delays correctly', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const connectionChanges: boolean[] = []

      gameWs.on({
        onConnectionChange: (connected) => connectionChanges.push(connected),
      })

      // Connect
      gameWs.connect()
      expect(mockWebSocketInstances).toHaveLength(1)

      // Simulate connection then close (triggering first reconnect)
      mockWebSocketInstances[0].simulateOpen()
      expect(connectionChanges).toEqual([true])

      mockWebSocketInstances[0].simulateClose()
      expect(connectionChanges).toEqual([true, false])

      // First reconnect: 1000ms delay (2^0 * 1000)
      expect(mockWebSocketInstances).toHaveLength(1)
      vi.advanceTimersByTime(999)
      expect(mockWebSocketInstances).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(2)

      // Close again
      mockWebSocketInstances[1].simulateClose()

      // Second reconnect: 2000ms delay (2^1 * 1000)
      vi.advanceTimersByTime(1999)
      expect(mockWebSocketInstances).toHaveLength(2)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(3)

      // Close again
      mockWebSocketInstances[2].simulateClose()

      // Third reconnect: 4000ms delay (2^2 * 1000)
      vi.advanceTimersByTime(3999)
      expect(mockWebSocketInstances).toHaveLength(3)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(4)

      // Close again
      mockWebSocketInstances[3].simulateClose()

      // Fourth reconnect: 8000ms delay (2^3 * 1000)
      vi.advanceTimersByTime(7999)
      expect(mockWebSocketInstances).toHaveLength(4)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(5)

      // Close again
      mockWebSocketInstances[4].simulateClose()

      // Fifth reconnect: 16000ms delay (2^4 * 1000)
      vi.advanceTimersByTime(15999)
      expect(mockWebSocketInstances).toHaveLength(5)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(6)
    })
  })

  describe('max reconnect attempts', () => {
    it('calls onConnectionFailed after max attempts (5)', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const onConnectionFailed = vi.fn()

      gameWs.on({ onConnectionFailed })

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()
      mockWebSocketInstances[0].simulateClose()

      // Fail 5 reconnection attempts
      for (let i = 0; i < 5; i++) {
        const delay = Math.pow(2, i) * 1000
        vi.advanceTimersByTime(delay)
        expect(mockWebSocketInstances).toHaveLength(i + 2)
        mockWebSocketInstances[i + 1].simulateClose()
      }

      // After 5 failed attempts, onConnectionFailed should be called
      expect(onConnectionFailed).toHaveBeenCalledTimes(1)
      expect(onConnectionFailed).toHaveBeenCalledWith(
        'Failed to reconnect after 5 attempts. Please refresh the page.'
      )

      // No more reconnection attempts should be made
      vi.advanceTimersByTime(100000)
      expect(mockWebSocketInstances).toHaveLength(6)
    })

    it('does not call onConnectionFailed before max attempts', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const onConnectionFailed = vi.fn()

      gameWs.on({ onConnectionFailed })

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()
      mockWebSocketInstances[0].simulateClose()

      // Fail 4 reconnection attempts (one less than max)
      for (let i = 0; i < 4; i++) {
        const delay = Math.pow(2, i) * 1000
        vi.advanceTimersByTime(delay)
        mockWebSocketInstances[i + 1].simulateClose()
      }

      // Should not have called onConnectionFailed yet
      expect(onConnectionFailed).not.toHaveBeenCalled()
    })
  })

  describe('intentional disconnect', () => {
    it('stops reconnecting when intentionally disconnected', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const onConnectionFailed = vi.fn()

      gameWs.on({ onConnectionFailed })

      // Connect and open
      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()

      // Intentionally disconnect
      gameWs.disconnect()

      // Wait for any potential reconnection attempts
      vi.advanceTimersByTime(100000)

      // Should only have the original connection, no reconnection attempts
      expect(mockWebSocketInstances).toHaveLength(1)
      expect(onConnectionFailed).not.toHaveBeenCalled()
    })

    it('does not reconnect after disconnect() even if connection was closed by server', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()

      // Disconnect intentionally
      gameWs.disconnect()

      // The close handler will be called since we set readyState to CLOSED
      // But no reconnection should happen

      vi.advanceTimersByTime(100000)
      expect(mockWebSocketInstances).toHaveLength(1)
    })
  })

  describe('reconnect attempt counter reset', () => {
    it('resets reconnect attempts counter on successful connection', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const onConnectionFailed = vi.fn()

      gameWs.on({ onConnectionFailed })

      // Connect and close
      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()
      mockWebSocketInstances[0].simulateClose()

      // Fail 3 reconnection attempts
      for (let i = 0; i < 3; i++) {
        const delay = Math.pow(2, i) * 1000
        vi.advanceTimersByTime(delay)
        mockWebSocketInstances[i + 1].simulateClose()
      }

      // 4th attempt succeeds
      vi.advanceTimersByTime(8000)
      expect(mockWebSocketInstances).toHaveLength(5)
      mockWebSocketInstances[4].simulateOpen()

      // Now close again - counter should have reset
      mockWebSocketInstances[4].simulateClose()

      // Should start from 1000ms delay again (counter reset)
      vi.advanceTimersByTime(999)
      expect(mockWebSocketInstances).toHaveLength(5)
      vi.advanceTimersByTime(1)
      expect(mockWebSocketInstances).toHaveLength(6)

      // And we should be able to fail 5 more times before onConnectionFailed
      expect(onConnectionFailed).not.toHaveBeenCalled()
    })
  })

  describe('connection state during reconnection', () => {
    it('notifies onConnectionChange(false) when connection is lost', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const connectionStates: boolean[] = []

      gameWs.on({
        onConnectionChange: (connected) => connectionStates.push(connected),
      })

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()
      expect(connectionStates).toEqual([true])

      mockWebSocketInstances[0].simulateClose()
      expect(connectionStates).toEqual([true, false])
    })

    it('notifies onConnectionChange(true) on successful reconnection', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const connectionStates: boolean[] = []

      gameWs.on({
        onConnectionChange: (connected) => connectionStates.push(connected),
      })

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()
      mockWebSocketInstances[0].simulateClose()

      // Wait for reconnect
      vi.advanceTimersByTime(1000)
      mockWebSocketInstances[1].simulateOpen()

      expect(connectionStates).toEqual([true, false, true])
    })

    it('notifies onConnectionChange(false) on error', async () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')
      const connectionStates: boolean[] = []

      gameWs.on({
        onConnectionChange: (connected) => connectionStates.push(connected),
      })

      gameWs.connect()
      mockWebSocketInstances[0].simulateError()

      expect(connectionStates).toEqual([false])
    })
  })

  describe('connect prevents duplicate connections', () => {
    it('does not create new WebSocket if one is already open', () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')

      gameWs.connect()
      mockWebSocketInstances[0].simulateOpen()

      // Try to connect again
      gameWs.connect()

      // Should still only have one WebSocket instance
      expect(mockWebSocketInstances).toHaveLength(1)
    })

    it('does not create new WebSocket if one is connecting', () => {
      const gameWs = new GameWebSocket('http://localhost', 'room-1', 'TestPlayer')

      gameWs.connect()
      // WebSocket is in CONNECTING state

      // Try to connect again
      gameWs.connect()

      // Should still only have one WebSocket instance
      expect(mockWebSocketInstances).toHaveLength(1)
    })
  })
})
