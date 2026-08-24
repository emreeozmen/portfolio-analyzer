import { expect, type Page } from '@playwright/test'

/** Same throwaway-account pattern as every other e2e spec — a unique email per test
 * run against whichever real backend/DB this suite happens to point at. `prefix`
 * keeps concurrently-running specs (this suite runs `fullyParallel`) from ever
 * colliding on the same address. */
export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@playwright-e2e-mail.com`
}

/** Registers a fresh account and waits for a heading that's genuinely gated on auth.
 * Deliberately waits on "Yeni Portföy Oluştur" rather than "Portföy Analizi" — the
 * latter also appears on the logged-out LoginForm's own marketing aside (Playwright's
 * role-name matching is substring/case-insensitive by default), so waiting on it
 * races the actual login instead of confirming it. */
export async function registerAndLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/portfolio')
  await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Şifre').fill(password)
  await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Yeni Portföy Oluştur' })).toBeVisible({ timeout: 15_000 })
}
