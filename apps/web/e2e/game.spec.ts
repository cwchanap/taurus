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

  test.describe('Correct Guess Flow', () => {
    test('should award points when player guesses correctly', async ({ browser }) => {
      const context1 = await browser.newContext()
      const context2 = await browser.newContext()

      const hostPage = await context1.newPage()
      const playerPage = await context2.newPage()

      try {
        // Host creates room
        await hostPage.goto('/draw')
        await hostPage.getByPlaceholder('Enter your name...').fill('Alice')
        await hostPage.getByRole('button', { name: 'Create Room' }).click()

        await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
        const roomCode = await hostPage.locator('.room-code').textContent()

        if (!roomCode) throw new Error('Failed to get room code')

        // Player joins
        await playerPage.goto('/draw')
        await playerPage.getByPlaceholder('Enter your name...').fill('Bob')
        await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
        await playerPage.getByRole('button', { name: 'Join' }).click()

        await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

        // Start the game
        await hostPage.locator('.start-game-btn').click()

        // Wait for game to start
        await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })
        await expect(playerPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Determine who is drawer and who is guesser
        const hostWordLabel = await hostPage.locator('.word-label').textContent()
        const isHostDrawer = hostWordLabel === 'Draw:'

        const drawerPage = isHostDrawer ? hostPage : playerPage
        const guesserPage = isHostDrawer ? playerPage : hostPage

        // Get the word from the drawer's view (the actual word, not masked)
        const wordElement = drawerPage.locator('.word:not(.masked)')
        await expect(wordElement).toBeVisible({ timeout: 5000 })
        const word = await wordElement.textContent()

        if (!word) throw new Error('Failed to get the word')

        // Guesser types the correct word in chat
        await guesserPage.locator('.chat-input').fill(word.trim())
        await guesserPage.locator('.chat-input').press('Enter')

        // Wait for correct guess notification to appear
        await expect(guesserPage.locator('.correct-guess-notification')).toBeVisible({
          timeout: 5000,
        })

        // Verify notification contains the guesser's name and score
        const notification = await guesserPage.locator('.correct-guess-notification').textContent()
        expect(notification).toContain('guessed correctly')
        expect(notification).toMatch(/\+\d+/) // Should show score like "+150"

        // Verify drawer also sees the notification
        await expect(drawerPage.locator('.correct-guess-notification')).toBeVisible({
          timeout: 5000,
        })

        // Verify the correct guess message is NOT shown in chat (it should be suppressed)
        // Wait a moment for any messages to appear
        await guesserPage.waitForTimeout(500)
        const chatMessages = await guesserPage.locator('.message-content').allTextContents()
        const wordAppearsInChat = chatMessages.some(
          (msg) => msg.toLowerCase() === word.trim().toLowerCase()
        )
        expect(wordAppearsInChat).toBe(false)

        // Verify scoreboard shows updated score for guesser
        const guesserName = isHostDrawer ? 'Bob' : 'Alice'
        const scoreRow = guesserPage.locator(`.score-row:has-text("${guesserName}")`)
        await expect(scoreRow).toBeVisible()
        const scoreText = await scoreRow.locator('.score').textContent()
        const score = parseInt(scoreText || '0', 10)
        expect(score).toBeGreaterThan(0)
      } finally {
        await context1.close()
        await context2.close()
      }
    })
  })

  test.describe('Game Reset Flow', () => {
    test('host can reset game and return to lobby', async ({ browser }) => {
      // Use longer timeout for this test
      test.setTimeout(60000)

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
        await expect(playerPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

        // Helper function to complete a round by having guesser guess correctly
        const completeRound = async () => {
          // Wait for round-end overlay to disappear (if present) and game to be in playing state
          // This handles the transition between rounds
          await hostPage
            .locator('.round-overlay')
            .waitFor({ state: 'hidden', timeout: 10000 })
            .catch((e: Error) => {
              if (e.message.includes('Timeout')) {
                console.warn('Round overlay waitFor timed out, continuing:', e.message)
              } else {
                throw e
              }
            })

          // Verify overlay is actually hidden after catch to avoid silently swallowing failures
          const overlayVisible = await hostPage.locator('.round-overlay').isVisible()
          if (overlayVisible) {
            // Check if game ended instead of round transitioning
            const gameOver = await hostPage.locator('.game-over-overlay').isVisible()
            if (!gameOver) {
              throw new Error(
                'Round overlay is still visible and game has not ended — round transition may have stalled'
              )
            }
          }

          // Check if game is already over
          const isOver = await hostPage.locator('.game-over-overlay').isVisible()
          if (isOver) return false

          // Determine who is drawer and who is guesser by checking for "Draw:" label
          const hostWordLabel = await hostPage.locator('.word-label').textContent()
          const isHostDrawer = hostWordLabel === 'Draw:'

          const drawerPage = isHostDrawer ? hostPage : playerPage
          const guesserPage = isHostDrawer ? playerPage : hostPage

          // Wait for the drawer to see their word (not just "—")
          const wordElement = drawerPage.locator('.word:not(.masked)')
          await expect(wordElement).toBeVisible({ timeout: 5000 })

          // Keep checking until we get an actual word, not "—"
          let word = await wordElement.textContent()
          let retries = 0
          while ((!word || word === '—') && retries < 10) {
            await hostPage.waitForTimeout(500)
            word = await wordElement.textContent()
            retries++
          }

          if (!word || word === '—') throw new Error('Failed to get the word')

          // Guesser types the correct word in chat
          await guesserPage.locator('.chat-input').fill(word.trim())
          await guesserPage.locator('.chat-input').press('Enter')

          // Wait for correct guess notification
          await expect(guesserPage.locator('.correct-guess-notification')).toBeVisible({
            timeout: 5000,
          })

          return true
        }

        // Complete round 1
        const round1Continues = await completeRound()

        // Complete round 2 only if the game hasn't ended
        if (round1Continues) {
          // Wait for round transition (round-end phase)
          await hostPage.waitForTimeout(4000)

          await completeRound()
        }

        // Wait for game to end
        await expect(hostPage.locator('.game-over-overlay')).toBeVisible({ timeout: 15000 })

        // Verify game over content is shown
        await expect(hostPage.locator('.game-over-content h2')).toContainText('Game Over')

        // Host clicks Play Again
        await hostPage.locator('.play-again-btn').click()

        // Verify returned to lobby state
        // The game-over overlay should disappear
        await expect(hostPage.locator('.game-over-overlay')).not.toBeVisible({ timeout: 5000 })

        // The start game section should be visible again
        await expect(hostPage.locator('.start-game-section')).toBeVisible({ timeout: 5000 })

        // The start game button should be visible (since we have 2 players)
        await expect(hostPage.locator('.start-game-btn')).toBeVisible()

        // Player should also see the lobby state
        await expect(playerPage.locator('.game-over-overlay')).not.toBeVisible({ timeout: 5000 })
        await expect(playerPage.locator('.waiting-text')).toContainText('Waiting for host')
      } finally {
        await context1.close()
        await context2.close()
      }
    })
  })
})
