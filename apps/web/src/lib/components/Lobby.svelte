<script lang="ts">
  interface Props {
    onCreateRoom: () => void
    onJoinRoom: (roomId: string) => void
    playerName: string
    onPlayerNameChange: (name: string) => void
    isLoading: boolean
    errorMessage?: string
  }

  let { onCreateRoom, onJoinRoom, playerName, onPlayerNameChange, isLoading, errorMessage }: Props =
    $props()

  let roomCode = $state('')

  function handleCreate() {
    if (playerName.trim()) {
      onCreateRoom()
    }
  }

  function handleJoin() {
    if (playerName.trim() && roomCode.trim()) {
      onJoinRoom(roomCode.toUpperCase())
    }
  }
</script>

<div class="lobby">
  <div class="lobby-card">
    <div class="header">
      <div class="logo-container">
        <img src="/logo.png" alt="Draw Together logo" class="mascot" />
      </div>
      <h1 class="title">🎨 Draw Together</h1>
      <p class="subtitle">Create or join a room to start drawing with friends</p>
    </div>

    {#if errorMessage}
      <div class="error-message" role="alert">
        {errorMessage}
      </div>
    {/if}

    <div class="form">
      <div class="input-group">
        <label for="player-name">Your Name</label>
        <input
          id="player-name"
          type="text"
          placeholder="Enter your name..."
          value={playerName}
          oninput={(e) => onPlayerNameChange(e.currentTarget.value)}
          maxlength="50"
        />
      </div>

      <div class="actions">
        <button
          class="btn btn-primary"
          onclick={handleCreate}
          disabled={!playerName.trim() || isLoading}
        >
          {isLoading ? 'Creating...' : 'Create Room'}
        </button>

        <div class="divider">
          <span>or</span>
        </div>

        <div class="join-section">
          <input
            type="text"
            placeholder="12-digit code"
            bind:value={roomCode}
            maxlength="12"
            class="room-code-input"
            aria-label="Room Code"
          />
          <button
            class="btn btn-secondary"
            onclick={handleJoin}
            disabled={!playerName.trim() || !roomCode.trim() || isLoading}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .lobby {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  }

  .lobby-card {
    width: 100%;
    max-width: 420px;
    padding: 40px;
    background: linear-gradient(135deg, rgb(30 30 50 / 0.9), rgb(20 20 40 / 0.95));
    border-radius: 24px;
    backdrop-filter: blur(20px);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow:
      0 25px 50px -12px rgb(0 0 0 / 0.5),
      0 0 100px -20px rgb(78 205 196 / 0.2);
  }

  .header {
    text-align: center;
    margin-bottom: 32px;
  }

  .logo-container {
    width: 120px;
    height: 120px;
    margin: 0 auto 16px;
    border-radius: 50%;
    overflow: hidden;
    border: 3px solid #4ecdc4;
    box-shadow: 0 0 20px rgb(78 205 196 / 0.3);
  }

  .mascot {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .title {
    font-size: 32px;
    font-weight: 800;
    color: white;
    margin: 0 0 8px;
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: rgb(255 255 255 / 0.6);
    margin: 0;
    font-size: 15px;
  }

  .error-message {
    padding: 12px 16px;
    background: rgb(255 107 107 / 0.15);
    border: 1px solid rgb(255 107 107 / 0.3);
    border-radius: 12px;
    color: #ff6b6b;
    font-size: 14px;
    text-align: center;
    margin-bottom: 8px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .input-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input-group label {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgb(255 255 255 / 0.5);
  }

  input {
    padding: 14px 18px;
    background: rgb(255 255 255 / 0.05);
    border: 2px solid rgb(255 255 255 / 0.1);
    border-radius: 12px;
    color: white;
    font-size: 16px;
    transition: all 0.2s ease;
  }

  input::placeholder {
    color: rgb(255 255 255 / 0.3);
  }

  input:focus {
    outline: none;
    border-color: #4ecdc4;
    background: rgb(255 255 255 / 0.08);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .btn {
    padding: 16px 24px;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: linear-gradient(135deg, #4ecdc4, #45b7d1);
    color: white;
    box-shadow: 0 8px 20px -5px rgb(78 205 196 / 0.4);
  }

  .btn-primary:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 25px -5px rgb(78 205 196 / 0.5);
  }

  .btn-secondary {
    background: rgb(255 255 255 / 0.1);
    color: white;
    border: 2px solid rgb(255 255 255 / 0.2);
  }

  .btn-secondary:not(:disabled):hover {
    background: rgb(255 255 255 / 0.15);
    border-color: rgb(255 255 255 / 0.3);
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgb(255 255 255 / 0.1);
  }

  .divider span {
    color: rgb(255 255 255 / 0.4);
    font-size: 13px;
  }

  .join-section {
    display: flex;
    gap: 12px;
  }

  .room-code-input {
    flex: 1;
    text-transform: uppercase;
    text-align: center;
    letter-spacing: 2px;
    font-weight: 600;
  }
</style>
