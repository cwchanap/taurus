import { expect, type Locator } from '@playwright/test'

export async function getNonEmptyText(locator: Locator, timeout = 10000): Promise<string> {
  await expect(locator).not.toBeEmpty({ timeout })
  const text = await locator.textContent()
  if (!text) throw new Error('Element text content is null')
  return text
}
