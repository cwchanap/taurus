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
