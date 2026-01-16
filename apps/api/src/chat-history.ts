import { MAX_CHAT_HISTORY } from './constants'

export interface ChatMessage {
  id: string
  playerId: string
  playerName: string
  playerColor: string
  content: string
  timestamp: number
}

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
   * Resets the chat history (useful for tests)
   */
  clear(): void {
    this.messages = []
  }
}
