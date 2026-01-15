<script lang="ts">
  import type { ChatMessage } from '$lib/types'

  interface Props {
    messages: ChatMessage[]
    currentPlayerId: string
    onSendMessage: (content: string) => void
  }

  let { messages, currentPlayerId, onSendMessage }: Props = $props()
  let inputValue = $state('')
  let messagesContainer = $state<HTMLDivElement>()

  function handleSubmit(e: Event) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    if (trimmed) {
      onSendMessage(trimmed)
      inputValue = ''
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  function isValidColor(color: string) {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)
  }

  // Auto-scroll to latest message
  $effect(() => {
    if (messages.length && messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  })
</script>

<div class="chat-box">
  <h3 class="title">Chat</h3>

  <div class="messages" bind:this={messagesContainer}>
    {#each messages as message}
      <div class="message" class:own={message.playerId === currentPlayerId}>
        <div class="message-header">
          <span
            class="player-indicator"
            style="background-color: {isValidColor(message.playerColor)
              ? message.playerColor
              : '#4ECDC4'}"
          ></span>
          <span class="player-name">{message.playerName}</span>
        </div>
        <p class="message-content">{message.content}</p>
      </div>
    {:else}
      <p class="empty-state">No messages yet. Say hello! 👋</p>
    {/each}
  </div>

  <form class="input-area" onsubmit={handleSubmit}>
    <input
      type="text"
      class="chat-input"
      placeholder="Type a message..."
      bind:value={inputValue}
      onkeydown={handleKeyDown}
      maxlength="500"
    />
    <button type="submit" class="send-btn" disabled={!inputValue.trim()} aria-label="Send message">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    </button>
  </form>
</div>

<style>
  .chat-box {
    display: flex;
    flex-direction: column;
    padding: 20px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 16px;
    backdrop-filter: blur(20px);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.5);
    height: 300px;
    margin-top: 16px;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: rgb(255 255 255 / 0.5);
    margin: 0 0 12px;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }

  .messages::-webkit-scrollbar {
    width: 4px;
  }

  .messages::-webkit-scrollbar-track {
    background: rgb(255 255 255 / 0.05);
    border-radius: 2px;
  }

  .messages::-webkit-scrollbar-thumb {
    background: rgb(255 255 255 / 0.2);
    border-radius: 2px;
  }

  .message {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message.own {
    align-items: flex-end;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .player-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .player-name {
    font-size: 11px;
    font-weight: 600;
    color: rgb(255 255 255 / 0.6);
  }

  .message-content {
    margin: 0;
    padding: 8px 12px;
    background: rgb(255 255 255 / 0.08);
    border-radius: 12px;
    font-size: 13px;
    color: rgb(255 255 255 / 0.9);
    max-width: 90%;
    word-wrap: break-word;
  }

  .message.own .message-content {
    background: linear-gradient(135deg, rgb(78 205 196 / 0.3), rgb(69 183 209 / 0.3));
  }

  .empty-state {
    text-align: center;
    color: rgb(255 255 255 / 0.4);
    font-size: 13px;
    margin: auto 0;
    padding: 20px;
  }

  .input-area {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .chat-input {
    flex: 1;
    padding: 10px 14px;
    background: rgb(255 255 255 / 0.08);
    border: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 10px;
    color: white;
    font-size: 13px;
    outline: none;
    transition: all 0.2s ease;
  }

  .chat-input::placeholder {
    color: rgb(255 255 255 / 0.4);
  }

  .chat-input:focus {
    border-color: rgb(78 205 196 / 0.5);
    background: rgb(255 255 255 / 0.1);
  }

  .send-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    border: none;
    border-radius: 10px;
    color: white;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .send-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 15px -3px rgb(78 205 196 / 0.5);
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .send-btn svg {
    width: 18px;
    height: 18px;
  }
</style>
