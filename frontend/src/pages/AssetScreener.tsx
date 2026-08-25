import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getAssetAnalysis, getAssets, type AssetAnalysis, type AssetQuote, type AssetSummary } from '../api'
import { Inbox } from 'lucide-react'
import TickerAvatar from '../components/TickerAvatar'
import Skeleton from '../components/Skeleton'
import Sparkline from '../components/Sparkline'
import EmptyState from '../components/EmptyState'
import { formatMoney, formatSignedPercent as formatPercent } from '../lib/currency'
import { currentLocale } from '../lib/locale'
import i18n from '../i18n'
import { useLiveChannel } from '../lib/useLiveChannel'
import { useFlashOnChange } from '../lib/useFlashOnChange'

function unknownSector(): string {
  return i18n.t('notAvailable', { ns: 'common' })
}

interface ScreenerRow {
  ticker: string
  name: string
  currency: string
  sector: string
  lastPrice: number
  dailyChangePercent: number
  averageReturn: number
  volatility: number
  sharpeRatio: number
  maxDrawdown: number
  sparkline: number[]
}

type SortKey = keyof Pick<
  ScreenerRow,
  'lastPrice' | 'dailyChangePercent' | 'averageReturn' | 'volatility' | 'sharpeRatio' | 'maxDrawdown'
>

function rowFromAnalysis(analysis: AssetAnalysis): ScreenerRow {
  const last = analysis.prices[analysis.prices.length - 1]
  return {
    ticker: analysis.ticker,
    name: analysis.name,
    currency: analysis.currency,
    sector: analysis.sector ?? unknownSector(),
    lastPrice: last?.close_price ?? 0,
    dailyChangePercent: (last?.daily_return ?? 0) * 100,
    averageReturn: analysis.summary.average_return * 100,
    volatility: analysis.summary.volatility * 100,
    sharpeRatio: analysis.summary.sharpe_ratio,
    maxDrawdown: analysis.summary.max_drawdown * 100,
    sparkline: analysis.prices.slice(-20).map((p) => p.close_price),
  }
}

const ScreenerRowView = memo(function ScreenerRowView({
  row,
  checked,
  onToggleCompare,
}: {
  row: ScreenerRow
  checked: boolean
  onToggleCompare: (ticker: string) => void
}) {
  const { t } = useTranslation('assets')
  const flash = useFlashOnChange(row.lastPrice)

  return (
    <tr>
      <td onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCompare(row.ticker)}
          aria-label={t('screener.compareAria', { ticker: row.ticker })}
        />
      </td>
      <td>
        <Link to={`/assets/${row.ticker}`} className="screener-symbol-link">
          <TickerAvatar ticker={row.ticker} size={30} />
          <span>
            <span className="screener-ticker">{row.ticker}</span>
            <span className="screener-name">{row.name}</span>
          </span>
        </Link>
      </td>
      <td className="screener-sector">{row.sector}</td>
      <td>
        <Sparkline data={row.sparkline} />
      </td>
      <td className={`mono ${flash}`}>{formatMoney(row.lastPrice, row.currency)}</td>
      <td className={`mono ${row.dailyChangePercent >= 0 ? 'text-up' : 'text-down'}`}>
        {formatPercent(row.dailyChangePercent)}
      </td>
      <td className={`mono ${row.averageReturn >= 0 ? 'text-up' : 'text-down'}`}>
        {formatPercent(row.averageReturn)}
      </td>
      <td className="mono">{row.volatility.toFixed(2)}%</td>
      <td className="mono">{row.sharpeRatio.toFixed(2)}</td>
      <td className="mono text-down">{row.maxDrawdown.toFixed(2)}%</td>
    </tr>
  )
})

const MAX_COMPARE_SELECTION = 4

function AssetScreenerPage() {
  const { t } = useTranslation('assets')
  const COLUMNS: { key: SortKey; label: string }[] = [
    { key: 'lastPrice', label: t('screener.columnLast') },
    { key: 'dailyChangePercent', label: t('screener.columnChangePercent') },
    { key: 'averageReturn', label: t('screener.columnAvgReturn') },
    { key: 'volatility', label: t('screener.columnVolatility') },
    { key: 'sharpeRatio', label: t('screener.columnSharpe') },
    { key: 'maxDrawdown', label: t('screener.columnMaxDrawdown') },
  ]
  const navigate = useNavigate()
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [rows, setRows] = useState<ScreenerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('dailyChangePercent')
  const [sortDesc, setSortDesc] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [sectorFilter, setSectorFilter] = useState<string>('all')
  const [compareSelection, setCompareSelection] = useState<string[]>([])

  const toggleCompare = useCallback((ticker: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(ticker)) return prev.filter((t) => t !== ticker)
      if (prev.length >= MAX_COMPARE_SELECTION) return prev
      return [...prev, ticker]
    })
  }, [])

  const liveQuotes = useLiveChannel<AssetQuote[]>('quotes')

  const load = useCallback(
    (showSpinner: boolean) => {
      if (showSpinner) setLoading(true)
      getAssets()
        .then((data) => {
          setAssets(data)
          // allSettled, not all — a single slow/failing ticker (e.g. mid backend
          // cold-start) would otherwise block every other already-successful row from
          // ever appearing, since Promise.all only resolves once every request does.
          return Promise.allSettled(data.map((a) => getAssetAnalysis(a.ticker)))
        })
        .then((results) => {
          const analyses = results
            .filter((r): r is PromiseFulfilledResult<AssetAnalysis> => r.status === 'fulfilled')
            .map((r) => r.value)
          setRows(analyses.map(rowFromAnalysis))
          setLastUpdated(new Date())
          setError(analyses.length === 0 && results.length > 0 ? t('screener.loadError') : null)
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false))
    },
    [t],
  )

  useEffect(() => {
    load(true)
  }, [load])

  useEffect(() => {
    // Live price/day-change only — volatility/Sharpe/etc. are computed over the full
    // price history and don't meaningfully move between one day's close and the next,
    // so they're left as of the last full load() rather than recomputed on every push.
    if (!liveQuotes) return
    const byTicker = new Map(liveQuotes.map((q) => [q.ticker, q]))
    setRows((prev) =>
      prev.map((row) => {
        const q = byTicker.get(row.ticker)
        return q ? { ...row, lastPrice: q.last_price, dailyChangePercent: q.change_percent } : row
      }),
    )
    setLastUpdated(new Date())
  }, [liveQuotes])

  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector))).sort(), [rows])

  const sortedRows = useMemo(() => {
    const filtered = sectorFilter === 'all' ? rows : rows.filter((r) => r.sector === sectorFilter)
    const copy = [...filtered]
    copy.sort((a, b) => (a[sortKey] - b[sortKey]) * (sortDesc ? -1 : 1))
    return copy
  }, [rows, sortKey, sortDesc, sectorFilter])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDesc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  return (
    <div>
      <h1>{t('screener.title')}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t('screener.intro')}
      </p>
      {lastUpdated && (
        <div className="live-indicator" style={{ marginBottom: 20 }}>
          <span className="live-indicator-dot" />
          {t('screener.lastUpdated', {
            time: lastUpdated.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }),
          })}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {loading && (
        <div className="panel screener-panel">
          <div className="table-scroll">
            <table className="screener-table">
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Skeleton width={16} height={16} />
                    </td>
                    <td>
                      <div className="skeleton-row" style={{ padding: 0 }}>
                        <Skeleton className="skeleton-avatar" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                          <Skeleton width={70} height={13} />
                          <Skeleton width={110} height={11} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <Skeleton width={70} height={13} />
                    </td>
                    <td>
                      <Skeleton width={72} height={26} />
                    </td>
                    <td>
                      <Skeleton width={60} height={13} />
                    </td>
                    <td>
                      <Skeleton width={60} height={13} />
                    </td>
                    <td>
                      <Skeleton width={60} height={13} />
                    </td>
                    <td>
                      <Skeleton width={50} height={13} />
                    </td>
                    <td>
                      <Skeleton width={60} height={13} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && (sectors.length > 1 || compareSelection.length > 0) && (
        <div className="toolbar">
          {sectors.length > 1 && (
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              aria-label={t('screener.sectorFilterAria')}
            >
              <option value="all">{t('screener.allSectors')}</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {compareSelection.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => navigate(`/karsilastir?tickers=${compareSelection.join(',')}`)}
            >
              {t('screener.compare', { count: compareSelection.length })}
            </button>
          )}
        </div>
      )}

      {!loading && (
        <div className="panel screener-panel">
          <div className="table-scroll">
            <table className="screener-table">
              <thead>
                <tr>
                  <th scope="col" className="sr-only">
                    {t('screener.columnCompare')}
                  </th>
                  <th>{t('screener.columnSymbol')}</th>
                  <th>{t('screener.columnSector')}</th>
                  <th>{t('screener.columnTrend')}</th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="screener-sortable"
                      onClick={() => handleSort(col.key)}
                    >
                      {col.label}
                      {sortKey === col.key && <span className="screener-sort-arrow">{sortDesc ? ' ▼' : ' ▲'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <ScreenerRowView
                    key={row.ticker}
                    row={row}
                    checked={compareSelection.includes(row.ticker)}
                    onToggleCompare={toggleCompare}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && assets.length === 0 && <EmptyState icon={Inbox}>{t('screener.noAssets')}</EmptyState>}
      {!loading && assets.length > 0 && rows.length === 0 && (
        <p className="muted">{t('screener.loadFailed')}</p>
      )}
    </div>
  )
}

export default AssetScreenerPage
