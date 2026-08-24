import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GitCompare, MousePointerClick } from 'lucide-react'
import { getAssetAnalysis, getAssets, type AssetAnalysis, type AssetSummary } from '../api'
import TickerAvatar from '../components/TickerAvatar'
import LineChart from '../charts/LineChart'
import Skeleton from '../components/Skeleton'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { formatMoney } from '../lib/currency'
import { PERFORMANCE_WINDOWS, lastValue, periodReturn, rsi, sma } from '../lib/indicators'

const MAX_COMPARE = 4
const PALETTE = ['#c9a15f', '#5b9dee', '#2fbf76', '#ec5f66']

const COMPARE_RANGE_DAYS = [21, 63, 126, 252, Infinity] as const
const COMPARE_RANGE_LABELS = ['1A', '3A', '6A', '1Y'] as const

function formatFraction(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function formatPercentValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function buildNormalizedSeries(
  analyses: AssetAnalysis[],
  rangeDays: number,
): { labels: string[]; datasets: { label: string; data: number[]; color: string }[] } {
  if (analyses.length === 0) return { labels: [], datasets: [] }

  const dateSets = analyses.map((a) => new Set(a.prices.map((p) => p.date)))
  let commonDates = analyses[0].prices.map((p) => p.date).filter((d) => dateSets.every((s) => s.has(d)))
  if (Number.isFinite(rangeDays)) {
    commonDates = commonDates.slice(-rangeDays)
  }
  if (commonDates.length === 0) return { labels: [], datasets: [] }

  const datasets = analyses.map((a, i) => {
    const byDate = new Map(a.prices.map((p) => [p.date, p.close_price]))
    const firstValue = byDate.get(commonDates[0]) ?? 1
    return {
      label: a.ticker,
      color: PALETTE[i % PALETTE.length],
      data: commonDates.map((d) => {
        const v = byDate.get(d)
        return v !== undefined && firstValue ? (v / firstValue) * 100 : NaN
      }),
    }
  })

  return { labels: commonDates, datasets }
}

function AssetHeaderCard({ analysis, onRemove }: { analysis: AssetAnalysis; onRemove: () => void }) {
  const { t } = useTranslation('assets')
  const last = analysis.prices[analysis.prices.length - 1]
  const changePercent = (last?.daily_return ?? 0) * 100
  const isUp = changePercent >= 0

  return (
    <div className="card compare-header-card">
      <button
        type="button"
        className="btn-ghost compare-remove-btn"
        onClick={onRemove}
        aria-label={t('compare.removeAria', { ticker: analysis.ticker })}
      >
        ✕
      </button>
      <div className="compare-header-identity">
        <TickerAvatar ticker={analysis.ticker} size={36} />
        <div>
          <div className="card-label">{analysis.ticker}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{analysis.name}</div>
        </div>
      </div>
      <div className="card-value" style={{ marginTop: 10 }}>
        {last ? formatMoney(last.close_price, analysis.currency) : '—'}
      </div>
      <div className={isUp ? 'candle-change is-up' : 'candle-change is-down'}>
        {isUp ? '▲' : '▼'} {formatPercentValue(changePercent)}
      </div>
    </div>
  )
}

function AssetComparePage() {
  const { t } = useTranslation('assets')
  const rangeLabels = [...COMPARE_RANGE_LABELS, t('heroRanges.all', { ns: 'market' })]
  const [searchParams, setSearchParams] = useSearchParams()
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>(() => {
    const raw = searchParams.get('tickers')
    return raw ? raw.split(',').filter(Boolean).slice(0, MAX_COMPARE) : []
  })
  const [analyses, setAnalyses] = useState<Record<string, AssetAnalysis>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeIndex, setRangeIndex] = useState(COMPARE_RANGE_DAYS.length - 1)

  useEffect(() => {
    getAssets()
      .then(setAssets)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    if (selectedTickers.length > 0) next.set('tickers', selectedTickers.join(','))
    else next.delete('tickers')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTickers])

  useEffect(() => {
    const missing = selectedTickers.filter((t) => !analyses[t])
    if (missing.length === 0) return
    setLoading(true)
    setError(null)
    Promise.all(
      missing.map((t) =>
        getAssetAnalysis(t)
          .then((a) => [t, a] as const)
          .catch(() => [t, null] as const),
      ),
    )
      .then((results) => {
        const failed = results.filter(([, a]) => a === null).map(([ticker]) => ticker)
        if (failed.length > 0) {
          setError(t('compare.loadFailedFor', { tickers: failed.join(', ') }))
          setSelectedTickers((prev) => prev.filter((tk) => !failed.includes(tk)))
        }
        setAnalyses((prev) => {
          const next = { ...prev }
          for (const [t, a] of results) if (a) next[t] = a
          return next
        })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTickers])

  const addTicker = (ticker: string) => {
    if (!ticker || selectedTickers.includes(ticker) || selectedTickers.length >= MAX_COMPARE) return
    setSelectedTickers((prev) => [...prev, ticker])
  }

  const removeTicker = (ticker: string) => {
    setSelectedTickers((prev) => prev.filter((t) => t !== ticker))
  }

  const activeAnalyses = useMemo(
    () => selectedTickers.map((t) => analyses[t]).filter((a): a is AssetAnalysis => !!a),
    [selectedTickers, analyses],
  )

  const normalized = useMemo(
    () => buildNormalizedSeries(activeAnalyses, COMPARE_RANGE_DAYS[rangeIndex]),
    [activeAnalyses, rangeIndex],
  )

  return (
    <div>
      <PageHeader icon={GitCompare} title={t('compare.title')} subtitle={t('compare.intro', { max: MAX_COMPARE })} />

      <section className="panel">
        <h2>{t('compare.selectTitle')}</h2>
        <div className="portfolio-row">
          <select
            value=""
            onChange={(e) => {
              addTicker(e.target.value)
              e.target.value = ''
            }}
            aria-label={t('compare.selectAria')}
            disabled={selectedTickers.length >= MAX_COMPARE}
          >
            <option value="">
              {selectedTickers.length >= MAX_COMPARE ? t('compare.maxSelected', { max: MAX_COMPARE }) : t('compare.addAsset')}
            </option>
            {assets
              .filter((a) => !selectedTickers.includes(a.ticker))
              .map((a) => (
                <option key={a.ticker} value={a.ticker}>
                  {a.ticker} — {a.name}
                </option>
              ))}
          </select>
        </div>
        {selectedTickers.length > 0 && (
          <div className="compare-chip-row">
            {selectedTickers.map((tk) => (
              <span key={tk} className="compare-chip">
                <span className="mono">{tk}</span>
                <button type="button" onClick={() => removeTicker(tk)} aria-label={t('compare.removeAria', { ticker: tk })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}

      {selectedTickers.length === 0 && !loading && (
        <EmptyState icon={MousePointerClick}>{t('compare.selectAtLeastTwo')}</EmptyState>
      )}

      {loading && activeAnalyses.length === 0 && (
        <section className="panel">
          <div className="card-grid">
            {Array.from({ length: Math.max(selectedTickers.length, 2) }).map((_, i) => (
              <div className="card" key={i}>
                <Skeleton width={80} height={11} />
                <div style={{ marginTop: 10 }}>
                  <Skeleton width={90} height={22} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeAnalyses.length > 0 && (
        <>
          <section className="panel">
            <div className="card-grid">
              {activeAnalyses.map((a) => (
                <AssetHeaderCard key={a.ticker} analysis={a} onRemove={() => removeTicker(a.ticker)} />
              ))}
            </div>
          </section>

          {activeAnalyses.length >= 2 && normalized.labels.length > 1 && (
            <section className="panel">
              <div className="panel-header-row">
                <h2>{t('compare.normalizedTitle')}</h2>
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
              <p className="muted" style={{ marginBottom: 18 }}>
                {t('compare.normalizedIntro')}
              </p>
              <LineChart labels={normalized.labels} datasets={normalized.datasets} />
            </section>
          )}

          {activeAnalyses.length >= 2 && normalized.labels.length <= 1 && (
            <section className="panel">
              <h2>{t('compare.normalizedTitle')}</h2>
              <p className="muted">{t('compare.insufficientHistory')}</p>
            </section>
          )}

          <section className="panel">
            <h2>{t('compare.riskReturnTitle')}</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('compare.columnMetric')}</th>
                    {activeAnalyses.map((a) => (
                      <th key={a.ticker} className="mono">
                        {a.ticker}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{t('compare.avgDailyReturn')}</td>
                    {activeAnalyses.map((a) => (
                      <td key={a.ticker} className={a.summary.average_return >= 0 ? 'text-up' : 'text-down'}>
                        {formatFraction(a.summary.average_return)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>{t('compare.annualVolatility')}</td>
                    {activeAnalyses.map((a) => (
                      <td key={a.ticker}>{formatFraction(a.summary.volatility)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>{t('compare.maxDrawdown')}</td>
                    {activeAnalyses.map((a) => (
                      <td key={a.ticker} className="text-down">
                        {formatFraction(a.summary.max_drawdown)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>{t('compare.sharpeRatio')}</td>
                    {activeAnalyses.map((a) => (
                      <td key={a.ticker}>{a.summary.sharpe_ratio.toFixed(2)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>{t('compare.technicalsTitle')}</h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              {t('compare.technicalsIntro')}
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('compare.columnIndicator')}</th>
                    {activeAnalyses.map((a) => (
                      <th key={a.ticker} className="mono">
                        {a.ticker}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(['SMA 20', 'SMA 50', 'SMA 200'] as const).map((label, idx) => {
                    const period = [20, 50, 200][idx]
                    return (
                      <tr key={label}>
                        <td>{label}</td>
                        {activeAnalyses.map((a) => {
                          const closes = a.prices.map((p) => p.close_price)
                          const value = lastValue(sma(closes, period))
                          const lastClose = closes[closes.length - 1]
                          const above = value !== null && lastClose !== undefined && lastClose >= value
                          return (
                            <td key={a.ticker} className={value === null ? '' : above ? 'text-up' : 'text-down'}>
                              {value !== null ? formatMoney(value, a.currency) : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  <tr>
                    <td>RSI (14)</td>
                    {activeAnalyses.map((a) => {
                      const closes = a.prices.map((p) => p.close_price)
                      const value = lastValue(rsi(closes, 14))
                      const tone = value === null ? '' : value >= 70 ? 'text-down' : value <= 30 ? 'text-up' : ''
                      return (
                        <td key={a.ticker} className={tone}>
                          {value !== null ? value.toFixed(1) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>{t('compare.performanceTitle')}</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('compare.columnPeriod')}</th>
                    {activeAnalyses.map((a) => (
                      <th key={a.ticker} className="mono">
                        {a.ticker}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERFORMANCE_WINDOWS.map((w) => (
                    <tr key={w.label}>
                      <td>{t(`performanceWindows.${w.label}`)}</td>
                      {activeAnalyses.map((a) => {
                        const ret = periodReturn(
                          a.prices.map((p) => ({ date: p.date, close: p.close_price })),
                          w,
                        )
                        return (
                          <td key={a.ticker} className={ret !== null && ret >= 0 ? 'text-up' : 'text-down'}>
                            {ret !== null ? formatPercentValue(ret) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default AssetComparePage
