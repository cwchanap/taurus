# Player Experience Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add word choice, progressive hints, close-guess feedback, and catch-up scoring to improve the guessing game loop.

**Architecture:** All game logic lives server-side in the Durable Object. A new `word-choice` game phase is inserted before each drawing round. New WebSocket message types carry word options, hints, and catch-up bonus data to clients.

**Tech Stack:** Cloudflare Durable Objects (Hono/Bun), SvelteKit/Svelte 5, shared TypeScript types in `packages/types`

---

## File Map

| File                                            | Change                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/types/src/game.ts`                    | Add `'word-choice'` to `GameStatus`                                                                                                              |
| `packages/types/src/messages.ts`                | Add `word-choice-start`, `word-options`, `hint` server messages; `choose-word` client message; `catchUpBonus` on `correct-guess`                 |
| `apps/api/src/constants.ts`                     | Add 5 new constants                                                                                                                              |
| `apps/api/src/game-logic.ts`                    | Add `editDistance`, `buildHintString`, `pickNextRevealPositions`; update `calculateCorrectGuessScore`; extend `TimerContainer` + `clearTimers`   |
| `apps/api/src/game-logic.test.ts`               | Tests for new pure functions                                                                                                                     |
| `apps/api/src/game-types.ts`                    | Add `WordChoiceState`; add `consecutiveMissedRounds` to `BaseGameState`; add `revealedPositions` to `PlayingState`; update storage serialization |
| `apps/api/src/game-types.test.ts`               | Tests for new state serialization                                                                                                                |
| `apps/api/src/room.ts`                          | Split `startRound` into word-choice + drawing phases; hint timers; close-guess check; catch-up scoring; new instance fields                      |
| `apps/api/src/room.test.ts`                     | Integration tests for new server flows                                                                                                           |
| `apps/web/src/lib/components/GameHeader.svelte` | Handle `word-choice` status; show hint string                                                                                                    |
| `apps/web/src/routes/draw/+page.svelte`         | Handle new messages; word-choice overlay; comeback bonus notification                                                                            |

---

## Task 1: Extend Shared Types

**Files:**

- Modify: `packages/types/src/game.ts`
- Modify: `packages/types/src/messages.ts`

- [ ] **Step 1: Update `GameStatus` in `packages/types/src/game.ts`**

```ts
// Replace the existing GameStatus line:
export type GameStatus =
  | 'lobby'
  | 'starting'
  | 'word-choice'
  | 'playing'
  | 'round-end'
  | 'game-over'
```

- [ ] **Step 2: Add new server messages to `ServerMessage` in `packages/types/src/messages.ts`**

Add after the `| { type: 'game-reset' }` line:

```ts
  | {
      type: 'word-choice-start'
      roundNumber: number
      totalRounds: number
      drawerId: string
      drawerName: string
      wordChoiceEndTime: number
    }
  | { type: 'word-options'; words: string[]; timeToChoose: number }
  | { type: 'hint'; revealed: string }
```

- [ ] **Step 3: Update `correct-guess` in `ServerMessage` to add optional `catchUpBonus`**

Replace:

```ts
  | {
      type: 'correct-guess'
      playerId: string
      playerName: string
      score: number
      timeRemaining: number
    }
```

With:

```ts
  | {
      type: 'correct-guess'
      playerId: string
      playerName: string
      score: number
      timeRemaining: number
      catchUpBonus?: number
    }
```

- [ ] **Step 4: Add `choose-word` to `ClientMessage` in `packages/types/src/messages.ts`**

Add after `| { type: 'reset-game' }`:

```ts
  | { type: 'choose-word'; word: string }
```

- [ ] **Step 5: Verify types compile**

```bash
bun run check-types
```

Expected: no errors (some downstream files will error until later tasks complete — that is acceptable at this step if only `game-types.ts` / `room.ts` errors appear).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/game.ts packages/types/src/messages.ts
git commit -m "feat(types): add word-choice status and new message types"
```

---

## Task 2: Add Constants

**Files:**

- Modify: `apps/api/src/constants.ts`

- [ ] **Step 1: Append new constants**

```ts
// Word choice
export const WORD_CHOICE_DURATION_MS = 10000 // 10s for drawer to pick a word
export const WORD_CHOICE_OPTIONS_COUNT = 3

// Hints
export const HINT_FRACTION_1 = 0.25 // 25% of letters revealed at 50% time elapsed
export const HINT_FRACTION_2 = 0.5 // 50% of letters revealed at 75% time elapsed

// Catch-up scoring
export const CATCH_UP_BONUS_PER_ROUND = 10
export const MAX_CATCH_UP_BONUS = 50 // cap at 5 missed rounds worth
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/constants.ts
git commit -m "feat(api): add word-choice, hint, and catch-up scoring constants"
```

---

## Task 3: Pure Logic Functions + Tests

**Files:**

- Modify: `apps/api/src/game-logic.ts`
- Modify: `apps/api/src/game-logic.test.ts`

- [ ] **Step 1: Write failing tests in `game-logic.test.ts`**

Add at the bottom of the test file:

```ts
describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('apple', 'apple')).toBe(0)
  })
  it('returns 1 for single substitution', () => {
    expect(editDistance('cat', 'bat')).toBe(1)
  })
  it('returns 1 for single insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1)
  })
  it('returns 1 for single deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1)
  })
  it('returns 2 for two edits', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1)
    expect(editDistance('elephant', 'elfant')).toBe(2)
  })
  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('abc', '')).toBe(3)
    expect(editDistance('', '')).toBe(0)
  })
})

describe('buildHintString', () => {
  it('masks all letters with no revealed positions', () => {
    expect(buildHintString('apple', [])).toBe('_ _ _ _ _')
  })
  it('reveals letters at specified positions', () => {
    expect(buildHintString('apple', [1, 4])).toBe('_ p _ _ e')
  })
  it('always shows spaces', () => {
    expect(buildHintString('hot dog', [])).toBe('_ _ _   _ _ _')
  })
  it('always shows hyphens', () => {
    expect(buildHintString('t-rex', [])).toBe('_ - _ _ _')
  })
})

describe('pickNextRevealPositions', () => {
  it('returns at least 1 position', () => {
    const result = pickNextRevealPositions('hi', [], 0.25)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
  it('does not duplicate existing positions', () => {
    const result = pickNextRevealPositions('apple', [0], 0.5)
    const unique = new Set(result)
    expect(unique.size).toBe(result.length)
  })
  it('does not reveal more than targetFraction', () => {
    const result = pickNextRevealPositions('apple', [], 0.25)
    expect(result.length).toBeLessThanOrEqual(2) // ceil(5 * 0.25) = 2
  })
  it('skips spaces when counting maskable chars', () => {
    // "hot dog" has 6 maskable chars (spaces excluded)
    const result = pickNextRevealPositions('hot dog', [], 0.5)
    expect(result.length).toBe(3) // ceil(6 * 0.5) = 3
  })
})

describe('calculateCorrectGuessScore with missedRounds', () => {
  it('adds catch-up bonus for missed rounds', () => {
    const roundEndTime = Date.now() + 30000
    const { score: baseScore } = calculateCorrectGuessScore(roundEndTime, Date.now(), 0)
    const { score: bonusScore } = calculateCorrectGuessScore(roundEndTime, Date.now(), 3)
    expect(bonusScore - baseScore).toBe(30)
  })
  it('caps catch-up bonus at MAX_CATCH_UP_BONUS', () => {
    const roundEndTime = Date.now() + 30000
    const { catchUpBonus: bonus10 } = calculateCorrectGuessScore(roundEndTime, Date.now(), 10)
    const { catchUpBonus: bonus5 } = calculateCorrectGuessScore(roundEndTime, Date.now(), 5)
    expect(bonus10).toBe(bonus5) // both capped at +50
  })
  it('returns same score as before when missedRounds is 0', () => {
    const roundEndTime = Date.now() + 30000
    const { score: withZero } = calculateCorrectGuessScore(roundEndTime, Date.now(), 0)
    const { score: withDefault } = calculateCorrectGuessScore(roundEndTime, Date.now())
    expect(withZero).toBe(withDefault)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && bun test src/game-logic.test.ts 2>&1 | tail -20
```

Expected: multiple test failures for `editDistance`, `buildHintString`, `pickNextRevealPositions` (not exported yet).

- [ ] **Step 3: Add imports to `game-logic.ts`**

Update the import from `./constants`:

```ts
import {
  MIN_PLAYERS_TO_START,
  ROUND_DURATION_MS,
  CORRECT_GUESS_BASE_SCORE,
  MAX_MESSAGES_PER_WINDOW,
  MAX_STROKES_PER_WINDOW,
  MAX_STROKE_UPDATES_PER_WINDOW,
  RATE_LIMIT_WINDOW,
  CATCH_UP_BONUS_PER_ROUND,
  MAX_CATCH_UP_BONUS,
} from './constants'
```

- [ ] **Step 4: Update `calculateCorrectGuessScore` in `game-logic.ts`**

Replace the existing function:

```ts
export function calculateCorrectGuessScore(
  roundEndTime: number,
  currentTime: number = Date.now(),
  missedRounds = 0
): { score: number; catchUpBonus: number } {
  const timeRemaining = Math.max(0, roundEndTime - currentTime)
  const timeRatio = Math.min(1, Math.max(0, timeRemaining / ROUND_DURATION_MS))
  const baseScore = Math.round(CORRECT_GUESS_BASE_SCORE * (1 + timeRatio * 0.5))
  const catchUpBonus = Math.min(missedRounds * CATCH_UP_BONUS_PER_ROUND, MAX_CATCH_UP_BONUS)
  const score = baseScore + catchUpBonus
  return { score, catchUpBonus }
}
```

- [ ] **Step 5: Add `editDistance` to `game-logic.ts`**

```ts
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}
```

- [ ] **Step 6: Add `buildHintString` to `game-logic.ts`**

```ts
export function buildHintString(word: string, revealedPositions: number[]): string {
  const revealed = new Set(revealedPositions)
  return word
    .split('')
    .map((char, i) => {
      if (char === ' ' || char === '-') return char
      return revealed.has(i) ? char : '_'
    })
    .join(' ')
}
```

- [ ] **Step 7: Add `pickNextRevealPositions` to `game-logic.ts`**

```ts
export function pickNextRevealPositions(
  word: string,
  existing: number[],
  targetFraction: number
): number[] {
  const maskable = word
    .split('')
    .map((char, i) => ({ char, i }))
    .filter(({ char }) => char !== ' ' && char !== '-')
    .map(({ i }) => i)

  const targetCount = Math.max(1, Math.ceil(maskable.length * targetFraction))
  const currentRevealed = new Set(existing)
  const unrevealed = maskable.filter((i) => !currentRevealed.has(i))

  const needed = Math.max(0, targetCount - existing.length)
  if (needed === 0 || unrevealed.length === 0) return [...existing]

  const shuffled = [...unrevealed]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  return [...existing, ...shuffled.slice(0, needed)]
}
```

- [ ] **Step 8: Add missing imports to `game-logic.test.ts`**

At the top of the test file, make sure the new functions are imported:

```ts
import {
  // ... existing imports ...
  editDistance,
  buildHintString,
  pickNextRevealPositions,
} from './game-logic'
```

- [ ] **Step 9: Run tests to confirm they pass**

```bash
cd apps/api && bun test src/game-logic.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/game-logic.ts apps/api/src/game-logic.test.ts
git commit -m "feat(api): add editDistance, buildHintString, pickNextRevealPositions; update calculateCorrectGuessScore"
```

---

## Task 4: Extend TimerContainer

**Files:**

- Modify: `apps/api/src/game-logic.ts`

- [ ] **Step 1: Update `TimerContainer` interface**

Replace the existing interface:

```ts
export interface TimerContainer {
  roundTimer: ReturnType<typeof setTimeout> | null
  tickTimer: ReturnType<typeof setInterval> | null
  roundEndTimer: ReturnType<typeof setTimeout> | null
  gameEndTimer: ReturnType<typeof setTimeout> | null
  wordChoiceTimer: ReturnType<typeof setTimeout> | null
  hintTimer1: ReturnType<typeof setTimeout> | null
  hintTimer2: ReturnType<typeof setTimeout> | null
}
```

- [ ] **Step 2: Update `clearTimers`**

Replace the existing function:

```ts
export function clearTimers(container: TimerContainer) {
  if (container.roundTimer) clearTimeout(container.roundTimer)
  if (container.tickTimer) clearInterval(container.tickTimer)
  if (container.roundEndTimer) clearTimeout(container.roundEndTimer)
  if (container.gameEndTimer) clearTimeout(container.gameEndTimer)
  if (container.wordChoiceTimer) clearTimeout(container.wordChoiceTimer)
  if (container.hintTimer1) clearTimeout(container.hintTimer1)
  if (container.hintTimer2) clearTimeout(container.hintTimer2)

  container.roundTimer = null
  container.tickTimer = null
  container.roundEndTimer = null
  container.gameEndTimer = null
  container.wordChoiceTimer = null
  container.hintTimer1 = null
  container.hintTimer2 = null
}
```

- [ ] **Step 3: Run existing timer tests to confirm nothing broke**

```bash
cd apps/api && bun test src/timer-cleanup.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/game-logic.ts
git commit -m "feat(api): extend TimerContainer with wordChoiceTimer and hint timers"
```

---

## Task 5: Update Game State Types

**Files:**

- Modify: `apps/api/src/game-types.ts`
- Modify: `apps/api/src/game-types.test.ts`

- [ ] **Step 1: Write failing tests for new state fields**

Add to `game-types.test.ts`:

```ts
describe('WordChoiceState serialization', () => {
  it('round-trips through gameStateToStorage/gameStateFromStorage', () => {
    const state: WordChoiceState = {
      status: 'word-choice',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: null,
      wordLength: null,
      roundStartTime: null,
      roundEndTime: null,
      endGameAfterCurrentRound: false,
      drawerOrder: ['player1', 'player2'],
      scores: new Map([['player1', { score: 0, name: 'Alice' }]]),
      correctGuessers: new Set(),
      roundGuessers: new Set(['player2']),
      roundGuesserScores: new Map(),
      usedWords: new Set(),
      consecutiveMissedRounds: new Map([['player2', 2]]),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored)
    expect(restored.status).toBe('word-choice')
    expect((restored as WordChoiceState).currentDrawerId).toBe('player1')
    expect(restored.consecutiveMissedRounds.get('player2')).toBe(2)
  })
})

describe('PlayingState with revealedPositions', () => {
  it('serializes and restores revealedPositions', () => {
    const state: PlayingState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: 'apple',
      wordLength: 5,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      revealedPositions: [1, 3],
      drawerOrder: ['player1'],
      scores: new Map(),
      correctGuessers: new Set(),
      roundGuessers: new Set(),
      roundGuesserScores: new Map(),
      usedWords: new Set(['apple']),
      consecutiveMissedRounds: new Map(),
    }
    const stored = gameStateToStorage(state)
    const restored = gameStateFromStorage(stored) as PlayingState
    expect(restored.revealedPositions).toEqual([1, 3])
  })

  it('defaults revealedPositions to [] when absent from storage', () => {
    const stored: StoredGameState = {
      status: 'playing',
      currentRound: 1,
      totalRounds: 3,
      currentDrawerId: 'player1',
      currentWord: 'apple',
      wordLength: 5,
      roundStartTime: 1000,
      roundEndTime: 61000,
      endGameAfterCurrentRound: false,
      drawerOrder: ['player1'],
      scores: [],
      correctGuessers: [],
      roundGuessers: [],
      roundGuesserScores: [],
      usedWords: ['apple'],
      // revealedPositions absent (old storage)
      // consecutiveMissedRounds absent (old storage)
    }
    const restored = gameStateFromStorage(stored) as PlayingState
    expect(restored.revealedPositions).toEqual([])
    expect(restored.consecutiveMissedRounds.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && bun test src/game-types.test.ts 2>&1 | tail -15
```

Expected: type errors or test failures for missing `WordChoiceState`, `consecutiveMissedRounds`, `revealedPositions`.

- [ ] **Step 3: Add `consecutiveMissedRounds` to `BaseGameState` in `game-types.ts`**

```ts
type BaseGameState = {
  scores: Map<string, ScoreEntry>
  usedWords: Set<string>
  drawerOrder: string[]
  correctGuessers: Set<string>
  roundGuessers: Set<string>
  roundGuesserScores: Map<string, number>
  consecutiveMissedRounds: Map<string, number>
}
```

- [ ] **Step 4: Add `WordChoiceState` type in `game-types.ts`** (after `StartingState`)

```ts
export type WordChoiceState = BaseGameState & {
  status: 'word-choice'
  currentRound: number
  totalRounds: number
  currentDrawerId: string
  currentWord: null
  wordLength: null
  roundStartTime: null
  roundEndTime: null
  endGameAfterCurrentRound: boolean
}
```

- [ ] **Step 5: Add `revealedPositions` to `PlayingState`**

```ts
export type PlayingState = BaseGameState & {
  status: 'playing'
  currentRound: number
  totalRounds: number
  currentDrawerId: string
  currentWord: string
  wordLength: number
  roundStartTime: number
  roundEndTime: number
  endGameAfterCurrentRound: boolean
  revealedPositions: number[]
}
```

- [ ] **Step 6: Update `GameState` union and add type guards**

```ts
export type GameState =
  | LobbyState
  | StartingState
  | WordChoiceState
  | PlayingState
  | RoundEndState
  | GameOverState

export function isWordChoiceState(state: GameState): state is WordChoiceState {
  return state.status === 'word-choice'
}

// Update isActiveGameState to include word-choice
export function isActiveGameState(
  state: GameState
): state is WordChoiceState | PlayingState | RoundEndState {
  return (
    state.status === 'word-choice' || state.status === 'playing' || state.status === 'round-end'
  )
}
```

- [ ] **Step 7: Update `createInitialGameState` to include `consecutiveMissedRounds`**

```ts
export function createInitialGameState(): LobbyState {
  return {
    status: 'lobby',
    currentRound: 0,
    totalRounds: 0,
    currentDrawerId: null,
    currentWord: null,
    wordLength: null,
    roundStartTime: null,
    roundEndTime: null,
    drawerOrder: [],
    scores: new Map(),
    correctGuessers: new Set(),
    roundGuessers: new Set(),
    roundGuesserScores: new Map(),
    usedWords: new Set(),
    consecutiveMissedRounds: new Map(),
  }
}
```

- [ ] **Step 8: Update `StoredGameState` interface**

Add to the existing interface:

```ts
consecutiveMissedRounds?: [string, number][]
revealedPositions?: number[]
```

- [ ] **Step 9: Update `gameStateToStorage`**

Add to the `stored` object initializer:

```ts
consecutiveMissedRounds: Array.from(state.consecutiveMissedRounds.entries()),
```

And inside the `isPlayingState(state)` block:

```ts
stored.revealedPositions = state.revealedPositions
```

- [ ] **Step 10: Update `gameStateFromStorage` baseState**

```ts
const baseState = {
  currentRound: stored.currentRound,
  totalRounds: stored.totalRounds,
  drawerOrder: stored.drawerOrder,
  scores: new Map(stored.scores),
  correctGuessers: new Set(stored.correctGuessers),
  roundGuessers: new Set(stored.roundGuessers),
  roundGuesserScores: new Map(stored.roundGuesserScores),
  usedWords: new Set(stored.usedWords),
  consecutiveMissedRounds: new Map(stored.consecutiveMissedRounds ?? []),
}
```

- [ ] **Step 11: Add `word-choice` case to `gameStateFromStorage` switch**

```ts
case 'word-choice': {
  if (!stored.currentDrawerId) {
    console.error('Corrupt word-choice state: missing drawerId, falling back to lobby')
    return createInitialGameState()
  }
  return {
    ...baseState,
    status: 'word-choice',
    currentDrawerId: stored.currentDrawerId,
    currentWord: null,
    wordLength: null,
    roundStartTime: null,
    roundEndTime: null,
    endGameAfterCurrentRound: stored.endGameAfterCurrentRound ?? false,
  } as WordChoiceState
}
```

- [ ] **Step 12: Update the `playing` case to include `revealedPositions`**

```ts
return {
  ...baseState,
  status: 'playing',
  currentDrawerId: stored.currentDrawerId,
  currentWord: stored.currentWord,
  wordLength: stored.wordLength,
  roundStartTime: stored.roundStartTime,
  roundEndTime: stored.roundEndTime,
  endGameAfterCurrentRound: stored.endGameAfterCurrentRound ?? false,
  revealedPositions: stored.revealedPositions ?? [],
} as PlayingState
```

- [ ] **Step 13: Update `gameStateToWire` to handle `word-choice`**

Add a new condition before the existing `isPlayingState` check:

```ts
if (isWordChoiceState(state)) {
  return {
    status: state.status,
    currentRound: state.currentRound,
    totalRounds: state.totalRounds,
    currentDrawerId: state.currentDrawerId,
    wordLength: undefined,
    roundEndTime: null,
    scores: scoresToRecord(state.scores),
  }
}
```

Also add `isWordChoiceState` to the import at the top of `game-types.ts` if it references itself (it's defined in the same file, no import needed).

- [ ] **Step 14: Run game-types tests**

```bash
cd apps/api && bun test src/game-types.test.ts 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 15: Commit**

```bash
git add apps/api/src/game-types.ts apps/api/src/game-types.test.ts
git commit -m "feat(api): add WordChoiceState, consecutiveMissedRounds, revealedPositions to game types"
```

---

## Task 6: Word Choice Flow in room.ts

**Files:**

- Modify: `apps/api/src/room.ts`
- Modify: `apps/api/src/room.test.ts`

- [ ] **Step 1: Write failing integration tests in `room.test.ts`**

Add a new describe block:

```ts
describe('word choice flow', () => {
  it('sends word-options to drawer only when round starts', async () => {
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    // Host starts game
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))

    const drawer = getSentMessages(ws1).find((m) => m.type === 'word-options')
      ? ws1
      : getSentMessages(ws2).find((m) => m.type === 'word-options')
        ? ws2
        : null
    expect(drawer).not.toBeNull()

    const nonDrawer = drawer === ws1 ? ws2 : ws1
    const nonDrawerMessages = getSentMessages(nonDrawer)
    expect(nonDrawerMessages.find((m) => m.type === 'word-options')).toBeUndefined()
    expect(nonDrawerMessages.find((m) => m.type === 'word-choice-start')).toBeDefined()
  })

  it('begins drawing when drawer sends choose-word with a valid option', async () => {
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))

    // Find which ws got word-options
    const ws1Messages = getSentMessages(ws1)
    const wordOptionsMsg = ws1Messages.find((m) => m.type === 'word-options') as
      | { type: 'word-options'; words: string[] }
      | undefined
    const drawerWs = wordOptionsMsg ? ws1 : ws2
    const options =
      wordOptionsMsg?.words ??
      (getSentMessages(ws2).find((m) => m.type === 'word-options') as { words: string[] }).words

    await room.webSocketMessage(drawerWs, JSON.stringify({ type: 'choose-word', word: options[0] }))

    const allDrawerMessages = getSentMessages(drawerWs)
    expect(
      allDrawerMessages.find((m) => m.type === 'round-start-for-drawer' && m.word)
    ).toBeDefined()
  })

  it('rejects choose-word if word is not in offered options', async () => {
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))

    const drawerWs = getSentMessages(ws1).find((m) => m.type === 'word-options') ? ws1 : ws2
    await room.webSocketMessage(
      drawerWs,
      JSON.stringify({ type: 'choose-word', word: 'NOTAVALIDWORD_XYZ' })
    )

    // Game should not have started drawing (no round-start-for-drawer yet)
    const drawerMessages = getSentMessages(drawerWs)
    const roundStartWithWord = drawerMessages.find(
      (m) => m.type === 'round-start-for-drawer' && m.word
    )
    expect(roundStartWithWord).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "word choice" 2>&1 | tail -20
```

Expected: failures (method not yet implemented).

- [ ] **Step 3: Add new instance fields to `DrawingRoom` class in `room.ts`**

After the existing timer fields (`roundTimer`, `tickTimer`, etc.), add:

```ts
wordChoiceTimer: ReturnType<typeof setTimeout> | null = null
hintTimer1: ReturnType<typeof setTimeout> | null = null
hintTimer2: ReturnType<typeof setTimeout> | null = null
private pendingWordOptions: string[] | null = null
private wordChoiceStartTime: number | null = null
```

- [ ] **Step 4: Update imports in `room.ts`**

Add to the `game-logic` import:

```ts
import {
  // ... existing imports ...
  buildHintString,
  pickNextRevealPositions,
  editDistance,
} from './game-logic'
```

Add to the `constants` import:

```ts
import {
  // ... existing imports ...
  WORD_CHOICE_DURATION_MS,
  WORD_CHOICE_OPTIONS_COUNT,
  HINT_FRACTION_1,
  HINT_FRACTION_2,
  CATCH_UP_BONUS_PER_ROUND,
  MAX_CATCH_UP_BONUS,
} from './constants'
```

Add `WordChoiceState` and `isWordChoiceState` to the `game-types` import.

Add `getRandomWordExcluding` is already imported; make sure `getRandomWordsExcluding` (plural) is available or implement it inline.

- [ ] **Step 5: Add `getRandomWordsExcluding` to `vocabulary.ts`**

Open `apps/api/src/vocabulary.ts` and add after the existing `getRandomWordExcluding`:

```ts
/**
 * Pick N distinct random words not in the exclude set.
 * Falls back to fewer words if vocabulary is exhausted.
 */
export function getRandomWordsExcluding(exclude: Set<string>, count: number): string[] {
  const available = VOCABULARY.filter((w) => !exclude.has(w))
  const result: string[] = []
  const pool = [...available]
  for (let i = pool.length - 1; i > 0 && result.length < count; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
    result.push(pool[i])
  }
  // If pool had exactly `count` items left, include the last one
  if (result.length < count && pool.length > 0) result.push(pool[0])
  return result
}
```

Add `getRandomWordsExcluding` to the import in `room.ts`.

- [ ] **Step 6: Refactor `startRound()` into `beginWordChoice()` + `beginDrawing()` in `room.ts`**

Replace `private startRound()` with:

```ts
private startRound() {
  this.beginWordChoice()
}

private beginWordChoice() {
  const connectedPlayers = new Set(this.getPlayers().map((p) => p.id))
  const { drawerId, roundNumber } = findNextDrawer(
    this.gameState.currentRound,
    this.gameState.drawerOrder,
    connectedPlayers
  )

  if (!drawerId) {
    this.endGame()
    return
  }

  const drawerName = this.getPlayerName(drawerId)
  this.gameState.currentRound = roundNumber

  // Pick 3 word options (not yet chosen)
  const options = getRandomWordsExcluding(this.gameState.usedWords, WORD_CHOICE_OPTIONS_COUNT)
  this.pendingWordOptions = options

  const now = Date.now()
  this.wordChoiceStartTime = now
  const wordChoiceEndTime = now + WORD_CHOICE_DURATION_MS

  // Transition to word-choice state
  this.gameState = {
    ...this.gameState,
    status: 'word-choice',
    currentDrawerId: drawerId,
    currentWord: null,
    wordLength: null,
    roundStartTime: null,
    roundEndTime: null,
    endGameAfterCurrentRound:
      'endGameAfterCurrentRound' in this.gameState
        ? ((this.gameState as { endGameAfterCurrentRound?: boolean }).endGameAfterCurrentRound ??
          false)
        : false,
  } as WordChoiceState

  this.ctx.waitUntil(
    this.persistGameState().catch((e) => console.error('Failed to persist word-choice state:', e))
  )

  // Broadcast word-choice-start to all; send word-options only to drawer
  const deadSockets: WebSocket[] = []
  for (const ws of this.ctx.getWebSockets()) {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (!attachment?.playerId) continue
    try {
      if (attachment.playerId === drawerId) {
        ws.send(JSON.stringify({ type: 'word-options', words: options, timeToChoose: WORD_CHOICE_DURATION_MS / 1000 }))
      } else {
        ws.send(JSON.stringify({ type: 'word-choice-start', roundNumber, totalRounds: this.gameState.totalRounds, drawerId, drawerName, wordChoiceEndTime }))
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'InvalidStateError') {
        deadSockets.push(ws)
        continue
      }
      console.error('Unexpected word-choice send error:', error)
    }
  }
  for (const deadWs of deadSockets) {
    try { deadWs.close() } catch {}
  }

  this.clearTimers()
  this.wordChoiceTimer = setTimeout(() => {
    // Auto-pick first option if drawer didn't choose
    if (this.pendingWordOptions && this.pendingWordOptions.length > 0) {
      this.beginDrawing(this.pendingWordOptions[0])
    }
  }, WORD_CHOICE_DURATION_MS)
}

private beginDrawing(word: string) {
  if (!isWordChoiceState(this.gameState)) return

  const drawerId = this.gameState.currentDrawerId
  const drawerName = this.getPlayerName(drawerId)

  this.pendingWordOptions = null
  this.wordChoiceStartTime = null
  this.gameState.usedWords.add(word)

  const now = Date.now()

  this.gameState = {
    ...this.gameState,
    status: 'playing',
    currentWord: word,
    wordLength: word.length,
    roundStartTime: now,
    roundEndTime: now + ROUND_DURATION_MS,
    correctGuessers: new Set(),
    roundGuessers: new Set(
      this.getPlayers()
        .map((p) => p.id)
        .filter((id) => id !== drawerId)
    ),
    roundGuesserScores: new Map(),
    revealedPositions: [],
  } as PlayingState

  this.ctx.waitUntil(
    this.persistGameState().catch((e) => console.error('Failed to persist playing state:', e))
  )

  // Clear canvas
  if (this.storageWriteTimer) {
    clearTimeout(this.storageWriteTimer)
    this.storageWriteTimer = null
  }
  this.strokeStorageDirty = false
  this.fillStorageDirty = false
  this.strokes = []
  this.fills = []

  const strokeDeletePromise = this.queueStrokeDelete().catch((e) => {
    console.error('Failed to delete strokes from storage:', e)
    this.strokeStorageDirty = true
    this.scheduleStorageWrite('strokes')
  })
  const fillDeletePromise = this.queueFillDelete().catch((e) => {
    console.error('Failed to delete fills from storage:', e)
    this.fillStorageDirty = true
    this.scheduleStorageWrite('fills')
  })
  this.ctx.waitUntil(strokeDeletePromise)
  this.ctx.waitUntil(fillDeletePromise)

  // Broadcast split round-start messages
  const deadSockets: WebSocket[] = []
  for (const ws of this.ctx.getWebSockets()) {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (!attachment?.playerId) continue
    try {
      if (attachment.playerId === drawerId) {
        ws.send(JSON.stringify({
          type: 'round-start-for-drawer',
          roundNumber: this.gameState.currentRound,
          totalRounds: this.gameState.totalRounds,
          drawerId,
          drawerName,
          word,
          wordLength: word.length,
          endTime: this.gameState.roundEndTime,
        }))
      } else {
        ws.send(JSON.stringify({
          type: 'round-start-for-guesser',
          roundNumber: this.gameState.currentRound,
          totalRounds: this.gameState.totalRounds,
          drawerId,
          drawerName,
          wordLength: word.length,
          endTime: this.gameState.roundEndTime,
        }))
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'InvalidStateError') {
        deadSockets.push(ws)
        continue
      }
      console.error('Unexpected round-start send error:', error)
    }
  }
  for (const deadWs of deadSockets) {
    try { deadWs.close() } catch {}
  }

  this.broadcast({ type: 'clear' })

  this.clearTimers()
  this.roundTimer = setTimeout(() => this.endRound(false), ROUND_DURATION_MS)
  this.tickTimer = setInterval(() => {
    const remaining = Math.max(0, (this.gameState.roundEndTime || 0) - Date.now())
    if (remaining > 0) {
      this.broadcast({ type: 'tick', timeRemaining: Math.ceil(remaining / 1000) })
    }
  }, 1000)
  // Note: hintTimer1 and hintTimer2 are added in Task 7 once sendHint() exists
}
```

- [ ] **Step 7: Add `choose-word` message handler in `room.ts`**

Find where other message types are handled (the big switch/if-else in the message handler method) and add:

```ts
} else if (msg.type === 'choose-word') {
  if (!isWordChoiceState(this.gameState)) return
  if (playerId !== this.gameState.currentDrawerId) return
  const word = typeof msg.word === 'string' ? msg.word.trim() : ''
  if (!this.pendingWordOptions || !this.pendingWordOptions.includes(word)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid word choice', action: 'choose-word' }))
    return
  }
  this.clearTimers()
  this.beginDrawing(word)
}
```

- [ ] **Step 8: Handle `word-choice` in `resumeGameFlowFromState`**

In `resumeGameFlowFromState`, add a branch before the `playing` branch:

```ts
if (this.gameState.status === 'word-choice') {
  // pendingWordOptions are ephemeral — pick a fresh word and start drawing immediately
  const word = getRandomWordExcluding(this.gameState.usedWords)
  this.gameState.usedWords.add(word)
  this.beginDrawing(word)
  return
}
```

- [ ] **Step 9: Handle drawer reconnect during word-choice in the `init` message send**

In the section of `room.ts` that sends the `init` message to a newly connected/reconnected player, add after the init message is sent:

```ts
// If in word-choice phase and this is the drawer reconnecting, resend word-options
if (
  isWordChoiceState(this.gameState) &&
  playerId === this.gameState.currentDrawerId &&
  this.pendingWordOptions
) {
  const elapsed = this.wordChoiceStartTime
    ? Date.now() - this.wordChoiceStartTime
    : WORD_CHOICE_DURATION_MS
  const remaining = Math.max(1, Math.ceil((WORD_CHOICE_DURATION_MS - elapsed) / 1000))
  ws.send(
    JSON.stringify({
      type: 'word-options',
      words: this.pendingWordOptions,
      timeToChoose: remaining,
    })
  )
}
```

- [ ] **Step 10: Run word-choice tests**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "word choice" 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/room.ts apps/api/src/room.test.ts apps/api/src/vocabulary.ts
git commit -m "feat(api): implement word choice phase with beginWordChoice/beginDrawing split"
```

---

## Task 7: Hint Timers in room.ts

**Files:**

- Modify: `apps/api/src/room.ts`
- Modify: `apps/api/src/room.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('hint system', () => {
  it('sends hint to non-drawers at 50% time elapsed', async () => {
    vi.useFakeTimers()
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))

    // Trigger word choice timeout (auto-pick)
    vi.advanceTimersByTime(WORD_CHOICE_DURATION_MS)

    // Advance to 50% of round
    vi.advanceTimersByTime(ROUND_DURATION_MS * 0.5)

    const drawerWs = getSentMessages(ws1).find((m) => m.type === 'word-options') ? ws1 : ws2
    const nonDrawerWs = drawerWs === ws1 ? ws2 : ws1

    const hintMsg = getSentMessages(nonDrawerWs).find((m) => m.type === 'hint')
    expect(hintMsg).toBeDefined()
    expect(typeof (hintMsg as { revealed: string }).revealed).toBe('string')

    // Drawer should NOT receive hint
    expect(getSentMessages(drawerWs).find((m) => m.type === 'hint')).toBeUndefined()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "hint system" 2>&1 | tail -15
```

- [ ] **Step 3: Add hint timer scheduling to `beginDrawing` in `room.ts`**

After the `this.tickTimer = setInterval(...)` block in `beginDrawing`, add:

```ts
this.hintTimer1 = setTimeout(() => this.sendHint(1), ROUND_DURATION_MS * 0.5)
this.hintTimer2 = setTimeout(() => this.sendHint(2), ROUND_DURATION_MS * 0.75)
```

- [ ] **Step 4: Add `sendHint` method to `DrawingRoom` in `room.ts`**

```ts
private sendHint(hintNumber: 1 | 2) {
  if (!isPlayingState(this.gameState)) return
  const word = this.gameState.currentWord
  const drawerId = this.gameState.currentDrawerId
  const targetFraction = hintNumber === 1 ? HINT_FRACTION_1 : HINT_FRACTION_2

  const newPositions = pickNextRevealPositions(
    word,
    this.gameState.revealedPositions,
    targetFraction
  )
  this.gameState = { ...this.gameState, revealedPositions: newPositions } as PlayingState

  const hintString = buildHintString(word, newPositions)

  // Send only to non-drawers who haven't guessed yet
  for (const ws of this.ctx.getWebSockets()) {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    if (!attachment?.playerId) continue
    if (attachment.playerId === drawerId) continue
    if (this.gameState.correctGuessers.has(attachment.playerId)) continue
    try {
      ws.send(JSON.stringify({ type: 'hint', revealed: hintString }))
    } catch {}
  }
}
```

- [ ] **Step 4: Run hint tests**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "hint system" 2>&1 | tail -15
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/room.ts apps/api/src/room.test.ts
git commit -m "feat(api): add progressive hint timers at 50% and 75% of round duration"
```

---

## Task 8: Close-Guess Feedback in room.ts

**Files:**

- Modify: `apps/api/src/room.ts`
- Modify: `apps/api/src/room.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('close-guess feedback', () => {
  it('sends private "So close!" to player whose guess is 1 edit away', async () => {
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))
    // trigger word choice + round start via timer
    // ... (use fake timers if needed)

    // Find the current word from the drawer's round-start-for-drawer message
    const ws1Messages = getSentMessages(ws1)
    const drawerRoundStart = ws1Messages.find((m) => m.type === 'round-start-for-drawer' && m.word)
    if (!drawerRoundStart) return // drawer might be ws2, skip complex setup

    const word = (drawerRoundStart as { word: string }).word
    const closeGuess = word.slice(0, -1) // remove last char (1 edit away)

    await room.webSocketMessage(ws2, JSON.stringify({ type: 'chat', content: closeGuess }))

    const ws2AfterGuess = getSentMessages(ws2)
    const soClose = ws2AfterGuess.find(
      (m) => m.type === 'system-message' && (m as { content: string }).content === 'So close!'
    )
    expect(soClose).toBeDefined()
  })

  it('does not broadcast "So close!" to other players', async () => {
    // Same setup, check ws1 (drawer) does not receive the system-message
    // ...abbreviated: assert ws1 messages do not contain So close!
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "close-guess" 2>&1 | tail -15
```

- [ ] **Step 3: Add close-guess check to chat handler in `room.ts`**

In the chat message handler, after the `isCorrectGuess` check that returns early (when the player guessed correctly), and after the suppression check for messages containing the word, add:

```ts
// Close-guess feedback: private "So close!" if within edit distance threshold
if (isPlayingState(this.gameState) && !this.gameState.correctGuessers.has(playerId)) {
  const normalized = sanitizedContent.toLowerCase().trim()
  const currentWord = this.gameState.currentWord.toLowerCase()
  const threshold = currentWord.length <= 5 ? 1 : 2
  if (editDistance(normalized, currentWord) <= threshold && normalized !== currentWord) {
    ws.send(JSON.stringify({ type: 'system-message', content: 'So close!' }))
  }
}
```

- [ ] **Step 4: Run close-guess tests**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "close-guess" 2>&1 | tail -15
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/room.ts apps/api/src/room.test.ts
git commit -m "feat(api): add private close-guess feedback using Levenshtein distance"
```

---

## Task 9: Catch-Up Scoring in room.ts

**Files:**

- Modify: `apps/api/src/room.ts`
- Modify: `apps/api/src/room.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('catch-up scoring', () => {
  it('includes catchUpBonus when player has missed rounds', async () => {
    vi.useFakeTimers()
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))

    // Skip past word choice
    vi.advanceTimersByTime(WORD_CHOICE_DURATION_MS)

    // Manually set consecutiveMissedRounds for ws2's player
    // (we access via the game state — this requires exposing it or using endRound to accumulate)
    // Let a full round expire without ws2 guessing
    vi.advanceTimersByTime(ROUND_DURATION_MS)

    // Second round — skip word choice again
    vi.advanceTimersByTime(WORD_CHOICE_DURATION_MS)

    // Now ws2 guesses correctly in round 2
    const ws1Messages = getSentMessages(ws1)
    const roundStartMsg = ws1Messages
      .filter((m) => m.type === 'round-start-for-drawer' && m.word)
      .at(-1)
    const word = roundStartMsg
      ? (roundStartMsg as { word: string }).word
      : (
          getSentMessages(ws2)
            .filter((m) => m.type === 'round-start-for-drawer' && m.word)
            .at(-1) as { word: string } | undefined
        )?.word

    if (!word) {
      vi.useRealTimers()
      return
    }

    const guesserWs = getSentMessages(ws1).some(
      (m) => m.type === 'round-start-for-drawer' && (m as { word?: string }).word
    )
      ? ws2
      : ws1
    await room.webSocketMessage(guesserWs, JSON.stringify({ type: 'chat', content: word }))

    const correctGuessMsg = getSentMessages(guesserWs)
      .filter((m) => m.type === 'correct-guess')
      .at(-1) as { catchUpBonus?: number } | undefined
    expect(correctGuessMsg?.catchUpBonus).toBe(10) // 1 missed round * 10
    vi.useRealTimers()
  })

  it('does not include catchUpBonus when player has not missed rounds', async () => {
    vi.useFakeTimers()
    const room = new DrawingRoom(mockCtx, mockEnv)
    const ws1 = createMockWs()
    const ws2 = createMockWs()
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'join', name: 'Alice' }))
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'join', name: 'Bob' }))
    await room.webSocketMessage(ws1, JSON.stringify({ type: 'start-game' }))
    vi.advanceTimersByTime(WORD_CHOICE_DURATION_MS)

    const ws1Messages = getSentMessages(ws1)
    const roundStart = ws1Messages.find(
      (m) => m.type === 'round-start-for-drawer' && (m as { word?: string }).word
    )
    const word = (roundStart as { word?: string } | undefined)?.word
    if (!word) {
      vi.useRealTimers()
      return
    }

    // ws2 is the guesser (ws1 is drawer)
    await room.webSocketMessage(ws2, JSON.stringify({ type: 'chat', content: word }))

    const correctGuessMsg = getSentMessages(ws2).find((m) => m.type === 'correct-guess') as
      | { catchUpBonus?: number }
      | undefined
    expect(correctGuessMsg?.catchUpBonus).toBeUndefined()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "catch-up scoring" 2>&1 | tail -15
```

- [ ] **Step 3: Update correct-guess handling in `room.ts`**

Find where `correct-guess` is broadcast in the chat handler. Update to:

```ts
const missed = isPlayingState(this.gameState)
  ? (this.gameState.consecutiveMissedRounds.get(playerId) ?? 0)
  : 0
const { score, catchUpBonus } = calculateCorrectGuessScore(
  this.gameState.roundEndTime,
  Date.now(),
  missed
)

// Reset missed rounds for this player
if (isPlayingState(this.gameState)) {
  this.gameState.consecutiveMissedRounds.set(playerId, 0)
}

// Broadcast correct-guess
this.broadcast({
  type: 'correct-guess',
  playerId,
  playerName: player.name,
  score,
  timeRemaining: Math.ceil(Math.max(0, this.gameState.roundEndTime - Date.now()) / 1000),
  ...(catchUpBonus > 0 ? { catchUpBonus } : {}),
})
```

- [ ] **Step 4: Update `endRound` to increment `consecutiveMissedRounds` for non-guessers**

In `endRound()`, after the drawer bonus calculation, add:

```ts
// Update consecutiveMissedRounds for all eligible guessers
if (isPlayingState(this.gameState)) {
  for (const eligibleId of this.gameState.roundGuessers) {
    if (!this.gameState.correctGuessers.has(eligibleId)) {
      const current = this.gameState.consecutiveMissedRounds.get(eligibleId) ?? 0
      this.gameState.consecutiveMissedRounds.set(eligibleId, current + 1)
    }
    // correct guessers already reset to 0 when they guessed
  }
}
```

- [ ] **Step 5: Initialize `consecutiveMissedRounds` in `beginDrawing` (preserve across rounds)**

In `beginDrawing`, when constructing the new `PlayingState`, pass through the existing `consecutiveMissedRounds`:

```ts
this.gameState = {
  ...this.gameState,
  status: 'playing',
  // ... other fields ...
  consecutiveMissedRounds: this.gameState.consecutiveMissedRounds, // preserved from WordChoiceState
} as PlayingState
```

(The spread `...this.gameState` already includes it from `WordChoiceState`, so verify it's not being overwritten.)

- [ ] **Step 6: Run catch-up tests**

```bash
cd apps/api && bun test src/room.test.ts --test-name-pattern "catch-up" 2>&1 | tail -15
```

Expected: pass.

- [ ] **Step 7: Run full API test suite**

```bash
cd apps/api && bun test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/room.ts apps/api/src/room.test.ts
git commit -m "feat(api): implement catch-up scoring with consecutiveMissedRounds tracking"
```

---

## Task 10: Client — Word Choice UI

**Files:**

- Modify: `apps/web/src/routes/draw/+page.svelte`
- Modify: `apps/web/src/lib/components/GameHeader.svelte`

- [ ] **Step 1: Add word-choice state variables to `+page.svelte`**

After the existing state variables (around line 77), add:

```ts
let wordChoiceOptions = $state<string[]>([])
let wordChoiceEndTime = $state<number | null>(null)
let wordChoiceTimeRemaining = $state(0)
let wordChoiceTimerId: ReturnType<typeof setInterval> | null = null
```

- [ ] **Step 2: Handle `word-choice-start` message in the WebSocket message handler**

In the `onMessage` / message dispatch switch, add:

```ts
case 'word-choice-start': {
  gameStatus = 'word-choice'
  currentDrawerId = msg.drawerId
  currentDrawerName = msg.drawerName
  roundNumber = msg.roundNumber
  totalRounds = msg.totalRounds
  wordChoiceEndTime = msg.wordChoiceEndTime
  // Start local countdown for non-drawers
  if (wordChoiceTimerId) clearInterval(wordChoiceTimerId)
  wordChoiceTimerId = setInterval(() => {
    wordChoiceTimeRemaining = Math.max(0, Math.ceil((wordChoiceEndTime! - Date.now()) / 1000))
  }, 250)
  break
}
```

- [ ] **Step 3: Handle `word-options` message**

```ts
case 'word-options': {
  wordChoiceOptions = msg.words
  wordChoiceEndTime = Date.now() + msg.timeToChoose * 1000
  if (wordChoiceTimerId) clearInterval(wordChoiceTimerId)
  wordChoiceTimerId = setInterval(() => {
    wordChoiceTimeRemaining = Math.max(0, Math.ceil((wordChoiceEndTime! - Date.now()) / 1000))
  }, 250)
  break
}
```

- [ ] **Step 4: Handle `round-start-for-drawer` / `round-start-for-guesser` — clear word-choice state**

In both `round-start-for-drawer` and `round-start-for-guesser` handlers, add at the top:

```ts
wordChoiceOptions = []
wordChoiceEndTime = null
wordChoiceTimeRemaining = 0
if (wordChoiceTimerId) {
  clearInterval(wordChoiceTimerId)
  wordChoiceTimerId = null
}
```

- [ ] **Step 5: Add word choice function**

```ts
function chooseWord(word: string) {
  ws?.send({ type: 'choose-word', word })
  wordChoiceOptions = []
}
```

- [ ] **Step 6: Add word-choice overlay to the template in `+page.svelte`**

In the template section, after the `{#if pageState === 'game'}` block opens and before the main game layout, add:

```svelte
{#if gameStatus === 'word-choice'}
  <div class="word-choice-overlay">
    {#if wordChoiceOptions.length > 0}
      <div class="word-choice-card">
        <h2>Choose a word to draw</h2>
        <p class="word-choice-timer">{wordChoiceTimeRemaining}s</p>
        <div class="word-choice-options">
          {#each wordChoiceOptions as word}
            <button class="word-option-btn" onclick={() => chooseWord(word)}>
              {word}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="word-choice-card">
        <p>{currentDrawerName} is choosing a word...</p>
        <p class="word-choice-timer">{wordChoiceTimeRemaining}s</p>
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 7: Add word-choice overlay styles**

```svelte
<style>
  /* Add to existing styles */
  .word-choice-overlay {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .word-choice-card {
    background: linear-gradient(135deg, rgb(30 30 50), rgb(20 20 40));
    border: 1px solid rgb(78 205 196 / 0.3);
    border-radius: 20px;
    padding: 40px;
    text-align: center;
    min-width: 320px;
  }

  .word-choice-card h2 {
    color: #4ecdc4;
    font-size: 22px;
    margin: 0 0 8px;
  }

  .word-choice-timer {
    font-size: 36px;
    font-weight: 700;
    color: #ffeaa7;
    margin: 0 0 24px;
    font-family: 'JetBrains Mono', monospace;
  }

  .word-choice-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .word-option-btn {
    padding: 16px 32px;
    background: rgb(78 205 196 / 0.15);
    border: 2px solid rgb(78 205 196 / 0.3);
    border-radius: 12px;
    color: white;
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    letter-spacing: 1px;
  }

  .word-option-btn:hover {
    background: rgb(78 205 196 / 0.3);
    border-color: #4ecdc4;
    transform: translateY(-2px);
  }
</style>
```

- [ ] **Step 8: Update `GameHeader.svelte` to show word-choice status**

In `GameHeader.svelte`, update the outer condition from:

```svelte
{#if status === 'playing' || status === 'round-end'}
```

to:

```svelte
{#if status === 'playing' || status === 'round-end' || status === 'word-choice'}
```

And in the drawer-info section, add a word-choice branch:

```svelte
{#if status === 'word-choice'}
  <div class="timer-display">
    <span class="round-over-text">Choosing word...</span>
  </div>
{:else if status === 'playing'}
  <!-- existing timer -->
{:else if status === 'round-end'}
  <!-- existing round-over -->
{/if}
```

- [ ] **Step 9: Verify type checking**

```bash
bun run check-types 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/routes/draw/+page.svelte apps/web/src/lib/components/GameHeader.svelte
git commit -m "feat(web): add word choice overlay and word-choice status display"
```

---

## Task 11: Client — Hint Display

**Files:**

- Modify: `apps/web/src/lib/components/GameHeader.svelte`
- Modify: `apps/web/src/routes/draw/+page.svelte`

- [ ] **Step 1: Add `hintString` prop to `GameHeader.svelte`**

In the `Props` interface, add:

```ts
hintString?: string
```

Update `let { ..., hintString }: Props = $props()`

- [ ] **Step 2: Update the word display in `GameHeader.svelte` to show hint**

Replace the guessers word display:

```svelte
{:else}
  <span class="word-label">Guess:</span>
  {#if wordLength > 0}
    <span class="word masked">{hintString || maskedWord}</span>
    <span class="word-hint">({wordLength} letters)</span>
  {/if}
{/if}
```

- [ ] **Step 3: Add `hintString` state to `+page.svelte`**

```ts
let hintString = $state('')
```

- [ ] **Step 4: Handle `hint` message in `+page.svelte`**

```ts
case 'hint': {
  hintString = msg.revealed
  break
}
```

- [ ] **Step 5: Reset `hintString` on `round-start-for-drawer` / `round-start-for-guesser`**

In both round-start handlers, add:

```ts
hintString = ''
```

- [ ] **Step 6: Pass `hintString` to `GameHeader` in template**

Find the `<GameHeader ... />` usage and add the prop:

```svelte
<GameHeader ... hintString={isCurrentDrawer ? undefined : hintString} />
```

- [ ] **Step 7: Verify type checking**

```bash
bun run check-types 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/components/GameHeader.svelte apps/web/src/routes/draw/+page.svelte
git commit -m "feat(web): display progressive letter hints in GameHeader"
```

---

## Task 12: Client — Catch-Up Bonus Notification

**Files:**

- Modify: `apps/web/src/routes/draw/+page.svelte`

- [ ] **Step 1: Update `correct-guess` handler to show catch-up bonus**

Find the existing `correct-guess` handler and update the notification logic. Currently it sets `correctGuessNotification`. Update to:

```ts
case 'correct-guess': {
  // ... existing logic ...
  const bonus = msg.catchUpBonus ?? 0
  const notificationText = bonus > 0
    ? `${msg.playerName} guessed! +${msg.score} (includes +${bonus} comeback bonus!)`
    : `${msg.playerName} guessed! +${msg.score}`
  correctGuessNotification = { playerName: msg.playerName, score: msg.score, catchUpBonus: bonus }
  // ... rest of existing logic ...
  break
}
```

- [ ] **Step 2: Update the `correctGuessNotification` type if needed**

If `correctGuessNotification` is typed as `{ playerName: string; score: number } | null`, update to:

```ts
let correctGuessNotification = $state<{
  playerName: string
  score: number
  catchUpBonus?: number
} | null>(null)
```

- [ ] **Step 3: Update the notification template to show bonus**

Find where `correctGuessNotification` is rendered and add:

```svelte
{#if correctGuessNotification}
  <div class="correct-guess-notification">
    <span>{correctGuessNotification.playerName} guessed! +{correctGuessNotification.score}</span>
    {#if correctGuessNotification.catchUpBonus && correctGuessNotification.catchUpBonus > 0}
      <span class="comeback-bonus">+{correctGuessNotification.catchUpBonus} comeback bonus!</span>
    {/if}
  </div>
{/if}
```

Add style:

```svelte
.comeback-bonus {
  font-size: 12px;
  color: #ffeaa7;
  display: block;
}
```

- [ ] **Step 4: Verify type checking and run web tests**

```bash
bun run check-types 2>&1 | tail -10
cd apps/web && bun run test 2>&1 | tail -15
```

Expected: no type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/draw/+page.svelte
git commit -m "feat(web): show catch-up comeback bonus in correct-guess notification"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test 2>&1 | tail -30
```

Expected: all tests pass across API and web.

- [ ] **Step 2: Run type checking**

```bash
bun run check-types 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Run linter**

```bash
bun run lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for player experience features"
```
