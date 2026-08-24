import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { registerAndLogin, uniqueEmail } from './fixtures'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEIGHTS_CSV = path.join(__dirname, 'fixtures', 'portfolio-weights.csv')
const HOLDINGS_CSV = path.join(__dirname, 'fixtures', 'holdings.csv')

test.describe('CSV import', () => {
  test('a portfolio-weights CSV fills the builder form via a preview step', async ({ page }) => {
    const email = uniqueEmail('csv-weights')
    await registerAndLogin(page, email, 'TestSifre123')

    const builderSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Yeni Portföy Oluştur', exact: true }) })

    await builderSection.getByLabel('CSV ile Yükle').setInputFiles(WEIGHTS_CSV)

    // The preview table shows the parsed rows before anything is written to the form.
    await expect(builderSection.getByRole('cell', { name: 'THYAO', exact: true })).toBeVisible()
    await expect(builderSection.getByRole('cell', { name: 'ASELS', exact: true })).toBeVisible()

    await builderSection.getByRole('button', { name: 'Uygula', exact: true }).click()

    await expect(builderSection.getByLabel('THYAO ağırlığı (%)')).toHaveValue('60')
    await expect(builderSection.getByLabel('ASELS ağırlığı (%)')).toHaveValue('40')
  })

  test('a holdings CSV shows a preview before the position is actually committed', async ({ page }) => {
    const email = uniqueEmail('csv-holdings')
    const password = 'TestSifre123'
    const portfolioName = `E2E CSV Portföy ${Date.now()}`
    await registerAndLogin(page, email, password)

    const builderSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Yeni Portföy Oluştur', exact: true }) })
    await builderSection.getByLabel('Portföy adı').fill(portfolioName)
    await builderSection.getByLabel('Varlık seç', { exact: true }).selectOption('THYAO')
    await builderSection.getByLabel('THYAO ağırlığı (%)').fill('100')
    await builderSection.getByRole('button', { name: 'Portföy Oluştur' }).click()
    await expect(page.getByRole('heading', { name: `${portfolioName} — Performans` })).toBeVisible({
      timeout: 20_000,
    })

    const holdingsSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Pozisyonlar', exact: true }) })
    await expect(holdingsSection).toBeVisible()

    await holdingsSection.getByLabel('CSV ile İçe Aktar').setInputFiles(HOLDINGS_CSV)

    // Preview appears first — nothing committed yet, the empty-state copy is still there.
    await expect(holdingsSection.getByRole('cell', { name: 'THYAO', exact: true })).toBeVisible()
    await expect(holdingsSection.getByText('Bu portföy için henüz pozisyon eklenmedi.')).toBeVisible()

    await holdingsSection.getByRole('button', { name: /pozisyonu içe aktar/ }).click()

    // Confirming actually commits it — the empty-state copy is gone and a real, valued
    // row (current price resolved against seeded THYAO price history) takes its place.
    await expect(holdingsSection.getByText('Bu portföy için henüz pozisyon eklenmedi.')).toHaveCount(0)
    const holdingRow = holdingsSection.locator('table tbody tr').first()
    await expect(holdingRow).toContainText('THYAO')
    await expect(holdingRow).toContainText('10')
  })
})
