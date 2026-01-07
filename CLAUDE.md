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
  - `src/lib/types.ts` - Shared TypeScript types (Player, Stroke, MessageType)
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
