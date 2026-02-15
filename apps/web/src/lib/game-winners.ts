import type { ScoreEntry, Winner } from './types'

export function deriveGameWinners(scores: Record<string, ScoreEntry>): Winner[] {
  const scoreEntries = Object.entries(scores)
  if (scoreEntries.length === 0) {
    return []
  }

  let highestScore = -Infinity
  for (const [, scoreEntry] of scoreEntries) {
    if (scoreEntry.score > highestScore) {
      highestScore = scoreEntry.score
    }
  }

  return scoreEntries
    .filter(([, scoreEntry]) => scoreEntry.score === highestScore)
    .map(([playerId, scoreEntry]) => ({
      playerId,
      playerName: scoreEntry.name,
      score: scoreEntry.score,
    }))
}
