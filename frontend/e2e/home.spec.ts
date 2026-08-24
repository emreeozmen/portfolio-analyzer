import { expect, test } from '@playwright/test'

test.describe('Home page', () => {
  test('loads with hero content and real market data', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Finansal Risk & Portföy Analiz Platformu' })).toBeVisible()

    // Piyasa Özeti fetches real data (BIST 100 + ticker strip via WebSocket/REST) — wait
    // for the hero index card's price to actually render rather than asserting on
    // static copy, so this catches a real backend/data-wiring regression, not just a
    // typo in marketing text.
    await expect(page.locator('.market-overview-hero .market-overview-hero-label')).toHaveText('BIST 100', {
      timeout: 15_000,
    })
    await expect(page.locator('.market-overview-hero .market-overview-hero-price')).not.toHaveText('', {
      timeout: 15_000,
    })
  })

  test('theme toggle switches between dark and light without a page reload', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: /temaya geç/ })
    await expect(toggle).toBeVisible()

    await expect(page.locator('html')).toHaveAttribute('data-theme', /^(dark|light)$/)
    const initialTheme = (await page.locator('html').getAttribute('data-theme')) as 'dark' | 'light'
    const otherTheme = initialTheme === 'dark' ? 'light' : 'dark'

    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', otherTheme)

    // Toggling back returns to the original theme — confirms this is a real
    // stateful switch, not a one-way animation.
    await toggle.click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme)
  })
})
