export const MAX_PLAYER_NAME_LENGTH = 50
export const MAX_COLOR_LENGTH = 100
export const MAX_STROKE_SIZE = 1000
export const MIN_STROKE_SIZE = 0.1
export const MAX_STROKE_POINTS = 10000
export const MAX_COORDINATE_VALUE = 100000
export const MAX_CHAT_MESSAGE_LENGTH = 500
export const MAX_CHAT_HISTORY = 50

// Drawing tool limits
export const MAX_CANVAS_WIDTH = 4096
export const MAX_CANVAS_HEIGHT = 4096

// Game configuration
export const ROUND_DURATION_MS = 60000 // 60 seconds per round
export const MIN_PLAYERS_TO_START = 2
export const CORRECT_GUESS_BASE_SCORE = 100
export const DRAWER_BONUS_SCORE = 50

// Rate limiting
export const MAX_MESSAGES_PER_WINDOW = 50
export const MAX_STROKES_PER_WINDOW = 100
export const MAX_STROKE_UPDATES_PER_WINDOW = 600 // 60 updates/sec for 10 seconds
export const RATE_LIMIT_WINDOW = 10000 // 10 seconds

// Transition delays (in ms)
export const GAME_END_TRANSITION_DELAY = 3000 // Delay before showing final results
export const ROUND_END_TRANSITION_DELAY = 5000 // Delay between rounds
export const SKIP_ROUND_TRANSITION_DELAY = 2000 // Delay when skipping round (drawer left)

// Word choice
export const WORD_CHOICE_DURATION_MS = 10000 // 10s for drawer to pick a word
export const WORD_CHOICE_OPTIONS_COUNT = 3

// Hints
export const HINT_TIME_TRIGGER_1 = 0.5 // First hint fires at 50% elapsed time
export const HINT_TIME_TRIGGER_2 = 0.75 // Second hint fires at 75% elapsed time
export const HINT_LETTER_FRACTION_1 = 0.25 // First hint reveals 25% of letters
export const HINT_LETTER_FRACTION_2 = 0.5 // Second hint reveals 50% of letters total

// Catch-up scoring
export const CATCH_UP_BONUS_PER_ROUND = 10
export const MAX_CATCH_UP_BONUS = 50 // cap at 5 missed rounds worth
