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

  describe('Init message game state for non-drawer reconnect', () => {
    it('should omit currentWord and wordLength for non-drawer players', () => {
      const initMessage = {
        type: 'init',
        playerId: 'p2',
        player: { id: 'p2', name: 'Guesser', color: '#4ECDC4' },
        players: [
          { id: 'p1', name: 'Drawer', color: '#FF6B6B' },
          { id: 'p2', name: 'Guesser', color: '#4ECDC4' },
        ],
        strokes: [],
        chatHistory: [],
        isHost: false,
        gameState: {
          status: 'playing' as const,
          currentRound: 1,
          totalRounds: 2,
          currentDrawerId: 'p1',
          // currentWord and wordLength intentionally omitted for non-drawers
          roundEndTime: Date.now() + 60000,
          scores: {},
        },
      }

      const serialized = JSON.stringify(initMessage)
      const parsed = JSON.parse(serialized)

      // Server omits currentWord for non-drawers; wordLength may also be omitted
      expect(parsed.gameState.currentWord).toBeUndefined()
      // Use nullish coalescing to reset stale state (as the component should do)
      expect(parsed.gameState.currentWord ?? '').toBe('')
      expect(parsed.gameState.wordLength ?? 0).toBe(0)
    })

    it('should include currentWord for drawer player', () => {
      const initMessage = {
        type: 'init',
        playerId: 'p1',
        player: { id: 'p1', name: 'Drawer', color: '#FF6B6B' },
        players: [
          { id: 'p1', name: 'Drawer', color: '#FF6B6B' },
          { id: 'p2', name: 'Guesser', color: '#4ECDC4' },
        ],
        strokes: [],
        chatHistory: [],
        isHost: true,
        gameState: {
          status: 'playing' as const,
          currentRound: 1,
          totalRounds: 2,
          currentDrawerId: 'p1',
          currentWord: 'elephant',
          wordLength: 8,
          roundEndTime: Date.now() + 60000,
          scores: {},
        },
      }

      const serialized = JSON.stringify(initMessage)
      const parsed = JSON.parse(serialized)

      expect(parsed.gameState.currentWord).toBe('elephant')
      expect(parsed.gameState.wordLength).toBe(8)
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
  let originalSetTimeout: typeof globalThis.setTimeout
  let originalClearTimeout: typeof globalThis.clearTimeout
  let mockWebSocketInstances: MockWebSocket[]
  let scheduledTimeoutCallbacks: Array<() => void>
  let scheduledTimeoutDelays: number[]

  const runNextScheduledTimeout = () => {
    const next = scheduledTimeoutCallbacks.shift()
    if (!next) {
      throw new Error('Expected a scheduled timeout callback, but none was found')
    }
    next()
  }

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    originalSetTimeout = globalThis.setTimeout
    originalClearTimeout = globalThis.clearTimeout
    mockWebSocketInstances = []
    scheduledTimeoutCallbacks = []
    scheduledTimeoutDelays = []

    globalThis.setTimeout = ((callback: TimerHandler, delay?: number) => {
      if (typeof callback !== 'function') {
        throw new Error('Expected function callback in test timeout shim')
      }
      scheduledTimeoutCallbacks.push(callback as () => void)
      scheduledTimeoutDelays.push(Number(delay ?? 0))
      return scheduledTimeoutCallbacks.length as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout

    globalThis.clearTimeout = (() => {
      // no-op for deterministic timeout shim in tests
    }) as unknown as typeof clearTimeout

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
    globalThis.WebSocket = originalWebSocket
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
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
      expect(scheduledTimeoutDelays[0]).toBe(1000)
      runNextScheduledTimeout()
      expect(mockWebSocketInstances).toHaveLength(2)

      // Close again
      mockWebSocketInstances[1].simulateClose()

      // Second reconnect: 2000ms delay (2^1 * 1000)
      expect(scheduledTimeoutDelays[1]).toBe(2000)
      runNextScheduledTimeout()
      expect(mockWebSocketInstances).toHaveLength(3)

      // Close again
      mockWebSocketInstances[2].simulateClose()

      // Third reconnect: 4000ms delay (2^2 * 1000)
      expect(scheduledTimeoutDelays[2]).toBe(4000)
      runNextScheduledTimeout()
      expect(mockWebSocketInstances).toHaveLength(4)

      // Close again
      mockWebSocketInstances[3].simulateClose()

      // Fourth reconnect: 8000ms delay (2^3 * 1000)
      expect(scheduledTimeoutDelays[3]).toBe(8000)
      runNextScheduledTimeout()
      expect(mockWebSocketInstances).toHaveLength(5)

      // Close again
      mockWebSocketInstances[4].simulateClose()

      // Fifth reconnect: 16000ms delay (2^4 * 1000)
      expect(scheduledTimeoutDelays[4]).toBe(16000)
      runNextScheduledTimeout()
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
        expect(scheduledTimeoutDelays[i]).toBe(Math.pow(2, i) * 1000)
        runNextScheduledTimeout()
        expect(mockWebSocketInstances).toHaveLength(i + 2)
        mockWebSocketInstances[i + 1].simulateClose()
      }

      // After 5 failed attempts, onConnectionFailed should be called
      expect(onConnectionFailed).toHaveBeenCalledTimes(1)
      expect(onConnectionFailed).toHaveBeenCalledWith(
        'Failed to reconnect after 5 attempts. Please refresh the page.'
      )

      // No more reconnection attempts should be made
      expect(scheduledTimeoutCallbacks).toHaveLength(0)
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
        expect(scheduledTimeoutDelays[i]).toBe(Math.pow(2, i) * 1000)
        runNextScheduledTimeout()
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
      expect(scheduledTimeoutCallbacks).toHaveLength(0)

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

      // Must call simulateClose() to trigger the onclose handler since disconnect() only closes from client side
      mockWebSocketInstances[0].simulateClose()

      expect(scheduledTimeoutCallbacks).toHaveLength(0)
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
        expect(scheduledTimeoutDelays[i]).toBe(Math.pow(2, i) * 1000)
        runNextScheduledTimeout()
        mockWebSocketInstances[i + 1].simulateClose()
      }

      // 4th attempt succeeds
      expect(scheduledTimeoutDelays[3]).toBe(8000)
      runNextScheduledTimeout()
      expect(mockWebSocketInstances).toHaveLength(5)
      mockWebSocketInstances[4].simulateOpen()

      // Now close again - counter should have reset
      mockWebSocketInstances[4].simulateClose()

      // Should start from 1000ms delay again (counter reset)
      expect(scheduledTimeoutDelays[4]).toBe(1000)
      runNextScheduledTimeout()
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
      expect(scheduledTimeoutDelays[0]).toBe(1000)
      runNextScheduledTimeout()
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
