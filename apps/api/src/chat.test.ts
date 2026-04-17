import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import type { DurableObjectState } from '@cloudflare/workers-types'
import {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_CHAT_HISTORY,
  MAX_COORDINATE_VALUE,
} from './constants'
import {
  validateMessageContent,
  sanitizeMessage,
  isValidPlayerName,
  isValidPoint,
} from './validation'
import { ChatHistory } from './chat-history'

mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(state: unknown, env: unknown) {
      // @ts-expect-error - Mocking DurableObject constructor
      this.ctx = state
      // @ts-expect-error - Mocking DurableObject constructor
      this.env = env
    }
  },
}))

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockWs(playerId: string, playerName = 'TestPlayer'): any {
  return {
    deserializeAttachment: () => ({
      playerId,
      player: { id: playerId, name: playerName, color: '#FF6B6B' },
    }),
    serializeAttachment: mock(() => {}),
    send: mock(() => {}),
    close: mock(() => {}),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSentMessages(ws: ReturnType<typeof createMockWs>): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ws.send as ReturnType<typeof mock>).mock.calls.map((call: any[]) => {
    try {
      return JSON.parse(call[0] as string)
    } catch {
      return null
    }
  })
}

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

    test('should trim messages when setting history from storage', () => {
      const history = new ChatHistory()
      const storedMessages = Array.from({ length: MAX_CHAT_HISTORY + 5 }, (_, index) => ({
        id: `msg-${index}`,
        playerId: 'p1',
        playerName: 'User',
        playerColor: '#000',
        content: `Message ${index}`,
        timestamp: Date.now(),
      }))

      history.setMessages(storedMessages)

      const messages = history.getMessages()
      expect(messages.length).toBe(MAX_CHAT_HISTORY)
      expect(messages[0].id).toBe(`msg-${storedMessages.length - MAX_CHAT_HISTORY}`)
      expect(messages[messages.length - 1].id).toBe(`msg-${storedMessages.length - 1}`)
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

  describe('isValidPlayerName - edge cases', () => {
    test('accepts exactly MAX_PLAYER_NAME_LENGTH characters', () => {
      const name = 'a'.repeat(MAX_PLAYER_NAME_LENGTH)
      expect(isValidPlayerName(name)).toBe(true)
    })

    test('rejects exactly MAX_PLAYER_NAME_LENGTH + 1 characters', () => {
      const name = 'a'.repeat(MAX_PLAYER_NAME_LENGTH + 1)
      expect(isValidPlayerName(name)).toBe(false)
    })

    test('accepts unicode characters', () => {
      expect(isValidPlayerName('用户名')).toBe(true)
      expect(isValidPlayerName('🎨')).toBe(true)
    })

    test('accepts name with only special characters', () => {
      expect(isValidPlayerName('!!!')).toBe(true) // Actually valid - has content
    })

    test('accepts name with mixed alphanumeric and unicode', () => {
      expect(isValidPlayerName('User123用户')).toBe(true)
    })

    test('rejects null', () => {
      expect(isValidPlayerName(null)).toBe(false)
    })

    test('rejects undefined', () => {
      expect(isValidPlayerName(undefined)).toBe(false)
    })

    test('rejects number', () => {
      expect(isValidPlayerName(123)).toBe(false)
    })

    test('rejects object', () => {
      expect(isValidPlayerName({})).toBe(false)
    })
  })

  describe('Point validation edge cases', () => {
    // isValidPoint imported from validation.ts

    test('rejects NaN coordinates', () => {
      const point = { x: NaN, y: 100 }
      expect(isValidPoint(point)).toBe(false)
    })

    test('rejects Infinity coordinates', () => {
      expect(isValidPoint({ x: Infinity, y: 100 })).toBe(false)
      expect(isValidPoint({ x: 100, y: -Infinity })).toBe(false)
    })

    test('accepts boundary value MAX_COORDINATE_VALUE', () => {
      const point = { x: MAX_COORDINATE_VALUE, y: MAX_COORDINATE_VALUE }
      expect(isValidPoint(point)).toBe(true)
    })

    test('rejects value just above MAX_COORDINATE_VALUE', () => {
      const point = { x: MAX_COORDINATE_VALUE + 1, y: 100 }
      expect(isValidPoint(point)).toBe(false)
    })

    test('accepts negative coordinates within bounds', () => {
      const point = { x: -MAX_COORDINATE_VALUE, y: -MAX_COORDINATE_VALUE }
      expect(isValidPoint(point)).toBe(true)
    })

    test('rejects negative coordinates outside bounds', () => {
      const point = { x: -MAX_COORDINATE_VALUE - 1, y: 100 }
      expect(isValidPoint(point)).toBe(false)
    })

    test('accepts zero coordinates', () => {
      expect(isValidPoint({ x: 0, y: 0 })).toBe(true)
    })
  })
})

describe('DrawingRoom - close-guess feedback', () => {
  let DrawingRoomClass: (typeof import('./room'))['DrawingRoom']
  let room: InstanceType<(typeof import('./room'))['DrawingRoom']>
  let mockState: Partial<DurableObjectState>
  let mockGetWebSockets: ReturnType<typeof mock>
  let mockWaitUntil: ReturnType<typeof mock>
  let mockEnv: unknown

  beforeEach(async () => {
    ;({ DrawingRoom: DrawingRoomClass } = await import('./room'))

    mockGetWebSockets = mock(() => [])
    mockWaitUntil = mock(() => {})

    mockState = {
      storage: {
        get: mock(() => Promise.resolve(undefined)),
        put: mock(() => Promise.resolve()),
        delete: mock(() => Promise.resolve()),
        list: mock(() => Promise.resolve(new Map())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      id: {
        toString: () => 'test-room-id',
        equals: () => false,
        name: 'test-room',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      waitUntil: mockWaitUntil,
      blockConcurrencyWhile: mock(async (fn) => await fn()),
      getWebSockets: mockGetWebSockets,
    }

    mockEnv = {}
    void mockEnv

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoomClass(mockState as any, mockEnv as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).initialized = true
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).clearTimers()
  })

  function setPlayingStateWithWord(drawerId: string, guessers: string[], word: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 2,
      currentDrawerId: drawerId,
      currentWord: word,
      wordLength: word.length,
      roundStartTime: Date.now(),
      roundEndTime: Date.now() + 60_000,
      drawerOrder: [drawerId, ...guessers],
      scores: new Map([
        [drawerId, { score: 0, name: 'Drawer' }],
        ...guessers.map(
          (g) => [g, { score: 0, name: `Player ${g}` }] as [string, { score: number; name: string }]
        ),
      ]),
      correctGuessers: new Set<string>(),
      roundGuessers: new Set(guessers),
      roundGuesserScores: new Map(),
      usedWords: new Set([word]),
      consecutiveMissedRounds: new Map(),
      endGameAfterCurrentRound: false,
      revealedPositions: [],
    }
  }

  test('sends private "So close!" to guesser whose guess is 1 edit away from the word', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'cat')

    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'chat', content: 'ca' }))
    await flushPromises()

    const guesserMsgs = getSentMessages(guesserWs)

    const soClose = guesserMsgs.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => m?.type === 'system-message' && m?.content === 'So close!'
    )
    expect(soClose).toBeDefined()
  })

  test('"So close!" is NOT broadcast to other players', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'cat')

    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'chat', content: 'ca' }))
    await flushPromises()

    const drawerMsgs = getSentMessages(drawerWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(drawerMsgs.some((m: any) => m?.content === 'So close!')).toBe(false)
  })

  test('guess that is too far away does not trigger "So close!"', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'cat')

    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'chat', content: 'xyz' }))
    await flushPromises()

    const guesserMsgs = getSentMessages(guesserWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(guesserMsgs.some((m: any) => m?.content === 'So close!')).toBe(false)
  })

  test('drawer sending a near-miss does not receive "So close!"', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'cat')

    await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'chat', content: 'ca' }))
    await flushPromises()

    const drawerMsgs = getSentMessages(drawerWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(drawerMsgs.some((m: any) => m?.content === 'So close!')).toBe(false)
  })

  test('does not send so-close message to a player already in correctGuessers', async () => {
    const drawerWs = createMockWs('p1', 'Drawer')
    const guesserWs = createMockWs('p2', 'Guesser')
    mockGetWebSockets.mockReturnValue([drawerWs, guesserWs])

    setPlayingStateWithWord('p1', ['p2'], 'elephant')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(room as any).gameState.correctGuessers.add('p2')

    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'chat', content: 'elepant' }))
    await flushPromises()

    const guesserMsgs = getSentMessages(guesserWs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const soClose = guesserMsgs.find((m: any) => m?.content?.includes('So close!'))
    expect(soClose).toBeUndefined()
  })
})
