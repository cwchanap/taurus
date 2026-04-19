import { expect, type Page } from '@playwright/test'

export async function handleWordChoice(page: Page, timeout = 15000): Promise<void> {
  const overlay = page.locator('.word-choice-overlay')

  // Wait for overlay to become visible instead of point-in-time check
  // to handle the race where it hasn't appeared yet but will soon
  try {
    await overlay.waitFor({ state: 'visible', timeout })
  } catch {
    // Overlay never appeared — no word-choice phase for this player
    return
  }

  const wordBtn = overlay.locator('.word-choice-btn').first()
  const hasButtons = await wordBtn.isVisible().catch(() => false)

  if (hasButtons) {
    await wordBtn.click()
  }

  await expect(overlay).not.toBeVisible({ timeout })
}
