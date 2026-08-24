import { expect, test } from '@playwright/test'

// Registers a fresh throwaway account per run (unique email per test run) rather than
// depending on a fixture user that might not exist in whichever database this suite
// runs against — this project's backend has no test-seed-user convention yet.
// Not @example.com/.test/.invalid — those are RFC 2606 reserved names that Pydantic's
// EmailStr (via email-validator) rejects at the syntax level even with deliverability
// checking off, which is exactly the "silent failure" this suite would otherwise miss.
function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@playwright-e2e-mail.com`
}

test.describe('Authentication', () => {
  test('a new user can register, land on Portföy Analizi, and log out', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'TestSifre123'

    await page.goto('/portfolio')
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible()

    await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click()
    await expect(page.getByRole('heading', { name: 'Kayıt ol' })).toBeVisible()

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Şifre').fill(password)
    await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Portföy Analizi' })).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Çıkış yap' }).click()
    await expect(page.getByRole('heading', { name: 'Giriş yap' })).toBeVisible()
  })

  test('logging in with a wrong password shows a real error, not a silent failure', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'TestSifre123'

    // Register the account first so there's something real to fail against.
    await page.goto('/portfolio')
    await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Şifre').fill(password)
    await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Portföy Analizi' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Çıkış yap' }).click()

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Şifre').fill('YanlisSifre999')
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click()

    await expect(page.locator('.error')).toBeVisible()
  })
})
