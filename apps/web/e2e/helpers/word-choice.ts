import { expect, type Page } from '@playwright/test'

export async function handleWordChoice(page: Page, timeout = 15000): Promise<void> {
  const overlay = page.locator('.word-choice-overlay')
  const isVisible = await overlay.isVisible().catch(() => false)
  if (!isVisible) return

  const wordBtn = overlay.locator('.word-choice-btn').first()
  const hasButtons = await wordBtn.isVisible().catch(() => false)

  if (hasButtons) {
    await wordBtn.click()
  }

  await expect(overlay).not.toBeVisible({ timeout })
}
