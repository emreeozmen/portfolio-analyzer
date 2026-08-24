import { expect, test } from '@playwright/test'
import { registerAndLogin, uniqueEmail } from './fixtures'

test.describe('Notification preferences', () => {
  test('digest frequency persists across reload and survives the Alerts page email toggle', async ({ page }) => {
    const email = uniqueEmail('notifications')
    await registerAndLogin(page, email, 'TestSifre123')

    await page.goto('/hesap')
    const notificationsSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Bildirimler', exact: true }) })
    await expect(notificationsSection).toBeVisible()

    await notificationsSection.getByLabel('Portföy özet e-postası').selectOption('weekly')
    await notificationsSection.getByRole('button', { name: 'Kaydet', exact: true }).click()
    await expect(notificationsSection.getByText('Bildirim tercihleri güncellendi.')).toBeVisible()

    await page.reload()
    const reloadedSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Bildirimler', exact: true }) })
    await expect(reloadedSection.getByLabel('Portföy özet e-postası')).toHaveValue('weekly')

    // Toggling the email-alerts checkbox from the separate Alerts page must not
    // silently reset the digest frequency chosen above — this is the exact regression
    // this spec locks in (see Alerts.tsx: it must resend the user's current
    // digest_frequency alongside the toggle, not just email_alerts_enabled).
    await page.goto('/uyarilar')
    const emailToggle = page.getByLabel('Bir uyarı tetiklendiğinde e-posta ile de bildir')
    await expect(emailToggle).toBeChecked()
    await emailToggle.click()
    await expect(emailToggle).not.toBeChecked()

    await page.goto('/hesap')
    const finalSection = page
      .locator('section.panel')
      .filter({ has: page.getByRole('heading', { name: 'Bildirimler', exact: true }) })
    await expect(finalSection.getByLabel('Portföy özet e-postası')).toHaveValue('weekly')
  })
})
