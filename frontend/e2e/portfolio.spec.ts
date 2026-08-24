import { expect, test } from '@playwright/test'

// Same throwaway-account pattern as auth.spec.ts — a unique email per run against
// whichever real backend/DB this suite happens to point at.
function uniqueEmail(): string {
  return `e2e-portfolio-${Date.now()}-${Math.floor(Math.random() * 1e6)}@playwright-e2e-mail.com`
}

test.describe('Portfolio building', () => {
  test('a user can register, build a two-asset portfolio, view its analysis, and record a holding', async ({
    page,
  }) => {
    const email = uniqueEmail()
    const password = 'TestSifre123'
    const portfolioName = `E2E Portföy ${Date.now()}`

    await page.goto('/portfolio')
    await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Şifre').fill(password)
    await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Portföy Analizi' })).toBeVisible({ timeout: 15_000 })

    // The portfolio-creation form and the holdings form (rendered further down the
    // same page once a portfolio is selected) both reuse the identical "Varlık seç"
    // asset-picker label — scope every lookup to its own <section> so they can't collide.
    const builderSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Yeni Portföy Oluştur', exact: true }) })

    // Two assets, not one — the correlation table only renders for 2+ constituents
    // (see CorrelationSection in PortfolioBuilder.tsx), and this flow is meant to
    // exercise it for real.
    await builderSection.getByLabel('Portföy adı').fill(portfolioName)
    const firstRow = builderSection.locator('.portfolio-row').first()
    await firstRow.getByLabel('Varlık seç', { exact: true }).selectOption('THYAO')
    await firstRow.getByLabel('THYAO ağırlığı (%)').fill('60')

    await builderSection.getByRole('button', { name: '+ Varlık ekle' }).click()
    const secondRow = builderSection.locator('.portfolio-row').nth(1)
    await secondRow.getByLabel('Varlık seç', { exact: true }).selectOption('ASELS')
    await secondRow.getByLabel('ASELS ağırlığı (%)').fill('40')

    await builderSection.getByRole('button', { name: 'Portföy Oluştur' }).click()

    // Creating a portfolio auto-selects it and loads its real analysis (correlation
    // matrix, benchmark overlay, ...) from the backend — real seeded THYAO/ASELS price
    // data, not a fixture.
    await expect(page.getByRole('heading', { name: `${portfolioName} — Performans` })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('.correlation-table')).toBeVisible()

    const holdingsSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Pozisyonlar', exact: true }) })
    await expect(holdingsSection).toBeVisible()
    await expect(holdingsSection.getByText('Bu portföy için henüz pozisyon eklenmedi.')).toBeVisible()

    await holdingsSection.getByLabel('Varlık seç', { exact: true }).selectOption('THYAO')
    await holdingsSection.getByLabel('Miktar').fill('10')
    await holdingsSection.getByLabel('Alım fiyatı').fill('250')
    await holdingsSection.getByLabel('Alım tarihi').fill('2025-01-15')
    await holdingsSection.getByRole('button', { name: '+ Pozisyon ekle' }).click()

    // The empty-state copy disappears and a real valued row (current price/value
    // resolved against seeded THYAO price history) takes its place.
    await expect(holdingsSection.getByText('Bu portföy için henüz pozisyon eklenmedi.')).toHaveCount(0)
    const holdingRow = holdingsSection.locator('table tbody tr').first()
    await expect(holdingRow).toContainText('THYAO')
    await expect(holdingRow).toContainText('10')
  })
})
