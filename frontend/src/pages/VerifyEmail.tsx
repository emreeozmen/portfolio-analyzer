import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MailWarning, Loader2 } from 'lucide-react'
import { verifyEmail } from '../api'

type Status = 'verifying' | 'success' | 'error'

function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<Status>('verifying')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setError('Bağlantıda doğrulama kodu bulunamadı.')
      return
    }
    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
    // Only ever runs once per mount — re-running on searchParams identity churn would
    // needlessly re-POST the same single-use token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="error-boundary">
      <div className="error-boundary-card">
        {status === 'verifying' && (
          <>
            <div className="error-boundary-icon">
              <Loader2 size={26} className="auth-spinner" />
            </div>
            <h1>Doğrulanıyor…</h1>
            <p className="muted">E-posta adresiniz doğrulanıyor, lütfen bekleyin.</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="error-boundary-icon" style={{ color: 'var(--success)' }}>
              <CheckCircle2 size={26} />
            </div>
            <h1>E-posta doğrulandı</h1>
            <p className="muted">E-posta adresiniz başarıyla doğrulandı.</p>
            <Link to="/hesap" className="btn-primary" style={{ marginTop: 8, display: 'inline-flex' }}>
              Hesap Ayarlarına Dön
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="error-boundary-icon error-boundary-icon-danger">
              <MailWarning size={26} />
            </div>
            <h1>Doğrulama başarısız</h1>
            <p className="muted">{error ?? 'Bu bağlantı geçersiz veya süresi dolmuş olabilir.'}</p>
            <Link to="/hesap" className="btn-primary" style={{ marginTop: 8, display: 'inline-flex' }}>
              Hesap Ayarlarından Yeniden Gönder
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

export default VerifyEmailPage
