# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Taurus is a multiplayer drawing game built as a Turborepo monorepo. Players join rooms via WebSocket and draw on a shared canvas in real-time.

## Commands

```bash
# Install dependencies
bun install

# Development (all apps)
bun run dev

# Development (specific app)
bun run dev --filter=web
bun run dev --filter=api

# Build all apps
bun run build

# Type checking
bun run check-types

# Linting
bun run lint

# Format code
bun run format
```

### API-specific commands (run from apps/api/)

```bash
bun run cf-typegen    # Generate Cloudflare types
bun run deploy        # Deploy to Cloudflare Workers
```

## Architecture

### Monorepo Structure

- `apps/web` - SvelteKit frontend (Vite, Svelte 5, TailwindCSS v4, pixi.js for canvas)
- `apps/api` - Hono API on Cloudflare Workers with Durable Objects
- `packages/ui` - Shared Svelte component library (@repo/ui)
- `packages/types` - Shared TypeScript types for frontend/backend (@repo/types)

### Backend (apps/api)

- **Framework**: Hono on Cloudflare Workers
- **Real-time**: Durable Objects for WebSocket room management
- **Key files**:
  - `src/index.ts` - HTTP routes and WebSocket upgrade endpoint
  - `src/room.ts` - `DrawingRoom` Durable Object handling player sessions, strokes, and broadcasts

### Frontend (apps/web)

- **Framework**: SvelteKit with static adapter
- **Canvas**: pixi.js for drawing
- **Key paths**:
  - `src/lib/websocket.ts` - `GameWebSocket` class for server communication
  - `src/lib/types.ts` - Re-exports shared types from `@repo/types` and defines local types (Point, Room, MessageType). Import `Player`, `Stroke`, etc. from `@repo/types` for wire-format types.
  - `src/lib/components/` - UI components (Canvas, Lobby, PlayerList, Toolbar)
  - `src/routes/draw/+page.svelte` - Main drawing room page

### Real-time Protocol

WebSocket messages use JSON with a `type` field. Message types:

- `join` / `init` - Player joins room, receives current state
- `player-joined` / `player-left` - Player roster updates
- `stroke` / `stroke-update` - Drawing data (new stroke, point added to stroke)
- `clear` - Canvas cleared

### Shared UI (packages/ui)

Exports Svelte components: `button.svelte`, `card.svelte`, `code.svelte`. Uses `clsx` and `tailwind-merge` for className utilities.

### Shared Types (packages/types)

Common TypeScript types shared between frontend and backend:

- `@repo/types` - Wire-format types for WebSocket messages
- Prevents type drift between client and server
- Import from `@repo/types` instead of duplicating

**Key types:**

- `GameStateWire` - JSON-serializable game state (sent over WebSocket)
- `ClientMessage` / `ServerMessage` - WebSocket message types (discriminated unions)
- `Player`, `Stroke`, `ChatMessage` - Core domain types

**Backend-specific:**

- `GameState` (in `apps/api/src/game-types.ts`) - Internal state using `Map` / `Set` for efficiency
- Use `gameStateToWire()` helper to convert internal state to wire format
- Use `scoresToRecord()` to serialize Map<string, ScoreEntry> to JSON

## Testing

### Unit Tests

Run: `bun test`

- Game logic: `apps/api/src/game-logic.test.ts` - pure functions for testability
- Validation: `apps/api/src/chat.test.ts` - message validation, sanitization
- Vocabulary: `apps/api/src/game.test.ts` - word selection logic
- Timer cleanup: `apps/api/src/timer-cleanup.test.ts` - timer management

### E2E Tests (Playwright)

Run: `cd apps/web && bun run e2e`

- `apps/web/e2e/game.spec.ts` - multiplayer game flows
- `apps/web/e2e/chat.spec.ts` - chat functionality

**Testing Durable Objects:**

Durable Objects are difficult to unit test. Extract business logic to pure functions in `game-logic.ts` for testability.
