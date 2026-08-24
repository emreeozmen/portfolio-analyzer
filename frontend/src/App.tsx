import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import LoginForm from './LoginForm'
import Home from './pages/Home'
import NotFound from './pages/NotFound'
import { clearToken, getToken, setToken } from './auth'
import { LiveDataProvider } from './lib/LiveDataContext'
import './App.css'

// Code-split the heavier routes (Chart.js, the candlestick canvas, the
// Tailwind/framer-motion market dashboard) out of the initial bundle — they
// only need to load once the user actually navigates to that page.
const AssetScreenerPage = lazy(() => import('./pages/AssetScreener'))
const AssetDetailPage = lazy(() => import('./pages/AssetDetail'))
const AssetComparePage = lazy(() => import('./pages/AssetCompare'))
const PortfolioBuilderPage = lazy(() => import('./pages/PortfolioBuilder'))
const MarketDashboardPage = lazy(() => import('./pages/MarketDashboard'))
const CryptoLeaderboardPage = lazy(() => import('./pages/CryptoLeaderboard'))
const InflationMapPage = lazy(() => import('./pages/InflationMap'))
const AccountSettingsPage = lazy(() => import('./pages/AccountSettings'))
const AlertsPage = lazy(() => import('./pages/Alerts'))
const DividendCalendarPage = lazy(() => import('./pages/DividendCalendar'))
const TaxReportPage = lazy(() => import('./pages/TaxReport'))
const PublicPortfolioPage = lazy(() => import('./pages/PublicPortfolio'))

function RouteFallback() {
  const { t } = useTranslation('common')
  return <p className="muted">{t('actions.loading')}</p>
}

function AppRoutes({ token, onAuthenticated }: { token: string | null; onAuthenticated: (token: string) => void }) {
  // Keyed on pathname (not full location, so query-string-only changes like
  // /karsilastir?tickers=... don't replay the fade) so each real page navigation
  // remounts this subtree and re-triggers the .page-transition CSS animation —
  // this sits inside ErrorBoundary/Suspense rather than wrapping them, so an
  // error boundary's state still doesn't reset just because a route changes.
  const location = useLocation()

  // React Router doesn't reset scroll position or focus on navigation (unlike a
  // full page load) — without this, clicking a link while scrolled down on one
  // page lands you at the same scroll depth on the next, and a screen-reader user
  // gets no cue a new page even loaded. main-content already carries tabIndex={-1}
  // (Layout.tsx) specifically so it can receive focus here without joining the tab order.
  useEffect(() => {
    window.scrollTo(0, 0)
    document.getElementById('main-content')?.focus()
  }, [location.pathname])

  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <div key={location.pathname} className="page-transition">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/market" element={<MarketDashboardPage />} />
            <Route path="/assets" element={<AssetScreenerPage />} />
            <Route path="/karsilastir" element={<AssetComparePage />} />
            <Route path="/assets/:ticker" element={<AssetDetailPage />} />
            <Route path="/kripto" element={<CryptoLeaderboardPage />} />
            <Route path="/enflasyon" element={<InflationMapPage />} />
            <Route
              path="/portfolio"
              element={token ? <PortfolioBuilderPage /> : <LoginForm onAuthenticated={onAuthenticated} />}
            />
            <Route
              path="/hesap"
              element={token ? <AccountSettingsPage /> : <LoginForm onAuthenticated={onAuthenticated} />}
            />
            <Route
              path="/uyarilar"
              element={token ? <AlertsPage /> : <LoginForm onAuthenticated={onAuthenticated} />}
            />
            <Route
              path="/temettuler"
              element={token ? <DividendCalendarPage /> : <LoginForm onAuthenticated={onAuthenticated} />}
            />
            <Route
              path="/vergi-raporu"
              element={token ? <TaxReportPage /> : <LoginForm onAuthenticated={onAuthenticated} />}
            />
            <Route path="/paylasilan/:token" element={<PublicPortfolioPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken())

  const handleAuthenticated = (newToken: string) => {
    setToken(newToken)
    setTokenState(newToken)
  }

  const handleLogout = () => {
    clearToken()
    setTokenState(null)
  }

  return (
    <BrowserRouter>
      {/* Remounted (key={token}) on login/logout so the shared WebSocket reconnects
          with (or without) the auth token — see LiveDataContext.tsx. */}
      <LiveDataProvider key={token ?? 'anon'}>
        <Layout isAuthenticated={!!token} onLogout={handleLogout}>
          <AppRoutes token={token} onAuthenticated={handleAuthenticated} />
        </Layout>
      </LiveDataProvider>
    </BrowserRouter>
  )
}

export default App
