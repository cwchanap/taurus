import { test, expect, type Locator } from '@playwright/test'

/**
 * Helper to get non-empty text from a locator with explicit wait.
 * This prevents flaky tests by ensuring the element has text before reading.
 */
async function getNonEmptyText(locator: Locator, timeout = 10000): Promise<string> {
  await expect(locator).not.toBeEmpty({ timeout })
  const text = await locator.textContent()
  if (!text) throw new Error('Element text content is null')
  return text
}

test.describe('Chat Room Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the draw page
    await page.goto('/draw')
  })

  test('should display chat box in game view', async ({ page }) => {
    // Enter player name
    await page.getByPlaceholder('Enter your name...').fill('TestPlayer')

    // Create a room
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Wait for game view to load
    await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

    // Verify chat box is visible
    await expect(page.locator('.chat-box')).toBeVisible()
    await expect(page.locator('h3:has-text("Chat")')).toBeVisible()
  })

  test('should send and display chat message', async ({ page }) => {
    // Enter player name
    await page.getByPlaceholder('Enter your name...').fill('ChatTester')

    // Create a room
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Wait for game view
    await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

    // Type a message in the chat input
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Hello, this is a test message!')

    // Send the message by pressing Enter
    await chatInput.press('Enter')

    // Verify the message appears in the chat
    await expect(
      page.locator('.message-content:has-text("Hello, this is a test message!")')
    ).toBeVisible()

    // Verify the player name is shown
    await expect(page.locator('.player-name:has-text("ChatTester")')).toBeVisible()
  })

  test('should show empty state when no messages', async ({ page }) => {
    // Enter player name
    await page.getByPlaceholder('Enter your name...').fill('NewPlayer')

    // Create a room
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Wait for game view
    await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

    // Verify empty state message
    await expect(page.locator('.empty-state:has-text("No messages yet")')).toBeVisible()
  })

  test('should disable send button when input is empty', async ({ page }) => {
    // Enter player name
    await page.getByPlaceholder('Enter your name...').fill('ButtonTester')

    // Create a room
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Wait for game view
    await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

    // Verify send button is disabled initially
    const sendButton = page.getByRole('button', { name: 'Send message' })
    await expect(sendButton).toBeDisabled()

    // Type something
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Test')

    // Verify send button is now enabled
    await expect(sendButton).toBeEnabled()

    // Clear the input
    await chatInput.fill('')

    // Verify send button is disabled again
    await expect(sendButton).toBeDisabled()
  })

  test('should send message using send button', async ({ page }) => {
    // Enter player name
    await page.getByPlaceholder('Enter your name...').fill('ClickSender')

    // Create a room
    await page.getByRole('button', { name: 'Create Room' }).click()

    // Wait for game view
    await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

    // Type a message
    const chatInput = page.getByPlaceholder('Type a message...')
    await chatInput.fill('Message sent via button')

    // Click send button
    await page.getByRole('button', { name: 'Send message' }).click()

    // Verify the message appears
    await expect(page.locator('.message-content:has-text("Message sent via button")')).toBeVisible()

    // Verify input is cleared after sending
    await expect(chatInput).toHaveValue('')
  })
})

test.describe('Chat Multi-Player Broadcast', () => {
  test('should broadcast messages between players', async ({ browser }) => {
    // Create two browser contexts for two players
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const player1Page = await context1.newPage()
    const player2Page = await context2.newPage()

    try {
      // Player 1 creates a room
      await player1Page.goto('/draw')
      await player1Page.getByPlaceholder('Enter your name...').fill('Player1')
      await player1Page.getByRole('button', { name: 'Create Room' }).click()

      // Wait for game view and get room code
      await expect(player1Page.locator('.game-container')).toBeVisible({ timeout: 10000 })

      const roomCode = await getNonEmptyText(player1Page.locator('.room-code'))

      // Player 2 joins the room
      await player2Page.goto('/draw')
      await player2Page.getByPlaceholder('Enter your name...').fill('Player2')
      await player2Page.getByPlaceholder('12-digit code').fill(roomCode)
      await player2Page.getByRole('button', { name: 'Join' }).click()

      // Wait for Player 2 to join
      await expect(player2Page.locator('.game-container')).toBeVisible({ timeout: 10000 })

      // Verify both players see each other in the player list
      await expect(player1Page.locator('.player:has-text("Player2")')).toBeVisible()
      await expect(player2Page.locator('.player:has-text("Player1")')).toBeVisible()

      // Player 1 sends a message
      await player1Page.getByPlaceholder('Type a message...').fill('Hello from Player1')
      await player1Page.getByPlaceholder('Type a message...').press('Enter')

      // Verify message appears on Player 2's screen
      await expect(
        player2Page.locator('.message-content:has-text("Hello from Player1")')
      ).toBeVisible({ timeout: 5000 })

      // Player 2 replies
      await player2Page.getByPlaceholder('Type a message...').fill('Hello from Player2')
      await player2Page.getByPlaceholder('Type a message...').press('Enter')

      // Verify Player 2's message appears on Player 1's screen
      await expect(
        player1Page.locator('.message-content:has-text("Hello from Player2")')
      ).toBeVisible({ timeout: 5000 })

      // Verify both messages are visible on both screens
      await expect(player1Page.locator('.message-content')).toHaveCount(2)
      await expect(player2Page.locator('.message-content')).toHaveCount(2)
    } finally {
      await context1.close()
      await context2.close()
    }
  })
})
