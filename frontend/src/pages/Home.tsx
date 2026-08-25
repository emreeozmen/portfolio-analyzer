import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Search, Activity, Layers, BarChart3, CandlestickChart, PieChart, Check } from 'lucide-react'
import LiveTickerStrip from '../components/LiveTickerStrip'
import Reveal from '../components/Reveal'
import HeroWaveCanvas from '../components/HeroWaveCanvas'
import MarketOverviewPanel from '../components/MarketOverviewPanel'
import MarketNewsPanel from '../components/MarketNewsPanel'
import Watchlist from '../components/Watchlist'
import TopMovers from '../components/TopMovers'
import ExposureBreakdown from '../components/ExposureBreakdown'
import Sparkline from '../components/Sparkline'
import { getToken } from '../auth'
import { formatMoney } from '../lib/currency'
import { currentLocale } from '../lib/locale'
import { useFlashOnChange } from '../lib/useFlashOnChange'
import { useCountUp } from '../lib/useCountUp'
import LineChart from '../charts/LineChart'
import { useLiveChannel, useLiveSignal } from '../lib/useLiveChannel'
import {
  getAssetQuotes,
  getBist100History,
  getHoldingsValuation,
  getHoldingsValueHistory,
  getPortfolios,
  getRealizedPLSummary,
  getTickerStrip,
  type AssetQuote,
  type Portfolio,
  type RealizedPLSummary,
  type SectorWeight,
  type TickerStripQuote,
  type ValuationSummary,
  type ValueHistoryPoint,
} from '../api'

const HERO_PANEL_SYMBOLS: string[] = ['XU100.IS', 'USDTRY=X', 'BTC-USD']

const HISTORY_RANGE_DAYS = [21, 63, 126, 252, Infinity] as const
const HISTORY_RANGE_LABELS = ['1A', '3A', '6A', '1Y'] as const

const FEATURE_KEYS = ['market', 'assets', 'portfolio'] as const
const FEATURE_ROUTES = { market: '/market', assets: '/assets', portfolio: '/portfolio' } as const

const STEP_KEYS = ['step1', 'step2', 'step3'] as const
const STEP_NUMBERS = ['01', '02', '03'] as const
const STEP_ICONS: Record<(typeof STEP_KEYS)[number], ComponentType<{ size?: number }>> = {
  step1: Search,
  step2: Activity,
  step3: Layers,
}
const FEATURE_ICONS: Record<(typeof FEATURE_KEYS)[number], ComponentType<{ size?: number }>> = {
  market: BarChart3,
  assets: CandlestickChart,
  portfolio: PieChart,
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function HeroLiveRow({ quote, sparkline }: { quote: TickerStripQuote; sparkline?: number[] }) {
  const flash = useFlashOnChange(quote.value)
  const isUp = quote.change_percent >= 0

  return (
    <div className="hero-live-row">
      <span className="hero-live-row-label">{quote.label}</span>
      {sparkline && sparkline.length >= 2 && (
        <Sparkline data={sparkline} width={48} height={20} />
      )}
      <span className="hero-live-row-values">
        <span className={`hero-live-row-price mono ${flash}`}>
          {quote.value.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`hero-live-row-change mono ${isUp ? 'text-up' : 'text-down'}`}>
          {isUp ? '▲' : '▼'} {formatPercent(quote.change_percent)}
        </span>
      </span>
    </div>
  )
}

const BIST100_SYMBOL = 'XU100.IS'

/** A small "live product screenshot" for the hero — the same real ticker-strip feed
 * (index, FX, crypto) as the marquee at the top of the page, not a mockup or
 * fabricated numbers. Silently absent until the first REST/WebSocket quote lands. */
function HeroLiveMarketPanel() {
  const { t } = useTranslation('home')
  const [quotes, setQuotes] = useState<TickerStripQuote[]>([])
  const [bist100Sparkline, setBist100Sparkline] = useState<number[]>([])
  const live = useLiveChannel<TickerStripQuote[]>('ticker-strip')

  useEffect(() => {
    getTickerStrip()
      .then((rows) => setQuotes(rows.filter((r) => HERO_PANEL_SYMBOLS.includes(r.symbol))))
      .catch(() => {}) // silent — a missing hero widget beats a broken homepage
    // Only BIST 100 has a real short price-history source readily available here
    // (the same endpoint MarketOverviewPanel's hero index card already uses) — USD/TRY
    // and BTC-USD aren't tracked Assets, so there's no equivalent real series to plot
    // for them without fabricating one, and this panel doesn't add one just for a
    // sparkline.
    getBist100History()
      .then((points) => setBist100Sparkline(points.slice(-30).map((p) => p.close)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!live) return
    setQuotes(live.filter((r) => HERO_PANEL_SYMBOLS.includes(r.symbol)))
  }, [live])

  const ordered = HERO_PANEL_SYMBOLS.map((symbol) => quotes.find((q) => q.symbol === symbol)).filter(
    (q): q is TickerStripQuote => !!q,
  )

  if (ordered.length === 0) return null

  return (
    <div className="hero-live-card">
      <div className="hero-live-card-header">
        <span className="live-indicator-dot" />
        {t('hero.liveCardLabel')}
      </div>
      <div className="hero-live-rows">
        {ordered.map((q) => (
          <HeroLiveRow key={q.symbol} quote={q} sparkline={q.symbol === BIST100_SYMBOL ? bist100Sparkline : undefined} />
        ))}
      </div>
      <div className="hero-live-card-footer">
        <span>{t('hero.liveCardSource')}</span>
        <Link to="/market" className="hero-live-card-link">
          {t('hero.liveCardCta')} →
        </Link>
      </div>
    </div>
  )
}

/** Traces real net worth over time by reconstructing what today's open Holding lots
 * were worth on each past trading day (real close prices, real historical FX for
 * mixed-currency positions) — see `holdings_value_history` on the backend. This is
 * "value of what you hold today, since you bought it", not a full historical ledger:
 * a fully-sold position leaves no trace, so `excluded_tickers`/`fx_unavailable` are
 * surfaced as an explicit caveat rather than presenting the line as complete.
 */
function NetWorthHistoryChart() {
  const { t } = useTranslation('home')
  const [points, setPoints] = useState<ValueHistoryPoint[]>([])
  const [fxUnavailable, setFxUnavailable] = useState(false)
  const [excludedTickers, setExcludedTickers] = useState<string[]>([])
  const [rangeIndex, setRangeIndex] = useState(HISTORY_RANGE_DAYS.length - 1)
  const rangeLabels = [...HISTORY_RANGE_LABELS, t('historyRanges.all')]

  useEffect(() => {
    getHoldingsValueHistory()
      .then((h) => {
        setPoints(h.points)
        setFxUnavailable(h.fx_unavailable)
        setExcludedTickers(h.excluded_tickers)
      })
      .catch(() => {}) // silent — see NetWorthSection docstring
  }, [])

  if (points.length < 2) return null

  const days = HISTORY_RANGE_DAYS[rangeIndex]
  const sliced = Number.isFinite(days) ? points.slice(-days) : points

  return (
    <div className="market-overview-hero" style={{ marginTop: 24 }}>
      <div className="market-overview-hero-header">
        <div className="market-overview-hero-label">{t('netWorthHistory.title')}</div>
        <div className="candle-range-tabs">
          {rangeLabels.map((label, i) => (
            <button
              key={label}
              type="button"
              className={i === rangeIndex ? 'candle-range-tab is-active' : 'candle-range-tab'}
              onClick={() => setRangeIndex(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <LineChart
        labels={sliced.map((p) => p.date)}
        datasets={[
          { label: t('netWorthHistory.currentValueLine'), data: sliced.map((p) => p.market_value) },
          { label: t('netWorthHistory.costLine'), data: sliced.map((p) => p.cost_basis), dashed: true, color: '#5b9dee' },
        ]}
      />
      {(fxUnavailable || excludedTickers.length > 0) && (
        <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12.5 }}>
          {t('netWorthHistory.caveat')}
          {excludedTickers.length > 0 && t('netWorthHistory.caveatExcluded', { tickers: excludedTickers.join(', ') })}
        </p>
      )}
    </div>
  )
}

/** Consolidated real-money view across every portfolio's holdings — unlike the
 * per-portfolio pages (which mostly work in a normalized base=100 index), this rolls
 * up the actual TRY-normalized cost/value/P&L from Holdings, since that's the only
 * place real position sizes live. Only rendered for a logged-in user with at least one
 * priced or unpriced holding; silently hidden otherwise (a marketing homepage shouldn't
 * show an error banner for a fetch failure or an empty state).
 */
function NetWorthSection() {
  const { t } = useTranslation('home')
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [summary, setSummary] = useState<ValuationSummary | null>(null)
  const [realizedSummary, setRealizedSummary] = useState<RealizedPLSummary | null>(null)
  const [sectorAllocation, setSectorAllocation] = useState<SectorWeight[]>([])

  const load = () => {
    Promise.all([getPortfolios(), getHoldingsValuation(), getRealizedPLSummary()])
      .then(([portfolioRows, valuation, realized]) => {
        setPortfolios(portfolioRows)
        setSummary(valuation.summary)
        setSectorAllocation(valuation.sector_allocation)
        setRealizedSummary(realized)
      })
      .catch(() => {}) // silent — see docstring
  }

  useEffect(load, [])
  useLiveSignal('prices-updated', load)

  const currency = summary?.mixed_currency ? 'TRY' : (summary?.currency ?? 'TRY')
  const totalCost = summary ? (summary.mixed_currency ? summary.total_cost_basis_try : summary.total_cost_basis) : 0
  const totalValue = summary
    ? summary.mixed_currency
      ? summary.total_market_value_try
      : summary.total_market_value
    : 0
  const totalPl = summary ? (summary.mixed_currency ? summary.total_unrealized_pl_try : summary.total_unrealized_pl) : 0
  const totalPlPercent = summary
    ? summary.mixed_currency
      ? summary.total_unrealized_pl_percent_try
      : summary.total_unrealized_pl_percent
    : 0
  const dividendIncome = summary
    ? summary.mixed_currency
      ? summary.total_dividend_income_try
      : summary.total_dividend_income
    : 0

  // Animated count-up for the headline figures — same treatment every time fresh data
  // lands (useLiveSignal above re-triggers `load`), not just on first mount.
  const animatedPortfolioCount = useCountUp(portfolios.length)
  const animatedTotalCost = useCountUp(Math.round(totalCost))
  const animatedTotalValue = useCountUp(Math.round(totalValue))
  const animatedTotalPl = useCountUp(Math.round(totalPl))
  const animatedDividendIncome = useCountUp(Math.round(dividendIncome))

  if (!summary || summary.priced_count + summary.unpriced_count === 0) return null

  return (
    <section className="home-section">
      <h2 className="home-section-title">{t('netWorth.title')}</h2>
      <div className="card-grid">
        <div className="card">
          <div className="card-label">{t('netWorth.totalPortfolios')}</div>
          <div className="card-value">{animatedPortfolioCount}</div>
        </div>
        <div className="card">
          <div className="card-label">{t('netWorth.totalCost')}</div>
          <div className="card-value">{formatMoney(animatedTotalCost, currency)}</div>
        </div>
        <div className="card">
          <div className="card-label">{t('netWorth.currentValue')}</div>
          <div className="card-value">{formatMoney(animatedTotalValue, currency)}</div>
        </div>
        <div className="card">
          <div className="card-label">{t('netWorth.pl')}</div>
          <div className={`card-value ${totalPl >= 0 ? 'text-up' : 'text-down'}`}>
            {formatMoney(animatedTotalPl, currency)} ({formatPercent(totalPlPercent)})
          </div>
        </div>
        <div className="card">
          <div className="card-label">{t('netWorth.dividendIncome')}</div>
          <div className="card-value">{formatMoney(animatedDividendIncome, currency)}</div>
          <Link to="/temettuler" className="market-overview-more-link" style={{ marginTop: 4 }}>
            {t('netWorth.dividendCalendarLink')}
          </Link>
        </div>
        {realizedSummary && realizedSummary.sale_count > 0 && (
          <div className="card">
            <div className="card-label">{t('netWorth.realizedPl')}</div>
            <div className={`card-value ${realizedSummary.total_realized_pl >= 0 ? 'text-up' : 'text-down'}`}>
              {formatMoney(realizedSummary.total_realized_pl, currency)}
            </div>
          </div>
        )}
      </div>
      {summary.mixed_currency && (
        <p className="muted" style={{ marginTop: -10, marginBottom: 16 }}>
          {t('netWorth.mixedCurrencyNote')}
        </p>
      )}
      <NetWorthHistoryChart />
      <ExposureBreakdown title={t('netWorth.sectorAllocationTitle')} rows={sectorAllocation} />
      {portfolios.length > 0 && (
        <ul className="portfolio-list">
          {portfolios.map((p) => (
            <li key={p.id}>
              <Link to="/portfolio" className="portfolio-link">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Home() {
  const { t } = useTranslation('home')
  const isAuthenticated = !!getToken()
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<AssetQuote[]>([])
  const liveQuotes = useLiveChannel<AssetQuote[]>('quotes')

  useEffect(() => {
    getAssetQuotes()
      .then(setQuotes)
      .catch(() => {}) // silent — the sidebars just stay empty on a fetch failure
  }, [])

  useEffect(() => {
    if (liveQuotes) setQuotes(liveQuotes)
  }, [liveQuotes])

  return (
    <>
      <LiveTickerStrip />

      <div className="hero">
        <HeroWaveCanvas />
        <div className="hero-grid">
          <div className="hero-content">
            <span className="hero-eyebrow">{t('hero.eyebrow')}</span>
            <h1>
              <Trans t={t} i18nKey="hero.title" components={{ accent: <span className="hero-title-accent" /> }} />
            </h1>
            <p className="lead">{t('hero.lead')}</p>
            <div className="hero-actions">
              <Link to="/market" className="btn-primary">
                {t('hero.marketBtn')}
              </Link>
              <Link to="/assets" className="btn-secondary">
                {t('hero.assetsBtn')}
              </Link>
              <Link to="/portfolio" className="btn-secondary">
                {t('hero.portfolioBtn')}
              </Link>
            </div>
          </div>

          <div className="hero-visual">
            <HeroLiveMarketPanel />
          </div>
        </div>
      </div>

      <div className="home-workspace">
        <aside className="home-sidebar">
          <Watchlist quotes={quotes} selectedTicker="" onSelect={(t) => navigate(`/assets/${t}`)} />
        </aside>

        <div className="home-main">
          <Reveal>
            <MarketOverviewPanel />
          </Reveal>
          <Reveal>
            <MarketNewsPanel />
          </Reveal>

          {isAuthenticated && (
            <Reveal>
              <NetWorthSection />
            </Reveal>
          )}

          <section className="home-section home-section-textured">
            <Reveal>
              <h2 className="home-section-title">{t('steps.title')}</h2>
            </Reveal>
            <div className="steps-grid">
              {STEP_KEYS.map((key, i) => {
                const Icon = STEP_ICONS[key]
                return (
                  <Reveal className="step-card" delay={i * 90} key={key}>
                    <div className="step-card-head">
                      <div className="step-icon">
                        <Icon size={20} />
                      </div>
                      <div className="step-number mono">{STEP_NUMBERS[i]}</div>
                    </div>
                    <h3>{t(`steps.${key}Title`)}</h3>
                    <p className="muted">{t(`steps.${key}Desc`)}</p>
                  </Reveal>
                )
              })}
            </div>
          </section>

          <section className="home-section">
            <Reveal>
              <h2 className="home-section-title">{t('features.title')}</h2>
            </Reveal>
            <div className="feature-grid">
              {FEATURE_KEYS.map((key, i) => {
                const Icon = FEATURE_ICONS[key]
                return (
                  <Reveal delay={i * 90} key={key}>
                    <Link to={FEATURE_ROUTES[key]} className="feature-card">
                      <div className="feature-icon">
                        <Icon size={22} />
                      </div>
                      <h3>{t(`features.${key}Title`)}</h3>
                      <p className="muted">{t(`features.${key}Desc`)}</p>
                      <span className="feature-card-cta">{t(`features.${key}Cta`)} →</span>
                    </Link>
                  </Reveal>
                )
              })}
            </div>
          </section>

          <Reveal>
            <section className="home-cta">
              <span className="home-cta-badge">{t('cta.badge')}</span>
              <h2>{t('cta.title')}</h2>
              <p className="muted">{t('cta.body')}</p>
              <ul className="home-cta-points">
                <li>
                  <Check size={14} /> {t('cta.point1')}
                </li>
                <li>
                  <Check size={14} /> {t('cta.point2')}
                </li>
                <li>
                  <Check size={14} /> {t('cta.point3')}
                </li>
              </ul>
              <Link to="/portfolio" className="btn-primary">
                {t('cta.button')}
              </Link>
            </section>
          </Reveal>
        </div>

        <aside className="home-sidebar">
          <TopMovers quotes={quotes} />
        </aside>
      </div>
    </>
  )
}

export default Home
