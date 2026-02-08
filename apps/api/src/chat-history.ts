import { MAX_CHAT_HISTORY } from './constants'
import type { ChatMessage } from '@repo/types'

export class ChatHistory {
  private messages: ChatMessage[] = []

  /**
   * Adds a message to history and trims if necessary
   */
  addMessage(message: ChatMessage): void {
    this.messages.push(message)
    if (this.messages.length > MAX_CHAT_HISTORY) {
      this.messages.shift()
    }
  }

  /**
   * Returns the current chat history
   */
  getMessages(): ChatMessage[] {
    return [...this.messages]
  }

  /**
   * Loads messages into history (used for persistence)
   */
  setMessages(messages: ChatMessage[]): void {
    this.messages = messages.slice(-MAX_CHAT_HISTORY)
  }

  /**
   * Resets the chat history (useful for tests)
   */
  clear(): void {
    this.messages = []
  }
}
