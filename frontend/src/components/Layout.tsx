import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, X } from 'lucide-react'
import SymbolSearch from './SymbolSearch'
import NotificationBell from './NotificationBell'
import Footer from './Footer'
import { useTheme } from '../lib/ThemeContext'
import { useLanguage } from '../lib/LanguageContext'
import { prefetchRoute } from '../lib/routePrefetch'

interface LayoutProps {
  isAuthenticated: boolean
  onLogout: () => void
  children: ReactNode
}

function Layout({ isAuthenticated, onLogout, children }: LayoutProps) {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const { language, toggleLanguage } = useLanguage()
  const { t } = useTranslation('common')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isActive = (path: string) => {
    const matches = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
    return matches ? 'nav-link active' : 'nav-link'
  }

  // A route change is the natural signal to close the mobile menu — it just did its job.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileNavOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-to-content">
        {t('skipToContent')}
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          {t('brand')}
        </Link>
        <button
          type="button"
          className="btn-ghost mobile-nav-toggle"
          onClick={() => setMobileNavOpen((open) => !open)}
          aria-label={mobileNavOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={mobileNavOpen ? 'is-open' : ''}>
          <Link to="/" className={isActive('/')}>
            {t('nav.home')}
          </Link>
          <Link to="/market" className={isActive('/market')} onMouseEnter={() => prefetchRoute('/market')}>
            {t('nav.market')}
          </Link>
          <Link to="/assets" className={isActive('/assets')} onMouseEnter={() => prefetchRoute('/assets')}>
            {t('nav.assets')}
          </Link>
          <Link to="/portfolio" className={isActive('/portfolio')} onMouseEnter={() => prefetchRoute('/portfolio')}>
            {t('nav.portfolio')}
          </Link>
          <Link to="/kripto" className={isActive('/kripto')} onMouseEnter={() => prefetchRoute('/kripto')}>
            {t('nav.crypto')}
          </Link>
          <Link to="/enflasyon" className={isActive('/enflasyon')} onMouseEnter={() => prefetchRoute('/enflasyon')}>
            {t('nav.inflation')}
          </Link>
        </nav>
        <SymbolSearch />
        <div className="topbar-actions">
          <button
            type="button"
            className="btn-ghost lang-toggle"
            onClick={toggleLanguage}
            aria-label={language === 'tr' ? t('language.switchToEnglish') : t('language.switchToTurkish')}
            title={language === 'tr' ? t('language.switchToEnglish') : t('language.switchToTurkish')}
          >
            {language === 'tr' ? 'EN' : 'TR'}
          </button>
          <button
            type="button"
            className="btn-ghost theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
            title={theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark')}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {isAuthenticated && (
            <>
              <NotificationBell />
              <Link to="/hesap" className={isActive('/hesap')} onMouseEnter={() => prefetchRoute('/hesap')}>
                {t('nav.account')}
              </Link>
              <button type="button" className="btn-ghost" onClick={onLogout}>
                {t('nav.logout')}
              </button>
            </>
          )}
        </div>
      </header>
      <main className="content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  )
}

export default Layout
