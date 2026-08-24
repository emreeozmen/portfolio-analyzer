import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mail, Lock, BarChart3, CandlestickChart, PieChart, TrendingUp, Loader2 } from 'lucide-react'
import * as api from './api'

interface LoginFormProps {
  onAuthenticated: (token: string) => void
}

const ASIDE_POINT_KEYS = ['point1', 'point2', 'point3'] as const
const ASIDE_POINT_ICONS = [BarChart3, CandlestickChart, PieChart] as const

function LoginForm({ onAuthenticated }: LoginFormProps) {
  const { t } = useTranslation('auth')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      if (mode === 'register') {
        const { access_token } = await api.register(email, password)
        onAuthenticated(access_token)
        return
      }
      const result = await api.login(email, password)
      if (result.requires_2fa && result.challenge_token) {
        setChallengeToken(result.challenge_token)
        return
      }
      if (result.access_token) onAuthenticated(result.access_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!challengeToken) return
    setIsSubmitting(true)
    try {
      const { access_token } = await api.verifyTwoFactor(challengeToken, twoFactorCode)
      onAuthenticated(access_token)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (challengeToken) {
    return (
      <div className="auth-page auth-page-single">
        <div className="panel login-panel">
          <div className="auth-brand">
            <span className="auth-brand-badge">
              <Lock size={20} />
            </span>
          </div>
          <h2>{t('login.twoFactorHeading')}</h2>
          <p className="muted">{t('login.twoFactorIntro')}</p>
          {error && <p className="error">{error}</p>}
          <form onSubmit={handleVerifyTwoFactor}>
            <label className="auth-input">
              <Lock size={16} />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t('login.twoFactorCodePlaceholder')}
                aria-label={t('login.twoFactorCodePlaceholder')}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={16} className="auth-spinner" /> : t('login.twoFactorVerifyButton')}
            </button>
          </form>
          <button
            type="button"
            className="btn-ghost auth-switch-link"
            onClick={() => {
              setChallengeToken(null)
              setTwoFactorCode('')
              setError(null)
            }}
          >
            {t('login.twoFactorBack')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-aside">
        <span className="auth-aside-eyebrow">{t('login.asideEyebrow')}</span>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>
        <ul className="auth-aside-points">
          {ASIDE_POINT_KEYS.map((key, i) => {
            const Icon = ASIDE_POINT_ICONS[i]
            return (
              <li key={key}>
                <span className="auth-aside-icon">
                  <Icon size={18} />
                </span>
                {t(`login.${key}`)}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="panel login-panel">
        <div className="auth-brand">
          <span className="auth-brand-badge">
            <TrendingUp size={20} />
          </span>
        </div>
        <h2>{mode === 'login' ? t('login.loginHeading') : t('login.registerHeading')}</h2>

        {error && <p className="error">{error}</p>}

        <form onSubmit={handleSubmit}>
          <label className="auth-input">
            <Mail size={16} />
            <input
              type="email"
              placeholder={t('login.email')}
              aria-label={t('login.email')}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="auth-input">
            <Lock size={16} />
            <input
              type="password"
              placeholder={t('login.password')}
              aria-label={t('login.password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {mode === 'register' && (
            <p className="muted" style={{ fontSize: 12.5, margin: '-4px 0 0' }}>
              {t('login.passwordHint')}
            </p>
          )}
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 size={16} className="auth-spinner" />
            ) : mode === 'login' ? (
              t('login.loginButton')
            ) : (
              t('login.registerButton')
            )}
          </button>
        </form>

        <button
          type="button"
          className="btn-ghost auth-switch-link"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t('login.switchToRegister') : t('login.switchToLogin')}
        </button>
      </div>
    </div>
  )
}

export default LoginForm
