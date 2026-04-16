/**
 * Vocabulary word list for the drawing game
 */
export const VOCABULARY = [
  // Animals
  'cat',
  'dog',
  'elephant',
  'giraffe',
  'penguin',
  'butterfly',
  'dolphin',
  'turtle',
  'lion',
  'bear',
  'rabbit',
  'snake',
  'owl',
  'shark',
  'monkey',

  // Objects
  'umbrella',
  'bicycle',
  'guitar',
  'camera',
  'balloon',
  'pizza',
  'rocket',
  'airplane',
  'house',
  'car',
  'clock',
  'lamp',
  'chair',
  'book',
  'phone',

  // Nature
  'rainbow',
  'sun',
  'moon',
  'mountain',
  'tree',
  'flower',
  'cloud',
  'ocean',
  'volcano',
  'waterfall',
  'island',
  'river',
  'forest',
  'beach',
  'star',

  // Actions/Concepts
  'dancing',
  'sleeping',
  'swimming',
  'flying',
  'cooking',
  'reading',
  'painting',
  'laughing',
  'running',
  'singing',

  // More challenging
  'firefighter',
  'astronaut',
  'skateboard',
  'trampoline',
  'lighthouse',
  'snowman',
  'mermaid',
  'dinosaur',
  'superhero',
  'pirate',
  'wizard',
  'treasure',
  'castle',
  'dragon',
  'unicorn',
]

/**
 * Get a random word from the vocabulary list
 */
export function getRandomWord(): string {
  return VOCABULARY[Math.floor(Math.random() * VOCABULARY.length)]
}

/**
 * Get a random word, excluding words already used
 */
export function getRandomWordExcluding(usedWords: Set<string>): string {
  const available = VOCABULARY.filter((word) => !usedWords.has(word))
  if (available.length === 0) {
    // All words used, reset and pick any
    return VOCABULARY[Math.floor(Math.random() * VOCABULARY.length)]
  }
  return available[Math.floor(Math.random() * available.length)]
}

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
  if (result.length < count && pool.length > 0) result.push(pool[0])
  if (result.length < count) {
    console.warn(
      `getRandomWordsExcluding: vocabulary exhausted — requested ${count}, got ${result.length}`
    )
  }
  return result
}
