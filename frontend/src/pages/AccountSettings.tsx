import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Mail, UserCog } from 'lucide-react'
import {
  changeEmail,
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  getActivity,
  getCurrentUser,
  getSessions,
  resendVerificationEmail,
  revokeAllOtherSessions,
  revokeSession,
  setupTwoFactor,
  updateCurrency,
  updateNotificationPreferences,
  type AuditLogEntry,
  type CurrentUser,
  type DigestFrequency,
  type TwoFactorSetup,
  type UserSession,
} from '../api'
import PageHeader from '../components/PageHeader'
import { currentLocale } from '../lib/locale'
import { getPushStatus, subscribeToPush, unsubscribeFromPush, type PushStatus } from '../lib/push'

function PasswordSection() {
  const { t } = useTranslation('auth')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmPassword) {
      setError(t('account.passwordMismatch'))
      return
    }
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.changePasswordTitle')}</h2>
      {error && <p className="error">{error}</p>}
      {success && <p className="text-up">{t('account.passwordUpdated')}</p>}
      <form onSubmit={handleSubmit} className="account-settings-form">
        <label className="auth-input">
          <Lock size={16} />
          <input
            type="password"
            placeholder={t('account.currentPassword')}
            aria-label={t('account.currentPassword')}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="auth-input">
          <Lock size={16} />
          <input
            type="password"
            placeholder={t('account.newPassword')}
            aria-label={t('account.newPassword')}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <label className="auth-input">
          <Lock size={16} />
          <input
            type="password"
            placeholder={t('account.newPasswordConfirm')}
            aria-label={t('account.newPasswordConfirmAria')}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <p className="muted" style={{ fontSize: 12.5, margin: '-4px 0 0' }}>
          {t('account.passwordHint')}
        </p>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? t('account.saving') : t('account.updatePassword')}
        </button>
      </form>
    </section>
  )
}

function EmailSection({ user, onUserChanged }: { user: CurrentUser; onUserChanged: (u: CurrentUser) => void }) {
  const { t } = useTranslation('auth')
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSubmitting(true)
    try {
      const updated = await changeEmail(newEmail, currentPassword)
      onUserChanged(updated)
      setSuccess(true)
      setNewEmail('')
      setCurrentPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async () => {
    setResendState('sending')
    try {
      await resendVerificationEmail()
      setResendState('sent')
    } catch {
      setResendState('error')
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.changeEmailTitle')}</h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t('account.registeredEmail', { email: user.email })}
      </p>
      {user.email_verified ? (
        <p className="text-up" style={{ fontSize: 13, marginBottom: 18 }}>
          ✓ E-posta adresi doğrulanmış
        </p>
      ) : (
        <div style={{ marginBottom: 18 }}>
          <p className="error" style={{ fontSize: 13, marginBottom: 6 }}>
            E-posta adresi henüz doğrulanmamış
          </p>
          {resendState === 'sent' ? (
            <p className="text-up" style={{ fontSize: 13 }}>
              Doğrulama e-postası gönderildi.
            </p>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={handleResend}
              disabled={resendState === 'sending'}
            >
              {resendState === 'sending' ? t('account.saving') : 'Doğrulama e-postasını yeniden gönder'}
            </button>
          )}
          {resendState === 'error' && <p className="error" style={{ fontSize: 13, marginTop: 6 }}>Gönderilemedi, tekrar deneyin.</p>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {success && <p className="text-up">{t('account.emailUpdated')}</p>}
      <form onSubmit={handleSubmit} className="account-settings-form">
        <label className="auth-input">
          <Mail size={16} />
          <input
            type="email"
            placeholder={t('account.newEmail')}
            aria-label={t('account.newEmail')}
            autoComplete="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </label>
        <label className="auth-input">
          <Lock size={16} />
          <input
            type="password"
            placeholder={t('account.confirmPassword')}
            aria-label={t('account.confirmPassword')}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? t('account.saving') : t('account.updateEmail')}
        </button>
      </form>
    </section>
  )
}

const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP']

function CurrencySection({ user, onUserChanged }: { user: CurrentUser; onUserChanged: (u: CurrentUser) => void }) {
  const { t } = useTranslation('auth')
  const [value, setValue] = useState(user.base_currency)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSubmitting(true)
    try {
      const updated = await updateCurrency(value)
      onUserChanged(updated)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.currencyTitle')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('account.currencyIntro')}
      </p>
      {error && <p className="error">{error}</p>}
      {success && <p className="text-up">{t('account.currencyUpdated')}</p>}
      <form onSubmit={handleSubmit} className="portfolio-row">
        <select value={value} onChange={(e) => setValue(e.target.value)} aria-label={t('account.currencyTitle')}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={submitting || value === user.base_currency}>
          {submitting ? t('account.saving') : t('account.currencySave')}
        </button>
      </form>
    </section>
  )
}

const DIGEST_FREQUENCIES: { value: DigestFrequency; labelKey: string }[] = [
  { value: 'off', labelKey: 'account.digestOff' },
  { value: 'weekly', labelKey: 'account.digestWeekly' },
  { value: 'monthly', labelKey: 'account.digestMonthly' },
]

const PUSH_STATUS_LABEL_KEYS: Record<PushStatus, string> = {
  unsupported: 'account.pushUnsupported',
  unconfigured: 'account.pushUnconfigured',
  denied: 'account.pushDenied',
  subscribed: 'account.pushSubscribed',
  'not-subscribed': 'account.pushNotSubscribed',
}

function PushNotificationsControl() {
  const { t } = useTranslation('auth')
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getPushStatus()
      .then(setStatus)
      .catch(() => setStatus('unsupported'))
  }, [])

  const handleToggle = async () => {
    setError(null)
    setBusy(true)
    try {
      const next = status === 'subscribed' ? await unsubscribeFromPush() : await subscribeToPush()
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === null) return null

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
      <p style={{ marginBottom: 8 }}>{t('account.pushTitle')}</p>
      {error && <p className="error">{error}</p>}
      <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{t(PUSH_STATUS_LABEL_KEYS[status])}</p>
      {(status === 'subscribed' || status === 'not-subscribed') && (
        <button type="button" className="btn-secondary" onClick={handleToggle} disabled={busy}>
          {busy ? t('account.saving') : status === 'subscribed' ? t('account.pushDisable') : t('account.pushEnable')}
        </button>
      )}
    </div>
  )
}

function NotificationsSection({ user, onUserChanged }: { user: CurrentUser; onUserChanged: (u: CurrentUser) => void }) {
  const { t } = useTranslation('auth')
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(user.email_alerts_enabled)
  const [digestFrequency, setDigestFrequency] = useState<DigestFrequency>(user.digest_frequency)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = emailAlertsEnabled !== user.email_alerts_enabled || digestFrequency !== user.digest_frequency

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setSubmitting(true)
    try {
      const updated = await updateNotificationPreferences(emailAlertsEnabled, digestFrequency)
      onUserChanged(updated)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.notificationsTitle')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('account.notificationsIntro')}
      </p>
      {error && <p className="error">{error}</p>}
      {success && <p className="text-up">{t('account.notificationsUpdated')}</p>}
      <form onSubmit={handleSubmit} className="account-settings-form">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={emailAlertsEnabled}
            onChange={(e) => setEmailAlertsEnabled(e.target.checked)}
          />
          <span>{t('account.emailAlertsLabel')}</span>
        </label>
        <label className="muted" style={{ fontSize: 13 }} htmlFor="digest-frequency">
          {t('account.digestFrequencyLabel')}
        </label>
        <select
          id="digest-frequency"
          value={digestFrequency}
          onChange={(e) => setDigestFrequency(e.target.value as DigestFrequency)}
        >
          {DIGEST_FREQUENCIES.map((d) => (
            <option key={d.value} value={d.value}>
              {t(d.labelKey)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={submitting || !dirty}>
          {submitting ? t('account.saving') : t('account.notificationsSave')}
        </button>
      </form>
      <PushNotificationsControl />
    </section>
  )
}

function TwoFactorSection({ user, onUserChanged }: { user: CurrentUser; onUserChanged: (u: CurrentUser) => void }) {
  const { t } = useTranslation('auth')
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null)
  const [code, setCode] = useState('')
  const [showDisableForm, setShowDisableForm] = useState(false)
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const startSetup = async () => {
    setError(null)
    setSuccess(null)
    try {
      setSetup(await setupTwoFactor())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const confirmEnable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await enableTwoFactor(code)
      setSetup(null)
      setCode('')
      setSuccess(t('account.twoFactorEnabledSuccess'))
      onUserChanged({ ...user, totp_enabled: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const submitDisable = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await disableTwoFactor(disablePassword, disableCode)
      setShowDisableForm(false)
      setDisablePassword('')
      setDisableCode('')
      setSuccess(t('account.twoFactorDisabledSuccess'))
      onUserChanged({ ...user, totp_enabled: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.twoFactorTitle')}</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        {t('account.twoFactorIntro')}
      </p>
      {error && <p className="error">{error}</p>}
      {success && <p className="text-up">{success}</p>}

      <p style={{ marginBottom: 14 }}>
        <span className={user.totp_enabled ? 'text-up' : 'muted'}>
          {user.totp_enabled ? t('account.twoFactorEnabledStatus') : t('account.twoFactorDisabledStatus')}
        </span>
      </p>

      {!user.totp_enabled && !setup && (
        <button type="button" className="btn-primary" onClick={startSetup}>
          {t('account.twoFactorSetupButton')}
        </button>
      )}

      {setup && (
        <div>
          <p className="muted" style={{ marginBottom: 10 }}>
            {t('account.twoFactorScanHint')}
          </p>
          <img
            src={setup.qr_code_data_uri}
            alt=""
            width={180}
            height={180}
            style={{ borderRadius: 8, marginBottom: 10, display: 'block' }}
          />
          <p className="mono" style={{ marginBottom: 14, wordBreak: 'break-all' }}>
            {setup.secret}
          </p>
          <form onSubmit={confirmEnable} className="portfolio-row">
            <input
              type="text"
              inputMode="numeric"
              placeholder={t('account.twoFactorCodeLabel')}
              aria-label={t('account.twoFactorCodeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? t('account.saving') : t('account.twoFactorConfirmButton')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSetup(null)
                setCode('')
                setError(null)
              }}
            >
              {t('account.twoFactorCancelButton')}
            </button>
          </form>
        </div>
      )}

      {user.totp_enabled && !showDisableForm && (
        <button type="button" className="btn-ghost weight-warn" onClick={() => setShowDisableForm(true)}>
          {t('account.twoFactorDisableButton')}
        </button>
      )}

      {user.totp_enabled && showDisableForm && (
        <form onSubmit={submitDisable} className="portfolio-row">
          <input
            type="password"
            placeholder={t('account.twoFactorDisablePasswordLabel')}
            aria-label={t('account.twoFactorDisablePasswordLabel')}
            autoComplete="current-password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            required
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder={t('account.twoFactorDisableCodeLabel')}
            aria-label={t('account.twoFactorDisableCodeLabel')}
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            required
          />
          <button type="submit" className="btn-primary weight-warn" disabled={submitting}>
            {submitting ? t('account.saving') : t('account.twoFactorDisableButton')}
          </button>
          <button type="button" className="btn-ghost" onClick={() => setShowDisableForm(false)}>
            {t('account.twoFactorCancelButton')}
          </button>
        </form>
      )}
    </section>
  )
}

function SessionsSection() {
  const { t } = useTranslation('auth')
  const [sessions, setSessions] = useState<UserSession[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    getSessions()
      .then(setSessions)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRevoke = async (id: number) => {
    setError(null)
    try {
      await revokeSession(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRevokeAllOthers = async () => {
    setError(null)
    try {
      await revokeAllOtherSessions()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="panel">
      <h2>{t('account.sessionsTitle')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('account.sessionsIntro')}
      </p>
      {error && <p className="error">{error}</p>}
      {!loading && sessions.length > 1 && (
        <button
          type="button"
          className="btn-ghost weight-warn"
          style={{ marginBottom: 14 }}
          onClick={handleRevokeAllOthers}
        >
          {t('account.sessionRevokeAllOthers')}
        </button>
      )}
      {!loading && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sessions.map((s) => (
            <li
              key={s.id}
              className="portfolio-row"
              style={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <div>
                  {s.user_agent || t('account.sessionUnknownDevice')}
                  {s.is_current && (
                    <span className="text-up" style={{ marginLeft: 8, fontSize: 12 }}>
                      {t('account.sessionCurrentBadge')}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {s.ip_address}
                  {' · '}
                  {t('account.sessionLastSeen', { time: new Date(s.last_seen_at).toLocaleString(currentLocale()) })}
                </div>
              </div>
              {!s.is_current && (
                <button type="button" className="btn-ghost" onClick={() => handleRevoke(s.id)}>
                  {t('account.sessionRevoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const ACTIVITY_LABELS: Record<string, { tr: string; en: string }> = {
  'portfolio.create': { tr: 'Portföy oluşturuldu', en: 'Portfolio created' },
  'portfolio.update': { tr: 'Portföy güncellendi', en: 'Portfolio updated' },
  'portfolio.delete': { tr: 'Portföy silindi', en: 'Portfolio deleted' },
  'portfolio.share_enable': { tr: 'Portföy paylaşımı açıldı', en: 'Portfolio sharing enabled' },
  'portfolio.share_disable': { tr: 'Portföy paylaşımı kapatıldı', en: 'Portfolio sharing disabled' },
  'holding.create': { tr: 'Pozisyon eklendi', en: 'Position added' },
  'holding.update': { tr: 'Pozisyon güncellendi', en: 'Position updated' },
  'holding.delete': { tr: 'Pozisyon silindi', en: 'Position deleted' },
  'holding.sell': { tr: 'Satış kaydedildi', en: 'Sale recorded' },
  'password.change': { tr: 'Şifre değiştirildi', en: 'Password changed' },
  'email.change': { tr: 'E-posta değiştirildi', en: 'Email changed' },
  '2fa.enable': { tr: 'İki adımlı doğrulama etkinleştirildi', en: 'Two-factor authentication enabled' },
  '2fa.disable': { tr: 'İki adımlı doğrulama devre dışı bırakıldı', en: 'Two-factor authentication disabled' },
  'session.revoke': { tr: 'Oturum kapatıldı', en: 'Session signed out' },
  'session.revoke_all_others': { tr: 'Diğer oturumlar kapatıldı', en: 'Other sessions signed out' },
}

function ActivitySection() {
  const { t, i18n } = useTranslation('auth')
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const lang = i18n.language === 'en' ? 'en' : 'tr'

  useEffect(() => {
    getActivity()
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const labelFor = (action: string) => ACTIVITY_LABELS[action]?.[lang] ?? action

  return (
    <section className="panel">
      <h2>{t('account.activityTitle')}</h2>
      {error && <p className="error">{error}</p>}
      {!loading && entries.length === 0 && <p className="muted">{t('account.activityEmpty')}</p>}
      {!loading && entries.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((entry) => (
            <li key={entry.id} className="portfolio-row" style={{ justifyContent: 'space-between' }}>
              <span>
                {labelFor(entry.action)}
                {entry.detail && <span className="muted"> — {entry.detail}</span>}
              </span>
              <span className="muted mono" style={{ fontSize: 12.5 }}>
                {new Date(entry.created_at).toLocaleString(currentLocale())}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AccountSettingsPage() {
  const { t } = useTranslation('auth')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="account-settings-page">
      <PageHeader icon={UserCog} title={t('account.title')} subtitle={t('account.subtitle')} />
      {error && <p className="error">{error}</p>}
      {user && (
        <>
          <EmailSection user={user} onUserChanged={setUser} />
          <PasswordSection />
          <TwoFactorSection user={user} onUserChanged={setUser} />
          <SessionsSection />
          <CurrencySection user={user} onUserChanged={setUser} />
          <NotificationsSection user={user} onUserChanged={setUser} />
          <ActivitySection />
        </>
      )}
    </div>
  )
}

export default AccountSettingsPage
