import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Lock, CheckCircle2, MailWarning, Loader2 } from 'lucide-react'
import * as api from '../api'

type Status = 'form' | 'success' | 'error'

function ResetPasswordPage() {
  const { t } = useTranslation('auth')
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<Status>(token ? 'form' : 'error')
  const [errorDetail, setErrorDetail] = useState<string | null>(token ? null : t('resetPassword.missingToken'))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (newPassword !== confirmPassword) {
      setFormError(t('resetPassword.passwordMismatch'))
      return
    }
    if (!token) return
    setIsSubmitting(true)
    try {
      await api.resetPassword(token, newPassword)
      setStatus('success')
    } catch (err) {
      // The token is fixed by the URL this page was opened with — a failed reset
      // (an invalid/expired/already-used link) can't be retried by resubmitting the
      // same form, so this moves to the same terminal error screen a missing token
      // shows, rather than an inline banner suggesting a retry that can't succeed.
      setErrorDetail(err instanceof Error ? err.message : String(err))
      setStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-page auth-page-single">
      <div className="panel login-panel">
        <div className="auth-brand">
          <span className="auth-brand-badge">
            <Lock size={20} />
          </span>
        </div>

        {status === 'form' && (
          <>
            <h2>{t('resetPassword.heading')}</h2>
            <p className="muted">{t('resetPassword.intro')}</p>
            {formError && <p className="error">{formError}</p>}
            <form onSubmit={handleSubmit}>
              <label className="auth-input">
                <Lock size={16} />
                <input
                  type="password"
                  placeholder={t('resetPassword.newPassword')}
                  aria-label={t('resetPassword.newPassword')}
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
                  placeholder={t('resetPassword.newPasswordConfirm')}
                  aria-label={t('resetPassword.newPasswordConfirm')}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
              <p className="muted" style={{ fontSize: 12.5, margin: '-4px 0 0' }}>
                {t('login.passwordHint')}
              </p>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 size={16} className="auth-spinner" /> : t('resetPassword.button')}
              </button>
            </form>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="auth-brand-badge" style={{ color: 'var(--success)' }}>
              <CheckCircle2 size={20} />
            </div>
            <h2>{t('resetPassword.successHeading')}</h2>
            <p className="muted">{t('resetPassword.successBody')}</p>
            <Link to="/portfolio" className="btn-primary" style={{ marginTop: 8, display: 'inline-flex' }}>
              {t('resetPassword.successCta')}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="auth-brand-badge" style={{ color: 'var(--danger)' }}>
              <MailWarning size={20} />
            </div>
            <h2>{t('resetPassword.errorHeading')}</h2>
            <p className="muted">{errorDetail ?? t('resetPassword.errorFallback')}</p>
            <Link to="/portfolio" className="btn-primary" style={{ marginTop: 8, display: 'inline-flex' }}>
              {t('resetPassword.requestNewLink')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export default ResetPasswordPage
