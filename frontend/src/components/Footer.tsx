import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

function Footer() {
  const { t } = useTranslation('common')
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-top">
          <div className="site-footer-brand-col">
            <span className="site-footer-brand">{t('brand')}</span>
            <p className="site-footer-tagline">{t('footer.tagline')}</p>
          </div>

          <div className="site-footer-col">
            <h4>{t('footer.platformHeading')}</h4>
            <Link to="/market">{t('nav.market')}</Link>
            <Link to="/assets">{t('nav.assets')}</Link>
            <Link to="/portfolio">{t('nav.portfolio')}</Link>
            <Link to="/kripto">{t('nav.crypto')}</Link>
            <Link to="/enflasyon">{t('nav.inflation')}</Link>
          </div>

          <div className="site-footer-col">
            <h4>{t('footer.resourcesHeading')}</h4>
            <span>{t('footer.dataSource')}</span>
            <span>{t('footer.updateFrequency')}</span>
            <span>{t('footer.liveNote')}</span>
          </div>
        </div>

        <div className="site-footer-bottom">
          <span className="site-footer-disclaimer">{t('footer.disclaimer')}</span>
          <span className="site-footer-meta">{t('footer.meta', { year })}</span>
        </div>
      </div>
    </footer>
  )
}

export default Footer
