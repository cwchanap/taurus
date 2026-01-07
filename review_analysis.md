# Code Review Analysis

This document analyzes the issues raised in `review.txt`. Each issue has been validated against the codebase.

## High Priority (P2 - Potential Bugs & Accessibility)

### 1. Missing Connection Cleanup (`apps/web/src/routes/draw/+page.svelte`)

- **Issue**: `connectToRoom` creates a new `GameWebSocket` without closing the previous one. The component also lacks `onDestroy` cleanup. This causes memory leaks and multiple active socket connections if the user rejoins or if hot-reloading happens.
- **Fix**:
  - Add `onDestroy(() => ws?.disconnect())`.
  - In `connectToRoom`, check `if (ws) ws.disconnect()` before creating a new one.

### 2. Unhandled API Errors (`apps/web/src/routes/draw/+page.svelte`)

- **Issue**: `createRoom` does not check `res.ok` before calling `res.json()`. If the API fails (404/500), it will throw or pass undefined to `connectToRoom`.
- **Fix**: Check `if (!res.ok) throw new Error(...)` immediately after fetch.

### 3. CSS Injection Vulnerability (`apps/web/src/lib/components/PlayerList.svelte`)

- **Issue**: `style="background-color: {player.color}"` allows arbitrary CSS injection if `player.color` is malicious (e.g. `red; background-image: ...`).
- **Fix**: Validate `player.color` to ensure it is a valid hex/rgb color, or use `CSS.escape` (prop sanitation), or preferably sets of pre-defined classes.

### 4. Accessibility: Missing Labels (`apps/web/src/lib/components/Toolbar.svelte`)

- **Issue**: Color and Size buttons lack `aria-label`. They contain no text content (only background color or a dot), making them invisible to screen readers.
- **Fix**: Add `aria-label="Select color {c}"` and `aria-label="Brush size {size}px"`.

### 5. Accessibility: Input Label (`apps/web/src/lib/components/Lobby.svelte`)

- **Issue**: Room code input has no associated label, only a placeholder.
- **Fix**: Add `aria-label="Room Code"` to the input or a visible `<label>`.

### 6. Prop Mutation (`apps/web/src/lib/components/Canvas.svelte`)

- **Issue**: `updateRemoteStroke` mutates the `strokes` prop (`existingStroke.points.push`), violating one-way data flow.
- **Fix**: The parent (`+page.svelte`) should manage state updates. `Canvas` should emit an event or the parent should update its own state and pass it down. However, for performance, the parent can update the state array immutably or Mutable if using Svelte 5 state correctly, but `Canvas` shouldn't mutate a prop directly.

### 7. Runtime Safety (`apps/web/src/lib/components/PlayerList.svelte`)

- **Issue**: `player.name.charAt(0)` risks crash if `player.name` is empty or undefined.
- **Fix**: Use optional chaining `player.name?.charAt(0)` and provide fallback.

### 8. Race Condition in Connect (`apps/web/src/lib/websocket.ts`)

- **Issue**: `connect()` creates a new WebSocket even if one exists/is connecting.
- **Fix**: Guard `if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;`.

## Medium Priority (P3 - Code Quality/Refactoring)

### 9. WebSocket Disconnect Logic (`apps/web/src/lib/websocket.ts`)

- **Issue**: `disconnect()` relies on setting `maxReconnectAttempts = 0` to prevent reconnection. This is obscure side-effect logic.
- **Fix**: Introduce `private isExplicitlyDisconnected = false`. Check this flag in `onclose` before attempting reconnect.

### 10. Unsafe JSON Parsing (`apps/api/src/room.ts`)

- **Issue**: `message as string` cast assumes text frame. Some environments/clients might send ArrayBuffer.
- **Fix**: Check `typeof message` or `instanceof ArrayBuffer` and decode if necessary before JSON parse.

### 11. Placeholder Removal (`review.txt`)

- **Issue**: The review file itself exists.
- **Fix**: Delete `review.txt`.

## Summary

The code review comments are high quality and point out real issues, particularly around:

1.  **Lifecycle management** of WebSockets (cleanup, race conditions).
2.  **Accessibility** (missing labels).
3.  **Security/Robustness** (CSS injection, API error handling, JSON parsing).

All issues should be addressed.
