import { test, expect } from '@playwright/test'

test.describe('Drawing Game Feature', () => {
  test.describe('Game Lobby', () => {
    test('should show start game button for host', async ({ page }) => {
      await page.goto('/draw')
      await page.getByPlaceholder('Enter your name...').fill('HostPlayer')
      await page.getByRole('button', { name: 'Create Room' }).click()

      await expect(page.locator('.game-container')).toBeVisible({ timeout: 10000 })

      // Host should see the start game section
      await expect(page.locator('.start-game-section')).toBeVisible()
      // But button should show waiting message since only 1 player
      await expect(page.locator('.waiting-text')).toContainText('at least 2 players')
    })

    test('should show waiting message for non-host', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Host')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Player')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Non-host should see waiting message
        await expect(playerPage.locator('.waiting-text')).toContainText('Waiting for host')
      } finally {
        await context1.close()
        await context2.close()
      }
    })

    test('should enable start button with 2+ players', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Host')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Initially show waiting message
        await expect(hostPage.locator('.waiting-text')).toContainText('at least 2 players')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Player')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Now start button should be visible for host
        await expect(hostPage.locator('.start-game-btn')).toBeVisible({ timeout: 5000 })
        await expect(hostPage.locator('.start-game-btn')).toContainText('Start Game')
      } finally {
        await context1.close()
        await context2.close()
      }
    })
  })

  test.describe('Game Flow', () => {
    test('should start game and show round info', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Drawer')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Guesser')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Start the game
        await hostPage.locator('.start-game-btn').click()

        // Both players should see the game header
        await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })
        await expect(playerPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Should show round info
        await expect(hostPage.locator('.round-badge')).toContainText('Round')
        await expect(playerPage.locator('.round-badge')).toContainText('Round')

        // Timer should be visible
        await expect(hostPage.locator('.timer-display')).toBeVisible()
        await expect(playerPage.locator('.timer-display')).toBeVisible()
      } finally {
        await context1.close()
        await context2.close()
      }
    })

    test('drawer should see the word, guesser should see blanks', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('DrawerHost')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('GuesserPlayer')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Start the game
        await hostPage.locator('.start-game-btn').click()

        // Wait for game to start
        await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Check word display - one player gets "Draw:" label, other gets "Guess:"
        // We don't know who is drawer first, so check both possibilities
        const hostWordLabel = await hostPage.locator('.word-label').textContent()
        const playerWordLabel = await playerPage.locator('.word-label').textContent()

        // One should be drawer, one should be guesser
        expect(
          (hostWordLabel === 'Draw:' && playerWordLabel === 'Guess:') ||
            (hostWordLabel === 'Guess:' && playerWordLabel === 'Draw:')
        ).toBe(true)

        // Guesser should see masked word with underscores
        if (playerWordLabel === 'Guess:') {
          const guesserWord = await playerPage.locator('.word.masked').textContent()
          expect(guesserWord).toMatch(/^[_ ]+$/) // Only underscores and spaces
        } else {
          const guesserWord = await hostPage.locator('.word.masked').textContent()
          expect(guesserWord).toMatch(/^[_ ]+$/)
        }
      } finally {
        await context1.close()
        await context2.close()
      }
    })

    test('non-drawer canvas should be disabled', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Host')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Player')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Start the game
        await hostPage.locator('.start-game-btn').click()

        // Wait for game to start
        await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Check which page is the guesser (non-drawer)
        const hostWordLabel = await hostPage.locator('.word-label').textContent()

        if (hostWordLabel === 'Guess:') {
          // Host is guesser, should see disabled indicator
          await expect(hostPage.locator('.cannot-draw-indicator')).toBeVisible()
          await expect(hostPage.locator('.toolbar.disabled')).toBeVisible()
        } else {
          // Player is guesser
          await expect(playerPage.locator('.cannot-draw-indicator')).toBeVisible()
          await expect(playerPage.locator('.toolbar.disabled')).toBeVisible()
        }
      } finally {
        await context1.close()
        await context2.close()
      }
    })
  })

  test.describe('Scoreboard', () => {
    test('should show scoreboard during game', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Host')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Before game starts, should show PlayerList not Scoreboard
        await expect(hostPage.locator('.player:has-text("Host")')).toBeVisible()

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Player')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Start the game
        await hostPage.locator('.start-game-btn').click()

        // Wait for game to start
        await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Now scoreboard should be visible
        await expect(hostPage.locator('.scoreboard')).toBeVisible()
        await expect(playerPage.locator('.scoreboard')).toBeVisible()

        // Should show both players
        await expect(hostPage.locator('.score-row')).toHaveCount(2)
      } finally {
        await context1.close()
        await context2.close()
      }
    })
  })
})
