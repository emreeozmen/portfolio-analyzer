import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  createAlert,
  deleteAlert,
  getAlerts,
  getAssetAnalysis,
  getAssetFundamentals,
  getAssetQuotes,
  type AlertCondition,
  type AssetAnalysis,
  type AssetFundamentalsResponse,
  type AssetQuote,
  type PriceAlert,
} from '../api'
import { alertConditionText } from '../lib/alertLabels'
import Card from '../components/Card'
import Watchlist from '../components/Watchlist'
import TickerAvatar from '../components/TickerAvatar'
import Skeleton from '../components/Skeleton'
import LineChart from '../charts/LineChart'
import CandlestickChart from '../charts/CandlestickChart'
import DonutChart from '../charts/DonutChart'
import { PERFORMANCE_WINDOWS, lastValue, macd, periodReturn, rsi, sma } from '../lib/indicators'
import { formatMoney } from '../lib/currency'
import { useLiveChannel, useLiveSignal } from '../lib/useLiveChannel'
import { useFlashOnChange } from '../lib/useFlashOnChange'
import { getToken } from '../auth'
import RiskAlerts, { type RiskAlert } from '../components/RiskAlerts'
import { useTheme } from '../lib/ThemeContext'

type Tab = 'genel' | 'teknikler' | 'performans' | 'temeller'

function formatFraction(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function formatPercentValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

function buildAssetAlerts(analysis: AssetAnalysis, t: TFunction<'assets'>): RiskAlert[] {
  const alerts: RiskAlert[] = []
  const closes = analysis.prices.map((p) => p.close_price)
  const last = closes[closes.length - 1]
  if (last === undefined) return alerts

  const high52w = Math.max(...analysis.prices.map((p) => p.high_price))
  const low52w = Math.min(...analysis.prices.map((p) => p.low_price))

  if (high52w > 0 && last >= high52w * 0.97) {
    alerts.push({ tone: 'info', text: t('detail.alerts.high52wNear', { price: formatMoney(high52w, analysis.currency) }) })
  }
  if (low52w > 0 && last <= low52w * 1.03) {
    alerts.push({ tone: 'warn', text: t('detail.alerts.low52wNear', { price: formatMoney(low52w, analysis.currency) }) })
  }

  const rsi14 = lastValue(rsi(closes, 14))
  if (rsi14 !== null && rsi14 >= 70) {
    alerts.push({ tone: 'warn', text: t('detail.alerts.rsiOverbought', { value: rsi14.toFixed(1) }) })
  } else if (rsi14 !== null && rsi14 <= 30) {
    alerts.push({ tone: 'warn', text: t('detail.alerts.rsiOversold', { value: rsi14.toFixed(1) }) })
  }

  if (analysis.summary.max_drawdown < -0.4) {
    alerts.push({
      tone: 'danger',
      text: t('detail.alerts.deepDrawdown', { percent: Math.abs(analysis.summary.max_drawdown * 100).toFixed(1) }),
    })
  }

  return alerts
}

function AlertsSection({ ticker }: { ticker: string }) {
  const { t } = useTranslation('assets')
  const ALERT_CONDITION_OPTIONS: { value: AlertCondition; label: string }[] = [
    { value: 'price_above', label: t('detail.alertConditions.priceAbove') },
    { value: 'price_below', label: t('detail.alertConditions.priceBelow') },
    { value: 'rsi_above', label: t('detail.alertConditions.rsiAbove') },
    { value: 'rsi_below', label: t('detail.alertConditions.rsiBelow') },
    { value: 'macd_bull_cross', label: t('detail.alertConditions.macdBullCross') },
    { value: 'macd_bear_cross', label: t('detail.alertConditions.macdBearCross') },
    { value: 'volume_spike', label: t('detail.alertConditions.volumeSpike') },
  ]
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [condition, setCondition] = useState<AlertCondition>('price_above')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isAuthed = !!getToken()
  // MACD crossover conditions have no meaningful numeric threshold (see
  // alert_service.py's THRESHOLD_REQUIRED_CONDITIONS) — hide the input for them and
  // submit 0, rather than asking the user to type a value that means nothing.
  const needsThreshold = condition !== 'macd_bull_cross' && condition !== 'macd_bear_cross'

  const load = useCallback(() => {
    if (!isAuthed) return
    setError(null)
    getAlerts()
      .then((all) => setAlerts(all.filter((a) => a.ticker === ticker)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [ticker, isAuthed])

  useEffect(load, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (needsThreshold && !threshold) {
      setError(t('detail.alertsSection.thresholdRequired'))
      return
    }
    try {
      await createAlert(ticker, condition, needsThreshold ? Number(threshold) : 0)
      setThreshold('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteAlert(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!isAuthed) {
    return (
      <section className="panel">
        <h2>{t('detail.alertsSection.title')}</h2>
        <p className="muted">
          <Trans t={t} i18nKey="detail.alertsSection.loginPrompt" components={{ link: <Link to="/portfolio" /> }} />
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>{t('detail.alertsSection.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('detail.alertsSection.intro')}
      </p>
      {error && <p className="error">{error}</p>}
      {alerts.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>{t('detail.alertsSection.columnCondition')}</th>
                <th>{t('detail.alertsSection.columnStatus')}</th>
                <th scope="col" className="sr-only">
                  {t('detail.alertsSection.columnActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    {alertConditionText(a.condition, a.threshold)}
                  </td>
                  <td className={a.is_triggered ? 'text-up' : 'muted'}>
                    {a.is_triggered ? t('detail.alertsSection.triggered') : t('detail.alertsSection.active')}
                  </td>
                  <td>
                    <button type="button" className="btn-ghost weight-warn" onClick={() => handleDelete(a.id)}>
                      {t('detail.alertsSection.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={handleSubmit} className="portfolio-row">
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as AlertCondition)}
          aria-label={t('detail.alertsSection.conditionAria')}
        >
          {ALERT_CONDITION_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {needsThreshold && (
          <input
            type="number"
            placeholder={
              condition === 'volume_spike'
                ? t('detail.alertsSection.volumeMultiplierPlaceholder')
                : t('detail.alertsSection.thresholdPlaceholder')
            }
            aria-label={
              condition === 'volume_spike'
                ? t('detail.alertsSection.volumeMultiplierPlaceholder')
                : t('detail.alertsSection.thresholdPlaceholder')
            }
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            min={0}
            step="any"
            required
          />
        )}
        <button type="submit" className="btn-primary">
          {t('detail.alertsSection.addAlert')}
        </button>
      </form>
    </section>
  )
}

function DetailHeader({ analysis }: { analysis: AssetAnalysis }) {
  const last = analysis.prices[analysis.prices.length - 1]
  const changePercent = (last?.daily_return ?? 0) * 100
  const isUp = changePercent >= 0
  const flash = useFlashOnChange(last?.close_price ?? 0)

  return (
    <div className="detail-header">
      <div className="detail-header-identity">
        <TickerAvatar ticker={analysis.ticker} size={44} />
        <div>
          <div className="detail-header-eyebrow">
            {analysis.ticker} {analysis.exchange ? `· ${analysis.exchange}` : ''} {analysis.sector ? `· ${analysis.sector}` : ''}
          </div>
          <h1 className="detail-header-name">{analysis.name}</h1>
          <div className="detail-header-price-row">
            <span className={`detail-header-price ${flash}`}>
              {last ? formatMoney(last.close_price, analysis.currency) : '—'}
            </span>
            <span className={isUp ? 'candle-change is-up' : 'candle-change is-down'}>
              {isUp ? '▲' : '▼'} {formatPercentValue(changePercent)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TechnicalsTab({ analysis }: { analysis: AssetAnalysis }) {
  const { t } = useTranslation('assets')
  const closes = analysis.prices.map((p) => p.close_price)
  const lastClose = closes[closes.length - 1]
  const sma20 = lastValue(sma(closes, 20))
  const sma50 = lastValue(sma(closes, 50))
  const sma200 = lastValue(sma(closes, 200))
  const rsi14 = lastValue(rsi(closes, 14))

  const maRows: { label: string; value: number | null }[] = [
    { label: 'SMA 20', value: sma20 },
    { label: 'SMA 50', value: sma50 },
    { label: 'SMA 200', value: sma200 },
  ]

  const maSignal = (value: number | null) => {
    if (value === null || lastClose === undefined) return null
    return lastClose >= value
      ? { text: t('detail.technicals.priceAbove'), up: true }
      : { text: t('detail.technicals.priceBelow'), up: false }
  }

  const rsiReading = (value: number | null): { text: string; tone: 'up' | 'down' | 'neutral' } => {
    if (value === null) return { text: t('detail.technicals.rsiInsufficientData'), tone: 'neutral' }
    if (value >= 70) return { text: t('detail.technicals.rsiOverbought'), tone: 'down' }
    if (value <= 30) return { text: t('detail.technicals.rsiOversold'), tone: 'up' }
    return { text: t('detail.technicals.rsiNeutral'), tone: 'neutral' }
  }

  const rsiInfo = rsiReading(rsi14)
  const macdResult = macd(closes)
  const macdSignal =
    macdResult.histogram === null
      ? null
      : macdResult.histogram >= 0
        ? { text: t('detail.technicals.macdPositive'), up: true }
        : { text: t('detail.technicals.macdNegative'), up: false }

  return (
    <section className="panel">
      <h2>{t('detail.technicals.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('detail.technicals.intro')}
      </p>

      <div className="indicator-grid">
        {maRows.map((row) => {
          const signal = maSignal(row.value)
          return (
            <div className="indicator-card" key={row.label}>
              <div className="card-label">{row.label}</div>
              <div className="card-value">{row.value !== null ? formatMoney(row.value, analysis.currency) : '—'}</div>
              {signal && (
                <div className={signal.up ? 'indicator-signal is-up' : 'indicator-signal is-down'}>{signal.text}</div>
              )}
            </div>
          )
        })}

        <div className="indicator-card">
          <div className="card-label">RSI (14)</div>
          <div className="card-value">{rsi14 !== null ? rsi14.toFixed(1) : '—'}</div>
          <div className={`indicator-signal is-${rsiInfo.tone}`}>{rsiInfo.text}</div>
        </div>

        <div className="indicator-card">
          <div className="card-label">MACD (12,26,9)</div>
          <div className="card-value">{macdResult.macd !== null ? macdResult.macd.toFixed(2) : '—'}</div>
          {macdSignal && (
            <div className={macdSignal.up ? 'indicator-signal is-up' : 'indicator-signal is-down'}>
              {macdSignal.text}
              {t('detail.technicals.macdSignalSuffix', {
                value: macdResult.signal !== null ? macdResult.signal.toFixed(2) : '—',
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function PerformanceTab({ analysis }: { analysis: AssetAnalysis }) {
  const { t } = useTranslation('assets')
  const prices = analysis.prices.map((p) => ({ date: p.date, close: p.close_price }))

  return (
    <section className="panel">
      <h2>{t('detail.performance.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('detail.performance.intro')}
      </p>
      <div className="performance-grid">
        {PERFORMANCE_WINDOWS.map((w) => {
          const ret = periodReturn(prices, w)
          return (
            <div className="performance-cell" key={w.label}>
              <div className="performance-label">{t(`performanceWindows.${w.label}`)}</div>
              <div className={ret !== null && ret >= 0 ? 'performance-value text-up' : 'performance-value text-down'}>
                {ret !== null ? formatPercentValue(ret) : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function FundamentalsTab({ ticker, currency }: { ticker: string; currency: string }) {
  const { t } = useTranslation('assets')
  const [data, setData] = useState<AssetFundamentalsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getAssetFundamentals(ticker)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker])

  if (loading) {
    return (
      <section className="panel">
        <p className="muted">{t('detail.fundamentals.loading')}</p>
      </section>
    )
  }
  if (error) {
    return (
      <section className="panel">
        <p className="error">{error}</p>
      </section>
    )
  }
  if (!data) return null

  const { valuation, analyst_recommendations, earnings_calendar, holders } = data
  const hasAnyData = !!valuation || analyst_recommendations.length > 0 || !!earnings_calendar || !!holders
  if (!hasAnyData) {
    return (
      <section className="panel">
        <p className="muted">{t('detail.fundamentals.empty')}</p>
      </section>
    )
  }

  const latestTrend = analyst_recommendations[0] ?? null
  const donutLabels = [t('detail.fundamentals.buy'), t('detail.fundamentals.hold'), t('detail.fundamentals.sell')]
  const donutData = latestTrend
    ? [latestTrend.strong_buy + latestTrend.buy, latestTrend.hold, latestTrend.sell + latestTrend.strong_sell]
    : []

  const recommendationLabel = (key: string | null | undefined): string => {
    if (!key) return '—'
    const labels: Record<string, string> = {
      strong_buy: t('detail.fundamentals.recStrongBuy'),
      strongbuy: t('detail.fundamentals.recStrongBuy'),
      buy: t('detail.fundamentals.recBuy'),
      hold: t('detail.fundamentals.recHold'),
      sell: t('detail.fundamentals.recSell'),
      strong_sell: t('detail.fundamentals.recStrongSell'),
      strongsell: t('detail.fundamentals.recStrongSell'),
      underperform: t('detail.fundamentals.recSell'),
      outperform: t('detail.fundamentals.recBuy'),
    }
    return labels[key.toLowerCase()] ?? key
  }

  const hasAnalystSummary = !!latestTrend || !!valuation?.recommendation_key

  return (
    <>
      {valuation && (
        <section className="panel">
          <h2>{t('detail.fundamentals.valuationTitle')}</h2>
          <p className="muted" style={{ marginBottom: 18 }}>
            {t('detail.fundamentals.valuationIntro')}
          </p>
          <div className="card-grid">
            <Card label={t('detail.fundamentals.trailingPe')} value={valuation.trailing_pe !== null ? valuation.trailing_pe.toFixed(2) : '—'} />
            <Card label={t('detail.fundamentals.forwardPe')} value={valuation.forward_pe !== null ? valuation.forward_pe.toFixed(2) : '—'} />
            <Card label={t('detail.fundamentals.priceToBook')} value={valuation.price_to_book !== null ? valuation.price_to_book.toFixed(2) : '—'} />
            <Card label={t('detail.fundamentals.priceToSales')} value={valuation.price_to_sales !== null ? valuation.price_to_sales.toFixed(2) : '—'} />
            <Card label={t('detail.fundamentals.profitMargin')} value={valuation.profit_margin !== null ? formatFraction(valuation.profit_margin) : '—'} />
            <Card label={t('detail.fundamentals.roe')} value={valuation.return_on_equity !== null ? formatFraction(valuation.return_on_equity) : '—'} />
            <Card
              label={t('detail.fundamentals.debtToEquity')}
              value={valuation.debt_to_equity !== null ? `${valuation.debt_to_equity.toFixed(2)}%` : '—'}
            />
            {/* yfinance's dividendYield field is already percent-scaled (e.g. 4.05 means
                4.05%), unlike profit_margin/return_on_equity which are true fractions —
                verified empirically against real BIST tickers; formatFraction() would
                double-scale it. */}
            <Card
              label={t('detail.fundamentals.dividendYield')}
              value={valuation.dividend_yield !== null ? `${valuation.dividend_yield.toFixed(2)}%` : '—'}
            />
            <Card label={t('detail.fundamentals.beta')} value={valuation.beta !== null ? valuation.beta.toFixed(2) : '—'} />
          </div>
        </section>
      )}

      <section className="panel">
        <h2>{t('detail.fundamentals.analystTitle')}</h2>
        {hasAnalystSummary ? (
          <>
            <div className="card-grid" style={{ marginBottom: 18 }}>
              <Card label={t('detail.fundamentals.consensus')} value={recommendationLabel(valuation?.recommendation_key)} />
              <Card
                label={t('detail.fundamentals.numberOfAnalysts')}
                value={valuation?.number_of_analyst_opinions != null ? String(valuation.number_of_analyst_opinions) : '—'}
              />
              <Card
                label={t('detail.fundamentals.targetLow')}
                value={valuation?.target_low_price != null ? formatMoney(valuation.target_low_price, currency) : '—'}
              />
              <Card
                label={t('detail.fundamentals.targetMean')}
                value={valuation?.target_mean_price != null ? formatMoney(valuation.target_mean_price, currency) : '—'}
              />
              <Card
                label={t('detail.fundamentals.targetHigh')}
                value={valuation?.target_high_price != null ? formatMoney(valuation.target_high_price, currency) : '—'}
              />
            </div>
            {latestTrend && (
              <div style={{ maxWidth: 260 }}>
                <DonutChart labels={donutLabels} data={donutData} ariaLabel={t('detail.fundamentals.donutAria')} />
              </div>
            )}
          </>
        ) : (
          <p className="muted">{t('detail.fundamentals.noAnalystData')}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t('detail.fundamentals.earningsTitle')}</h2>
        {earnings_calendar ? (
          <div className="card-grid">
            <Card label={t('detail.fundamentals.nextEarningsDate')} value={earnings_calendar.earnings_date ?? '—'} />
            <Card
              label={t('detail.fundamentals.earningsEstimate')}
              value={earnings_calendar.earnings_average !== null ? earnings_calendar.earnings_average.toFixed(2) : '—'}
            />
            <Card
              label={t('detail.fundamentals.revenueEstimate')}
              value={earnings_calendar.revenue_average !== null ? formatVolume(earnings_calendar.revenue_average) : '—'}
            />
          </div>
        ) : (
          <p className="muted">{t('detail.fundamentals.noEarningsData')}</p>
        )}
      </section>

      <section className="panel">
        <h2>{t('detail.fundamentals.holdersTitle')}</h2>
        {holders ? (
          <>
            <div className="card-grid" style={{ marginBottom: holders.top_holders.length > 0 ? 18 : 0 }}>
              <Card
                label={t('detail.fundamentals.insiderPercent')}
                value={holders.insider_percent !== null ? formatFraction(holders.insider_percent) : '—'}
              />
              <Card
                label={t('detail.fundamentals.institutionsPercent')}
                value={holders.institutions_percent !== null ? formatFraction(holders.institutions_percent) : '—'}
              />
            </div>
            {holders.top_holders.length > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t('detail.fundamentals.columnHolder')}</th>
                      <th>{t('detail.fundamentals.columnShares')}</th>
                      <th>{t('detail.fundamentals.columnPercentOut')}</th>
                      <th>{t('detail.fundamentals.columnDateReported')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.top_holders.map((h, i) => (
                      <tr key={`${h.holder}-${i}`}>
                        <td>{h.holder ?? '—'}</td>
                        <td>{h.shares !== null ? formatVolume(h.shares) : '—'}</td>
                        <td>{h.percent_out !== null ? formatFraction(h.percent_out) : '—'}</td>
                        <td>{h.date_reported ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted">{t('detail.fundamentals.noHoldersData')}</p>
        )}
      </section>

      <p className="muted" style={{ fontSize: 12 }}>
        {t('detail.fundamentals.disclaimer')}
      </p>
    </>
  )
}

function AssetDetailPage() {
  const { t } = useTranslation('assets')
  useTheme() // re-render on theme toggle so the Chart.js color read below stays current
  const dangerColor = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#ec5f66'
  const { ticker = '' } = useParams<{ ticker: string }>()
  const navigate = useNavigate()
  const handleWatchlistSelect = useCallback((t: string) => navigate(`/assets/${t}`), [navigate])
  const [quotes, setQuotes] = useState<AssetQuote[]>([])
  const [analysis, setAnalysis] = useState<AssetAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('genel')
  const [smaOverlays, setSmaOverlays] = useState<number[]>([20, 50])

  const toggleSmaOverlay = (period: number) => {
    setSmaOverlays((prev) => (prev.includes(period) ? prev.filter((p) => p !== period) : [...prev, period].sort((a, b) => a - b)))
  }

  const loadQuotes = useCallback(() => {
    getAssetQuotes()
      .then(setQuotes)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    loadQuotes()
  }, [loadQuotes])

  const liveQuotes = useLiveChannel<AssetQuote[]>('quotes')
  useEffect(() => {
    if (liveQuotes) setQuotes(liveQuotes)
  }, [liveQuotes])

  useEffect(() => {
    if (!ticker) return
    // Guards against an out-of-order response: switching tickers quickly (e.g. via
    // the watchlist sidebar) before the previous fetch resolves could otherwise land
    // a stale ticker's data on screen under the new ticker's heading.
    let cancelled = false
    setLoading(true)
    setError(null)
    setTab('genel')
    getAssetAnalysis(ticker)
      .then((data) => {
        if (!cancelled) setAnalysis(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker])

  useLiveSignal('prices-updated', () => {
    // Fired only when the backend's auto-refresh loop actually wrote new price data
    // (every ~5 min) — refetches the full analysis exactly then, instead of blindly
    // polling every 60s regardless of whether anything had actually changed.
    if (!ticker) return
    getAssetAnalysis(ticker)
      .then(setAnalysis)
      .catch(() => {}) // silent — background refresh shouldn't surface a page-level error
  })

  const recentPrices = analysis ? analysis.prices.slice().reverse().slice(0, 30) : []

  return (
    <div>
      <p className="breadcrumb">
        <Link to="/assets">{t('detail.breadcrumb')}</Link> <span className="breadcrumb-sep">/</span>{' '}
        <span className="breadcrumb-current">{ticker}</span>
        <Link to="/market" className="breadcrumb-link-alt">
          {t('detail.compareInMarket')}
        </Link>
      </p>

      {error && <p className="error">{error}</p>}

      <div className="workspace">
        <aside className="workspace-sidebar">
          <Watchlist quotes={quotes} selectedTicker={ticker} onSelect={handleWatchlistSelect} />
        </aside>

        <div className="workspace-main">
          {loading && (
            <>
              <div className="detail-header">
                <div className="detail-header-identity">
                  <Skeleton className="skeleton-avatar" width={44} height={44} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Skeleton width={90} height={11} />
                    <Skeleton width={160} height={20} />
                    <Skeleton width={110} height={26} />
                  </div>
                </div>
              </div>
              <div className="card-grid">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div className="card" key={i}>
                    <Skeleton width={80} height={11} className="card-label" />
                    <div style={{ marginTop: 10 }}>
                      <Skeleton width={70} height={22} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <Skeleton height={300} />
              </div>
            </>
          )}

          {analysis && !loading && (
            <>
              <DetailHeader analysis={analysis} />

              <RiskAlerts alerts={buildAssetAlerts(analysis, t)} />

              <div className="card-grid">
                <Card label={t('detail.avgDailyReturn')} value={formatFraction(analysis.summary.average_return)} />
                <Card label={t('detail.annualVolatility')} value={formatFraction(analysis.summary.volatility)} />
                <Card label={t('detail.maxDrawdown')} value={formatFraction(analysis.summary.max_drawdown)} />
                <Card label={t('detail.sharpeRatio')} value={analysis.summary.sharpe_ratio.toFixed(2)} />
                <Card
                  label={t('detail.high52w')}
                  value={formatMoney(Math.max(...analysis.prices.map((p) => p.high_price)), analysis.currency)}
                />
                <Card
                  label={t('detail.low52w')}
                  value={formatMoney(Math.min(...analysis.prices.map((p) => p.low_price)), analysis.currency)}
                />
                <Card
                  label={t('detail.avgVolume')}
                  value={formatVolume(analysis.prices.reduce((s, p) => s + p.volume, 0) / analysis.prices.length)}
                />
              </div>

              <AlertsSection ticker={analysis.ticker} />

              <nav className="detail-tabs">
                <button
                  type="button"
                  className={tab === 'genel' ? 'detail-tab is-active' : 'detail-tab'}
                  onClick={() => setTab('genel')}
                >
                  {t('detail.tabOverview')}
                </button>
                <button
                  type="button"
                  className={tab === 'teknikler' ? 'detail-tab is-active' : 'detail-tab'}
                  onClick={() => setTab('teknikler')}
                >
                  {t('detail.tabTechnicals')}
                </button>
                <button
                  type="button"
                  className={tab === 'performans' ? 'detail-tab is-active' : 'detail-tab'}
                  onClick={() => setTab('performans')}
                >
                  {t('detail.tabPerformance')}
                </button>
                <button
                  type="button"
                  className={tab === 'temeller' ? 'detail-tab is-active' : 'detail-tab'}
                  onClick={() => setTab('temeller')}
                >
                  {t('detail.tabFundamentals')}
                </button>
              </nav>

              {tab === 'genel' && (
                <>
                  <section className="panel">
                    <div className="portfolio-row" style={{ marginBottom: 12 }}>
                      {[20, 50, 200].map((period) => (
                        <label key={period} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={smaOverlays.includes(period)}
                            onChange={() => toggleSmaOverlay(period)}
                          />
                          SMA{period}
                        </label>
                      ))}
                    </div>
                    <CandlestickChart
                      ticker={analysis.ticker}
                      name={analysis.name}
                      currency={analysis.currency}
                      smaOverlays={smaOverlays}
                      data={analysis.prices.map((p) => ({
                        date: p.date,
                        open: p.open_price,
                        high: p.high_price,
                        low: p.low_price,
                        close: p.close_price,
                        volume: p.volume,
                      }))}
                    />
                  </section>

                  <section className="panel">
                    <h2>{t('detail.dailyReturnTitle')}</h2>
                    <LineChart
                      ariaLabel={t('detail.dailyReturnChartAria', { ticker: analysis.ticker })}
                      labels={analysis.prices.map((p) => p.date)}
                      datasets={[
                        {
                          label: t('detail.dailyReturnSeries'),
                          data: analysis.prices.map((p) => (p.daily_return ?? 0) * 100),
                          color: dangerColor,
                        },
                      ]}
                    />
                  </section>

                  <section className="panel">
                    <h2>{t('detail.priceTableTitle')}</h2>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('detail.columnDate')}</th>
                            <th>{t('detail.columnClose')}</th>
                            <th>{t('detail.columnDailyReturn')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recentPrices.map((p) => (
                            <tr key={p.date}>
                              <td>{p.date}</td>
                              <td>{formatMoney(p.close_price, analysis.currency)}</td>
                              <td>{p.daily_return !== null ? formatFraction(p.daily_return) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}

              {tab === 'teknikler' && <TechnicalsTab analysis={analysis} />}
              {tab === 'performans' && <PerformanceTab analysis={analysis} />}
              {tab === 'temeller' && <FundamentalsTab ticker={analysis.ticker} currency={analysis.currency} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default AssetDetailPage
