# PR Review Fixes Design

**Date:** 2026-04-15
**Branch:** feat/player-experience-features
**PR:** cwchanap/taurus#12

## Overview

Comprehensive fixes for all critical, important, and type-system issues identified in the PR review of the player-experience-features branch. Covers 6 critical bugs, 12 important issues, and 7 type system improvements.

## Approach

Fix-by-layer: types first (shared types underpin everything), then backend, then frontend, then tests. Each layer builds on the previous to avoid duplicate work.

---

## Layer 1: Shared Types (`packages/types/src/`)

### 1a. `GameStateWire` discriminated union

Replace the flat `GameStateWire` interface with per-status variants matching the internal `GameState` pattern:

```typescript
type GameStateWire =
  | LobbyStateWire // status: 'lobby'
  | StartingStateWire // status: 'starting'
  | WordChoiceStateWire // status: 'word-choice' — has deadlineTime: number
  | PlayingStateWire // status: 'playing'     — has deadlineTime: number, wordLength: number, currentWord?: string (drawer only), revealedHint?: string
  | RoundEndStateWire // status: 'round-end'   — has nextTransitionAt: number
  | GameOverStateWire // status: 'game-over'
```

Each variant carries only the fields that exist in that state. `roundEndTime` is renamed to `deadlineTime` in the variants where it appears (`word-choice`, `playing`). `nextTransitionAt` stays named as-is for `round-end`.

All variants share a base set: `status`, `players`, `scores`, `currentRound`, `totalRounds`, `currentDrawerId`.

### 1b. `round-start` split into two variants

```typescript
| { type: 'round-start-for-drawer'; word: string; wordLength: number; roundNumber: number; totalRounds: number }
| { type: 'round-start-for-guesser'; wordLength?: number; roundNumber: number; totalRounds: number }
```

Removes the implicit conditional optionality. Backend sends the appropriate variant per socket. The `wordLength` on the guesser variant remains optional because it is absent during the word-choice phase.

### 1c. `Player.color: PaletteColor`

Change `Player.color` from `string` to `PaletteColor`. Aligns with `Stroke.color` and `FillOperation.color` and enables the downstream fix in `room.ts` to import `PALETTE_COLORS` directly.

### 1d. `word-options` message: `words: [string, string, string]`

Change `words: string[]` to `[string, string, string]` tuple, matching `WORD_CHOICE_OPTIONS_COUNT = 3`. Makes an empty or undersized word-options screen a compile error.

### 1e. Internal `WordChoiceState.offeredWords`: `[string, string, string]`

Same tuple constraint applied to the internal backend state in `game-types.ts`. Enforces the invariant at the construction site.

---

## Layer 2: Backend (`apps/api/src/`)

### 2a. Error handling in `room.ts`

**`choose-word` handler (line 629):** Wrap the `clearTimers()` + `beginDrawing()` calls in a try-catch that logs the error and sends a descriptive error message to the client. Matches the pattern of every other handler in the WebSocket message switch.

**`sendHint` timer callbacks (lines 1774–1779):** Replace `void this.sendHint(n)` with explicit `.catch()` handlers:

```typescript
this.hintTimer1 = setTimeout(
  () => {
    this.sendHint(1).catch((e) => console.error('sendHint(1) failed:', e))
  },
  Math.max(0, hint1At - Date.now())
)
```

**`wordChoiceTimer` auto-advance (line 1598):** Wrap `beginDrawing()` in try-catch. Add a `console.info` log when the timer fires recording the drawer ID, auto-selected word, and round number.

**`handleCorrectGuess` persistence (line 2047):** Move `persistGameState()` into `ctx.waitUntil()` with a `.catch()`. Broadcast always fires regardless of persistence outcome. This prevents a persistence failure from silently blocking the correct-guess notification and round-end check.

### 2b. Vocabulary / word-choice safety

**`getRandomWordsExcluding()` (`vocabulary.ts`):** Log a `console.warn` when the returned array is shorter than `count`, indicating vocabulary exhaustion.

**`beginWordChoice()` (`room.ts` line 1525):** Guard after `getRandomWordsExcluding()`: if result is empty, log `console.error` and call `endGame()` instead of proceeding. Prevents permanent freeze in `word-choice` state. After the guard (when `options.length > 0`), assert `options as [string, string, string]` to satisfy the tuple type on `offeredWords` — valid because vocabulary exhaustion has been ruled out and `getRandomWordsExcluding` returns exactly `WORD_CHOICE_OPTIONS_COUNT` words when sufficient vocabulary is available.

**`resumeGameFlowFromState()` (`room.ts` line 246):** Add `pendingWordOptions.length === 0` guard before the `remainingMs <= 0` fast-path that calls `beginDrawing(pendingWordOptions[0])`. If options are empty, call `beginWordChoice()` to regenerate rather than passing `undefined` to `beginDrawing()`.

### 2c. `handleLeave` during word-choice (`room.ts` line 806)

Remove the intermediate invalid state assignment (`this.gameState = { currentDrawerId: '', ... }`). Since `beginWordChoice()` replaces the entire game state unconditionally, the intermediate state is unnecessary and creates a window where `currentDrawerId` is an empty string (invalid). The corrected block: clear timers, null out `pendingWordOptions` and `wordChoiceStartTime`, schedule the `cleanedPlayers` cleanup, then call `beginWordChoice()` directly. Wrap `beginWordChoice()` in try-catch with error logging.

### 2d. Catch-up bonus consolidation

Change `calculateCorrectGuessScore` in `game-logic.ts` to return `{ score: number; catchUpBonus: number }` instead of just `number`. `room.ts` uses the returned `catchUpBonus` in the broadcast message, eliminating the duplicate formula at line 2032. Single source of truth for the bonus cap logic.

### 2e. Color import (`room.ts` lines 22–31)

Remove the local `COLORS` array. Import `PALETTE_COLORS` from `@repo/types` and use it for player color assignment. Fixes the drift between `'#98D8C8'`/`'#F7DC6F'` (old room.ts) and `'#96CEB4'`/`'#FFEAA7'` (types).

### 2f. `gameStateToWire()` and `GameStateWire` adapter (`game-types.ts`)

Update `gameStateToWire()` to return the correct discriminated union variant per status. Rename `roundEndTime` → `deadlineTime` in the `word-choice` and `playing` variants. Update `StoredGameState` fallback log calls to include the full stored state object to aid post-mortem debugging.

### 2g. `round-start` broadcast split (`room.ts`)

Replace the single `round-start` broadcast with:

- `round-start-for-drawer` (with `word` and `wordLength`) to the drawer socket
- `round-start-for-guesser` (with optional `wordLength`) to all other sockets

---

## Layer 3: Frontend (`apps/web/src/`)

### 3a. `websocket.ts` — message dispatch

Update the `handleMessage` switch:

- Replace `round-start` case with `round-start-for-drawer` and `round-start-for-guesser` cases
- Update `GameStateWire` consumption in the `init` handler to use discriminated union narrowing — read `deadlineTime`, `wordLength`, etc. by narrowing on `status` instead of using optional chaining

### 3b. `+page.svelte` — fix `wordChoiceEndTime!` race

Replace the non-null assertion inside the `setInterval` callback with a null-safe check:

```typescript
wordChoiceTimerId = setInterval(() => {
  if (wordChoiceEndTime != null) {
    wordChoiceTimeRemaining = Math.max(0, Math.ceil((wordChoiceEndTime - Date.now()) / 1000))
  }
}, 250)
```

Applied to both `onWordChoiceStart` and `onWordOptions` handler intervals.

### 3c. `+page.svelte` — feedback for silent no-ops

**`handleSendMessage`:** Check the boolean return from `ws?.sendChat(content)`. If `false`, set `errorMessage` to inform the user their message was not sent.

**`handleStartGame`:** Check return value, set `errorMessage` if send fails.

**`chooseWord`:** Check return value from `ws?.sendChooseWord(word)`. If `false`, set `errorMessage` so the drawer knows their choice was not received and can retry before the timer expires.

### 3d. `+page.svelte` — `onWordChoiceStart` resets stale word options

Add `wordChoiceOptions = []` at the start of the `onWordChoiceStart` handler to clear any stale word buttons from the previous round.

### 3e. `draw-page-state.ts` — discriminated union narrowing

Where `draw-page-state.ts` reads from an incoming `GameStateWire`, use `status`-based narrowing to read `deadlineTime`, `wordLength`, etc. instead of optional chaining.

---

## Layer 4: Tests

### 4a. `websocket.test.ts`

Add dispatch tests in the "handleMessage dispatch" describe block:

- `word-options` → calls `onWordOptions` with correct args
- `word-choice-start` → calls `onWordChoiceStart` with correct args
- `hint` → calls `onHint` with `revealed` string
- Update `round-start` tests to cover `round-start-for-drawer` and `round-start-for-guesser` separately

### 4b. `GameHeader.test.ts`

Add two missing coverage cases:

- `status: 'word-choice'` → renders "Choosing word..." indicator, timer gets `round-over` CSS class
- `hintString` prop set → hint string renders in place of blank underscores

### 4c. `game-logic.test.ts`

- Update `calculateCorrectGuessScore` tests for new `{ score, catchUpBonus }` return shape; add a case verifying `catchUpBonus` is correctly capped
- `isCloseGuess` boundary: 5-char word with distance 1 (threshold 1 applies), 6-char word with distance 2 (threshold 2 applies)
- `pickNextRevealPositions`: when `existing.length >= targetCount`, returns existing unchanged

### 4d. `room.test.ts`

- Word-choice timer auto-advance: verify `wordChoiceTimer` callback fires and advances game to `playing` state (matching pattern of existing timer callback tests)
- `schedulePendingHints` rehydration with `revealedPositions` above hint fraction 1: verify `hintTimer1` is NOT scheduled, only `hintTimer2`
- "So close!" not sent to a player already in `correctGuessers`

### 4e. `draw-page-state.test.ts`

Add test for `createCorrectGuessNotification('Alice', 150, 30)` verifying `catchUpBonus: 30` is present in the returned object.

---

## Error Handling Philosophy

- **Backend timers:** All async callbacks in `setTimeout`/`setInterval` must have explicit `.catch()` — never `void asyncFn()`.
- **WebSocket handlers:** Every case in the message switch must be wrapped in its own try-catch.
- **Persistence failures:** Persistence should never block game-critical broadcasts. Use `ctx.waitUntil()` with `.catch()` for fire-and-forget persistence.
- **Frontend:** Every `ws.send*()` call that has game-critical consequences (guess, word choice, start game) must check the boolean return value and surface an `errorMessage` to the user.

## Files Changed

| File                                             | Change type                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/types/src/messages.ts`                 | Discriminated `GameStateWire`, split `round-start`, `Player.color`, `word-options` tuple |
| `packages/types/src/game.ts`                     | `offeredWords` tuple on `WordChoiceState`                                                |
| `apps/api/src/game-types.ts`                     | `gameStateToWire()` adapter, `StoredGameState` logging                                   |
| `apps/api/src/game-logic.ts`                     | `calculateCorrectGuessScore` returns `{ score, catchUpBonus }`                           |
| `apps/api/src/vocabulary.ts`                     | Log warning on short result                                                              |
| `apps/api/src/room.ts`                           | Error handling, color import, broadcast split, word-choice safety                        |
| `apps/web/src/lib/websocket.ts`                  | Updated dispatch, `GameStateWire` narrowing                                              |
| `apps/web/src/routes/draw/+page.svelte`          | Null-safe interval, send feedback, `onWordChoiceStart` reset                             |
| `apps/web/src/lib/draw-page-state.ts`            | Discriminated union narrowing                                                            |
| `apps/web/src/lib/websocket.test.ts`             | New dispatch tests                                                                       |
| `apps/web/src/lib/components/GameHeader.test.ts` | word-choice and hint tests                                                               |
| `apps/api/src/game-logic.test.ts`                | Updated return shape, boundary tests                                                     |
| `apps/api/src/room.test.ts`                      | Timer, hints rehydration, correctGuessers guard tests                                    |
| `apps/web/src/lib/draw-page-state.test.ts`       | catchUpBonus notification test                                                           |
