import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'

function NotFound() {
  const { t } = useTranslation('common')
  return (
    <div className="error-boundary">
      <div className="error-boundary-card">
        <div className="error-boundary-icon">
          <Compass size={26} />
        </div>
        <div className="detail-header-eyebrow mono" style={{ marginBottom: 8 }}>
          404
        </div>
        <h1>{t('notFound.title')}</h1>
        <p className="muted">{t('notFound.body')}</p>
        <Link to="/" className="btn-primary" style={{ marginTop: 8, display: 'inline-flex' }}>
          {t('notFound.backHome')}
        </Link>
      </div>
    </div>
  )
}

export default NotFound
