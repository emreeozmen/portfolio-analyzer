import crypto from 'node:crypto'
import { expect, test } from '@playwright/test'

// Same throwaway-account pattern as the other e2e specs.
function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@playwright-e2e-mail.com`
}

// A minimal RFC 4648 base32 decoder + RFC 6238 TOTP generator, written directly
// against Node's built-in crypto rather than adding a runtime dependency just for
// this one test file — mirrors exactly what services/auth_service.verify_totp()
// (pyotp) checks server-side.
function base32Decode(base32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of base32.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function generateTotp(secret: string, timeStepSeconds = 30, digits = 6): string {
  const key = base32Decode(secret)
  const counter = Math.floor(Date.now() / 1000 / timeStepSeconds)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  return (binCode % 10 ** digits).toString().padStart(digits, '0')
}

async function registerAndLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/portfolio')
  await page.getByRole('button', { name: 'Hesabın yok mu? Kayıt ol' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Şifre').fill(password)
  await page.getByRole('button', { name: 'Kayıt ol', exact: true }).click()
  // Not "Portföy Analizi" — that heading text also appears on the logged-out
  // LoginForm's own marketing aside (Playwright's role-name matching is substring,
  // case-insensitive by default), so it's already true before registration even
  // completes and doesn't actually wait for auth. "Yeni Portföy Oluştur" only ever
  // renders once PortfolioBuilderPage mounts with a real token — this is what
  // subsequent page.goto() calls in these tests need to be safe from the race
  // between the async register() call resolving and localStorage being written.
  await expect(page.getByRole('heading', { name: 'Yeni Portföy Oluştur' })).toBeVisible({ timeout: 15_000 })
}

test.describe('Security features', () => {
  test('2FA can be set up, gates the next login, and can be disabled again', async ({ page }) => {
    const email = uniqueEmail('2fa')
    const password = 'TestSifre123'
    await registerAndLogin(page, email, password)

    await page.goto('/hesap')
    await page.getByRole('button', { name: 'Etkinleştir' }).click()

    const secretLocator = page.locator('p.mono').filter({ hasText: /^[A-Z2-7]{10,}$/ })
    await expect(secretLocator).toBeVisible()
    const secret = (await secretLocator.textContent())?.trim() ?? ''
    expect(secret.length).toBeGreaterThan(10)

    await page.getByLabel('Doğrulama kodu').fill(generateTotp(secret))
    await page.getByRole('button', { name: 'Onayla ve Etkinleştir' }).click()
    await expect(page.getByText('İki adımlı doğrulama etkinleştirildi.')).toBeVisible()

    // Logging back in now requires the 2FA step.
    await page.getByRole('button', { name: 'Çıkış yap' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Şifre').fill(password)
    await page.getByRole('button', { name: 'Giriş yap', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'İki Adımlı Doğrulama', exact: true })).toBeVisible()

    await page.getByLabel('Doğrulama kodu').fill(generateTotp(secret))
    await page.getByRole('button', { name: 'Doğrula' }).click()
    // Verifying just flips `token` from null to a real value — since this is all
    // client-side routing keyed off that one variable, the app re-renders whatever
    // route the browser's URL bar already says (still /hesap, from the goto()
    // above), it doesn't separately navigate anywhere. So we're back on Hesap
    // Ayarları already, right where the next step (disabling 2FA) needs to be.
    await expect(page.getByRole('heading', { name: 'Hesap Ayarları' })).toBeVisible({ timeout: 15_000 })

    // Disabling requires both the password and a fresh code.
    await page.getByRole('button', { name: 'Devre Dışı Bırak' }).click()
    await page.getByLabel('Şifre', { exact: true }).fill(password)
    await page.getByLabel('Doğrulama kodu').fill(generateTotp(secret))
    await page.getByRole('button', { name: 'Devre Dışı Bırak' }).last().click()
    await expect(page.getByText('İki adımlı doğrulama devre dışı bırakıldı.')).toBeVisible()
  })

  test('active sessions list shows the current device', async ({ page }) => {
    const email = uniqueEmail('sessions')
    const password = 'TestSifre123'
    await registerAndLogin(page, email, password)

    await page.goto('/hesap')
    await expect(page.getByText('Bu cihaz')).toBeVisible()
  })

  test('a shared portfolio link is viewable without authentication', async ({ page, context }) => {
    const email = uniqueEmail('share')
    const password = 'TestSifre123'
    await registerAndLogin(page, email, password)

    const portfolioName = `E2E Paylaşım ${Date.now()}`
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

    const listSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Portföylerim', exact: true }) })
    await listSection.getByRole('button', { name: 'Paylaş', exact: true }).click()
    await expect(listSection.getByRole('button', { name: 'Bağlantıyı Kopyala' })).toBeVisible()

    const shareToken = await page.evaluate(async (name) => {
      const token = localStorage.getItem('pa_token')
      const list: { id: number; name: string }[] = await fetch('http://localhost:8000/portfolios', {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())
      const found = list.find((p) => p.name === name)
      if (!found) return null
      const detail: { share_token: string | null } = await fetch(`http://localhost:8000/portfolios/${found.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())
      return detail.share_token
    }, portfolioName)

    expect(shareToken).toBeTruthy()

    const publicPage = await context.newPage()
    await publicPage.goto(`/paylasilan/${shareToken}`)
    await expect(publicPage.getByRole('heading', { name: portfolioName })).toBeVisible({ timeout: 15_000 })
    await expect(publicPage.getByText('salt-okunur', { exact: false }).first()).toBeVisible()
    await publicPage.close()
  })
})
