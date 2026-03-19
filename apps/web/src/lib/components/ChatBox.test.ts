// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import type { ChatMessage } from '@repo/types'
import ChatBox from './ChatBox.svelte'

afterEach(() => {
  cleanup()
})

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    playerId: 'player-1',
    playerName: 'Alice',
    playerColor: '#FF6B6B',
    content: 'Hello there',
    timestamp: 1,
    ...overrides,
  }
}

describe('ChatBox', () => {
  it('renders empty state and sends trimmed messages from submit and Enter', async () => {
    const onSendMessage = vi.fn()
    const { container } = render(ChatBox, {
      messages: [],
      currentPlayerId: 'player-1',
      onSendMessage,
    })

    expect(screen.getByText('No messages yet. Say hello! 👋')).toBeTruthy()

    const input = screen.getByLabelText('Chat message') as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement
    expect(sendButton.disabled).toBe(true)

    await fireEvent.input(input, { target: { value: '  first hello  ' } })
    expect(sendButton.disabled).toBe(false)

    const form = container.querySelector('form')
    if (!form) {
      throw new Error('Expected chat form to be rendered')
    }

    await fireEvent.submit(form)
    expect(onSendMessage).toHaveBeenNthCalledWith(1, 'first hello')
    expect(input.value).toBe('')

    await fireEvent.input(input, { target: { value: '  second hello  ' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendMessage).toHaveBeenNthCalledWith(2, 'second hello')

    await fireEvent.input(input, { target: { value: 'keep editing' } })
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSendMessage).toHaveBeenCalledTimes(2)
  })

  it('renders messages with own-message styling, fallback colors, and autoscroll', async () => {
    const onSendMessage = vi.fn()
    const ownMessage = createMessage({ playerColor: 'not-a-color' })
    const teammateMessage = createMessage({
      id: 'msg-2',
      playerId: 'player-2',
      playerName: 'Bob',
      playerColor: '#4ECDC4',
      content: 'Hi back!',
      timestamp: 2,
    })

    const { container, rerender } = render(ChatBox, {
      messages: [ownMessage],
      currentPlayerId: 'player-1',
      onSendMessage,
    })

    const messagesLog = screen.getByRole('log') as HTMLDivElement
    Object.defineProperty(messagesLog, 'scrollHeight', {
      configurable: true,
      value: 240,
    })

    await rerender({
      messages: [ownMessage, teammateMessage],
      currentPlayerId: 'player-1',
      onSendMessage,
    })

    expect(messagesLog.scrollTop).toBe(240)

    const messages = Array.from(container.querySelectorAll('.message'))
    expect(messages).toHaveLength(2)
    expect(messages[0]?.classList.contains('own')).toBe(true)

    const indicators = Array.from(container.querySelectorAll('.player-indicator')) as HTMLElement[]
    expect(indicators[0]?.style.backgroundColor).toBe('rgb(78, 205, 196)')
    expect(indicators[1]?.style.backgroundColor).toBe('rgb(78, 205, 196)')

    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.getByText('Hi back!')).toBeTruthy()
  })
})
