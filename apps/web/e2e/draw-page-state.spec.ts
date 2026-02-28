import { test, expect } from '@playwright/test'
import { completeRoundByCorrectGuess } from './helpers/round-flow'
import { getNonEmptyText } from './helpers/text'

test.describe('Draw Page State Transitions', () => {
  test('covers lobby -> startable -> playing transitions for host and guest', async ({
    browser,
  }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const hostPage = await context1.newPage()
    const guestPage = await context2.newPage()

    try {
      await hostPage.goto('/draw')
      await hostPage.getByPlaceholder('Enter your name...').fill('HostPlayer')
      await hostPage.getByRole('button', { name: 'Create Room' }).click()

      await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
      await expect(hostPage.locator('.start-game-section')).toBeVisible()
      await expect(hostPage.locator('.waiting-text')).toContainText('at least 2 players')

      const roomCode = await getNonEmptyText(hostPage.locator('.room-code'))

      await guestPage.goto('/draw')
      await guestPage.getByPlaceholder('Enter your name...').fill('GuestPlayer')
      await guestPage.getByPlaceholder('12-digit code').fill(roomCode)
      await guestPage.getByRole('button', { name: 'Join' }).click()

      await expect(guestPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
      await expect(guestPage.locator('.waiting-text')).toContainText('Waiting for host')

      await expect(hostPage.locator('.start-game-btn')).toBeVisible({ timeout: 10000 })
      await hostPage.locator('.start-game-btn').click()

      await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 10000 })
      await expect(guestPage.locator('.game-header')).toBeVisible({ timeout: 10000 })
      await expect(hostPage.locator('.round-badge')).toContainText('Round')
      await expect(guestPage.locator('.round-badge')).toContainText('Round')

      const hostWordLabel = await getNonEmptyText(hostPage.locator('.word-label'))
      const guestWordLabel = await getNonEmptyText(guestPage.locator('.word-label'))

      expect(
        (hostWordLabel === 'Draw:' && guestWordLabel === 'Guess:') ||
          (hostWordLabel === 'Guess:' && guestWordLabel === 'Draw:')
      ).toBe(true)

      if (hostWordLabel === 'Guess:') {
        await expect(hostPage.locator('.cannot-draw-indicator')).toBeVisible()
        await expect(hostPage.locator('.toolbar.disabled')).toBeVisible()
      } else {
        await expect(guestPage.locator('.cannot-draw-indicator')).toBeVisible()
        await expect(guestPage.locator('.toolbar.disabled')).toBeVisible()
      }
    } finally {
      await context1.close()
      await context2.close()
    }
  })

  test('covers game-over overlay and Play Again reset to lobby', async ({ browser }) => {
    test.setTimeout(70000)

    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const hostPage = await context1.newPage()
    const playerPage = await context2.newPage()

    try {
      await hostPage.goto('/draw')
      await hostPage.getByPlaceholder('Enter your name...').fill('HostReset')
      await hostPage.getByRole('button', { name: 'Create Room' }).click()

      await expect(hostPage.locator('.game-container')).toBeVisible({ timeout: 10000 })
      const roomCode = await getNonEmptyText(hostPage.locator('.room-code'))

      await playerPage.goto('/draw')
      await playerPage.getByPlaceholder('Enter your name...').fill('GuestReset')
      await playerPage.getByPlaceholder('12-digit code').fill(roomCode)
      await playerPage.getByRole('button', { name: 'Join' }).click()

      await expect(playerPage.locator('.game-container')).toBeVisible({ timeout: 10000 })

      await hostPage.locator('.start-game-btn').click()

      await expect(hostPage.locator('.game-header')).toBeVisible({ timeout: 5000 })
      await expect(playerPage.locator('.game-header')).toBeVisible({ timeout: 5000 })

      const round1Continues = await completeRoundByCorrectGuess(hostPage, playerPage)
      if (round1Continues) {
        await hostPage.waitForTimeout(4000)
        await completeRoundByCorrectGuess(hostPage, playerPage)
      }

      await expect(hostPage.locator('.game-over-overlay')).toBeVisible({ timeout: 15000 })
      await expect(hostPage.locator('.game-over-content h2')).toContainText('Game Over')

      await hostPage.locator('.play-again-btn').click()

      await expect(hostPage.locator('.game-over-overlay')).not.toBeVisible({ timeout: 5000 })
      await expect(hostPage.locator('.start-game-section')).toBeVisible({ timeout: 5000 })
      await expect(hostPage.locator('.start-game-btn')).toBeVisible()

      await expect(playerPage.locator('.game-over-overlay')).not.toBeVisible({ timeout: 5000 })
      await expect(playerPage.locator('.waiting-text')).toContainText('Waiting for host')
    } finally {
      await context1.close()
      await context2.close()
    }
  })
})
