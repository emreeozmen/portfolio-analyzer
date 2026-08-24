import { expect, test } from '@playwright/test'

test.describe('Top nav routing', () => {
  test('every public nav link routes to a real, non-404 page', async ({ page }) => {
    await page.goto('/')

    const routes: { label: string; heading: string | RegExp }[] = [
      { label: 'Piyasa Görünümü', heading: 'Piyasa Görünümü' },
      { label: 'Varlık Analizi', heading: 'Varlık Analizi' },
      { label: 'Kripto', heading: 'Kripto Piyasası' },
      { label: 'Enflasyon', heading: /enflasyon/i },
    ]

    const nav = page.getByRole('navigation')
    for (const { label, heading } of routes) {
      // Some of these labels (e.g. "Piyasa Görünümü") also appear as CTA buttons in
      // page content, not just the topbar — scoped to <nav> so the click is
      // unambiguous instead of a Playwright strict-mode violation.
      await nav.getByRole('link', { name: label, exact: true }).click()
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 15_000 })
    }
  })

  test('an unknown route falls back to the not-found page instead of a blank screen', async ({ page }) => {
    await page.goto('/bu-sayfa-yok-12345')
    await expect(page.getByText('Sayfa bulunamadı')).toBeVisible()
  })

  test('/portfolio redirects an unauthenticated visitor to the login form', async ({ page }) => {
    await page.goto('/portfolio')
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible()
  })
})
