import { expect, type Page } from '@playwright/test'
import { getNonEmptyText } from './text'

export async function completeRoundByCorrectGuess(
  hostPage: Page,
  playerPage: Page
): Promise<boolean> {
  const priorRoundId = await hostPage.locator('.round-badge').textContent()

  try {
    await hostPage.locator('.round-overlay').waitFor({ state: 'hidden', timeout: 10000 })
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    if (!errorMessage.includes('Timeout')) {
      throw e
    }
  }

  const isOverlayVisible = await hostPage.locator('.round-overlay').isVisible()
  const isGameOverVisible = await hostPage.locator('.game-over-overlay').isVisible()
  const currentRoundId = await hostPage.locator('.round-badge').textContent()
  const roundChanged = currentRoundId !== priorRoundId

  if (isOverlayVisible && !isGameOverVisible && !roundChanged) {
    throw new Error(
      'Round transition verification failed: overlay still visible, game not over, and round did not change.'
    )
  }

  if (isGameOverVisible) return false

  const hostWordLabel = await getNonEmptyText(hostPage.locator('.word-label'))
  const isHostDrawer = hostWordLabel === 'Draw:'
  const drawerPage = isHostDrawer ? hostPage : playerPage
  const guesserPage = isHostDrawer ? playerPage : hostPage

  const wordElement = drawerPage.locator('.word:not(.masked)')
  await expect(wordElement).toBeVisible({ timeout: 5000 })

  let word = await wordElement.textContent()
  let retries = 0
  while ((!word || word === '—') && retries < 10) {
    await hostPage.waitForTimeout(500)
    word = await wordElement.textContent()
    retries++
  }

  if (!word || word === '—') throw new Error('Failed to read drawer word')

  await guesserPage.locator('.chat-input').fill(word.trim())
  await guesserPage.locator('.chat-input').press('Enter')
  await expect(guesserPage.locator('.correct-guess-notification')).toBeVisible({ timeout: 5000 })

  return true
}
