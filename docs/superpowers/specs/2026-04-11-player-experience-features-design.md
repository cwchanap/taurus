# Player Experience Features Design

**Date:** 2026-04-11
**Status:** Approved
**Focus:** Guessing/game loop improvements

## Overview

Four coordinated features that address the most frustrating moments in the guessing game loop:

1. **Word Choice** — drawer picks from 3 options instead of being assigned a random word
2. **Progressive Hints** — letters revealed at 50% and 75% of round time
3. **Close-Guess Feedback** — private "So close!" notification for near-misses
4. **Catch-Up Scoring** — bonus points for players on a losing streak

All logic is server-side (Durable Object) to prevent cheating.

---

## Architecture

### New GameStatus Value

```ts
export type GameStatus =
  | 'lobby'
  | 'starting'
  | 'word-choice'
  | 'playing'
  | 'round-end'
  | 'game-over'
```

`word-choice` is a new phase inserted between `starting` and `playing` at the beginning of each round.

### New Message Types

**Server → Client:**

```ts
| { type: 'word-options'; words: string[]; timeToChoose: number }  // sent to drawer only
| { type: 'hint'; revealed: string }                                // sent to non-drawers only
```

**Client → Server:**

```ts
| { type: 'choose-word'; word: string }
```

`system-message` (already exists) is reused for close-guess feedback — no new type needed.

`correct-guess` gains an optional field:

```ts
| {
    type: 'correct-guess'
    playerId: string
    playerName: string
    score: number
    timeRemaining: number
    catchUpBonus?: number  // new optional field
  }
```

---

## Feature 1: Word Choice

### Flow

1. Round begins → server picks 3 words from vocabulary (excluding used words this game)
2. Server sets status to `word-choice`, sends `word-options` to drawer only
3. Other players see "Drawer is choosing a word..." with a 10s countdown
4. Drawer sends `choose-word`; server validates the word is one of the 3 offered
5. If no choice within 10s, server auto-picks the first option
6. Round timer (60s) starts only after word is chosen — full draw time preserved

### Server Changes

**`room.ts` (DrawingRoom instance):**

- `pendingWordOptions: string[] | null` stored as an in-memory instance field on the Durable Object (not in `PlayingState` — it's ephemeral, lasts ~10s, and does not need to survive serialization)

**`room.ts`:**

- `startRound()` splits into:
  - `beginWordChoice(drawerId)` — picks 3 words, sets status, sends `word-options`, sets `wordChoiceTimer`
  - `beginDrawing(word)` — existing round-start logic, called after choice or timeout
- New `wordChoiceTimer` added to `TimerContainer`, cleared in `clearTimers()`
- `choose-word` handler validates word is in `pendingWordOptions`, then calls `beginDrawing(word)`
- On reconnect during `word-choice` phase: `init` message resends `word-options` to the drawer with remaining `timeToChoose` (computed from when the choice timer was set)

### Client Changes

**`+page.svelte` / `GameHeader.svelte`:**

- During `word-choice` status, non-drawers see "Choosing a word..." message with countdown
- Drawer gets a word-choice overlay: 3 buttons (one per word) + countdown timer
- On selection, sends `choose-word` message and dismisses overlay

---

## Feature 2: Progressive Letter Hints

### Reveal Schedule

| Time elapsed | Letters revealed (cumulative) |
| ------------ | ----------------------------- |
| 50%          | ~25% of letters (at least 1)  |
| 75%          | ~50% of letters total         |

Spaces and hyphens always shown. Drawer never receives hints.

### Reveal Algorithm

```text
word = "apple"
masked = ["_", "_", "_", "_", "_"]
at 50%: reveal 1 random position → ["_", "_", "_", "_", "e"]
at 75%: reveal 1 more random position → ["_", "p", "_", "_", "e"]
hint string sent: "_ p _ _ e"
```

Positions are chosen randomly; second hint builds on the first (cumulative, not replacement).

### Server Changes

**`game-types.ts`:**

- `PlayingState` gains `revealedPositions: number[]` (indices of revealed letters)

**`game-logic.ts`:**

- `buildHintString(word: string, revealedPositions: number[]): string` — pure function, testable
- `pickNextRevealPositions(word: string, existing: number[], targetFraction: number): number[]` — picks random unrevealed positions up to the target fraction

**`room.ts`:**

- Two hint timers set in `beginDrawing()`: `hintTimer1` at `roundDuration * 0.5`, `hintTimer2` at `roundDuration * 0.75`
- Both timers added to `TimerContainer` and cleared in `clearTimers()`
- On each timer fire: compute new revealed positions, send `hint` to all non-drawers, update `PlayingState`

**`constants.ts`:**

- `HINT_FRACTION_1 = 0.25` and `HINT_FRACTION_2 = 0.5`

### Client Changes

**`GameHeader.svelte`:**

- Already displays word-length dashes
- On `hint` message, replaces dash display with the partial reveal string (e.g. `"_ p _ _ e"`)
- Correct guessers still see the hint (they already know the word, no harm)
- Hint state resets on `round-start`

---

## Feature 3: Close-Guess Feedback

### Detection

After confirming a chat message is not a correct guess, compute Levenshtein edit distance between the normalized guess and the current word.

**Threshold:**

- Word length ≤ 5 chars: distance ≤ 1
- Word length > 5 chars: distance ≤ 2

Only fires if:

- Game status is `playing`
- Sender is not the drawer
- Sender has not already guessed correctly this round

### Server Changes

**`game-logic.ts`:**

- `editDistance(a: string, b: string): number` — standard DP implementation, pure function

**`room.ts`:**

- In chat handler, after the `isCorrectGuess` check, call `editDistance(normalizedGuess, currentWord)`
- If within threshold: send `system-message` privately to the guessing player's WebSocket only
- Message text: `"So close!"`
- The original chat message is still broadcast normally (it's a wrong guess)

No new message types. No broadcast of close-guess info (would leak the answer).

---

## Feature 4: Catch-Up Scoring

### Mechanic

- Each player accumulates `consecutiveMissedRounds` — resets to 0 on a correct guess
- Catch-up bonus at guess time: `+10 × consecutiveMissedRounds`, capped at `+50` (5 rounds)
- Bonus stacks on top of existing time-based score

**Example:** Player missed 3 rounds → guesses correctly → earns time-bonus + 30 catch-up bonus.

### Server Changes

**`game-types.ts`:**

- `PlayingState` gains `consecutiveMissedRounds: Map<string, number>`

**`game-logic.ts`:**

- `calculateCorrectGuessScore(roundEndTime, currentTime, missedRounds?)` — existing function gains optional `missedRounds` parameter
- `CATCH_UP_BONUS_PER_ROUND = 10` and `MAX_CATCH_UP_BONUS = 50` added to `constants.ts`

**`room.ts`:**

- On correct guess: read `consecutiveMissedRounds` for the player, compute bonus, reset to 0
- Include `catchUpBonus` in the `correct-guess` server message
- `endRound()` increments `consecutiveMissedRounds` for all players who did not guess correctly this round; resets for those who did

### Client Changes

**`+page.svelte`:**

- On `correct-guess`, if `catchUpBonus > 0`, append "+N comeback bonus!" to the existing score notification

---

## Testing Plan

- `game-logic.test.ts`: unit tests for `editDistance`, `buildHintString`, `pickNextRevealPositions`, updated `calculateCorrectGuessScore` with `missedRounds`
- `room.test.ts`: integration tests for full word-choice flow (timeout + selection), hint timer firing sequence, close-guess private message, catch-up bonus accumulation/reset
- `game-types.test.ts`: serialization of new `PlayingState` fields
- Manual: verify hint display updates in `GameHeader`, word-choice overlay dismissal, "So close!" toast visibility only to the guesser

---

## Scope Notes

- Word choice adds ~10s to each round start — acceptable UX tradeoff
- Close-guess check is O(n²) on word length, always short strings, negligible cost
- Catch-up scoring is transparent to players via the bonus field in notifications
- `word-choice` status must be handled gracefully on reconnect (`init` message should include pending word options for the drawer if reconnecting mid-choice)
