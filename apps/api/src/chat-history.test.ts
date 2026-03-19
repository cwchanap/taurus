import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '@repo/types'
import { ChatHistory } from './chat-history'
import { MAX_CHAT_HISTORY } from './constants'

function createMessage(index: number): ChatMessage {
  return {
    id: `msg-${index}`,
    playerId: `player-${index}`,
    playerName: `Player ${index}`,
    playerColor: '#FF6B6B',
    content: `message ${index}`,
    timestamp: index,
  }
}

describe('ChatHistory', () => {
  test('addMessage keeps only the newest messages when history exceeds the max size', () => {
    const history = new ChatHistory()

    for (let index = 0; index <= MAX_CHAT_HISTORY; index++) {
      history.addMessage(createMessage(index))
    }

    const messages = history.getMessages()
    expect(messages).toHaveLength(MAX_CHAT_HISTORY)
    expect(messages[0]?.id).toBe('msg-1')
    expect(messages.at(-1)?.id).toBe(`msg-${MAX_CHAT_HISTORY}`)
  })

  test('getMessages returns a defensive copy', () => {
    const history = new ChatHistory()
    history.addMessage(createMessage(1))

    const snapshot = history.getMessages()
    snapshot.push(createMessage(2))

    expect(snapshot).toHaveLength(2)
    expect(history.getMessages()).toHaveLength(1)
  })

  test('setMessages keeps the newest persisted messages only', () => {
    const history = new ChatHistory()
    const persistedMessages = Array.from({ length: MAX_CHAT_HISTORY + 3 }, (_, index) =>
      createMessage(index)
    )

    history.setMessages(persistedMessages)

    const messages = history.getMessages()
    expect(messages).toHaveLength(MAX_CHAT_HISTORY)
    expect(messages[0]?.id).toBe('msg-3')
    expect(messages.at(-1)?.id).toBe(`msg-${MAX_CHAT_HISTORY + 2}`)
  })

  test('clear removes all chat history', () => {
    const history = new ChatHistory()
    history.addMessage(createMessage(1))

    history.clear()

    expect(history.getMessages()).toEqual([])
  })
})
