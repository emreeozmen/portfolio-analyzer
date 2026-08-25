import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { LayoutGrid, Search, Table2, TrendingDown, TrendingUp, X } from 'lucide-react'
import { BackgroundPlus } from '@/components/ui/background-plus'
import { currentLocale } from '@/lib/locale'
import {
  getAssetAnalysis,
  getAssets,
  rewatchAsset,
  untrackAsset,
  type AssetAnalysis,
  type AssetQuote,
  type AssetSummary,
} from '@/api'
import { getToken } from '@/auth'
import { formatMoney, formatSignedPercent as formatPercent } from '@/lib/currency'
import LineChart from '@/charts/LineChart'
import TickerAvatar from '@/components/TickerAvatar'
import FxTicker from '@/components/FxTicker'
import { useLiveChannel, useLiveSignal } from '@/lib/useLiveChannel'
import { useFlashOnChange } from '@/lib/useFlashOnChange'

interface AssetCardData {
  ticker: string
  name: string
  currency: string
  sector: string | null
  isDefault: boolean
  currentPrice: number
  dailyChangePercent: number
  averageReturn: number
  volatility: number
  maxDrawdown: number
  sparkline: number[]
}

const ACCENT = '#c9a15f'
const UP = '#2fbf76'
const DOWN = '#ec5f66'

// Module-level (not component state) so it survives this component unmounting/remounting
// on every route change — without it, navigating away from Piyasa Görünümü and back re-ran
// a full analysis fetch (price history + metrics) for every displayed asset from scratch,
// which is exactly what made page-to-page navigation feel slow. Cleared implicitly on a
// real page reload (new JS module instance), so it can never show data older than this
// browser tab's current session.
let marketCardsCache: {
  tickers: string[]
  cards: AssetCardData[]
  analyses: Record<string, AssetAnalysis>
  fetchedAt: number
} | null = null
// Matches the backend's own AUTO_REFRESH_INTERVAL_SECONDS (main.py) — no point treating the
// cache as stale sooner than the backend could possibly have written newer data anyway.
const MARKET_CARDS_CACHE_FRESH_MS = 5 * 60 * 1000

function sameTickerSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((ticker, i) => ticker === b[i])
}

function cardFromAnalysis(analysis: AssetAnalysis): AssetCardData {
  const recentPrices = analysis.prices.slice(-30)
  const lastPoint = analysis.prices[analysis.prices.length - 1]

  return {
    ticker: analysis.ticker,
    name: analysis.name,
    currency: analysis.currency,
    sector: analysis.sector ?? null,
    isDefault: analysis.is_default ?? false,
    currentPrice: lastPoint?.close_price ?? 0,
    dailyChangePercent: (lastPoint?.daily_return ?? 0) * 100,
    averageReturn: analysis.summary.average_return * 100,
    volatility: analysis.summary.volatility * 100,
    maxDrawdown: analysis.summary.max_drawdown * 100,
    sparkline: recentPrices.map((p) => p.close_price),
  }
}

function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    update()

    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  return [ref, size]
}

const ProfessionalCard: React.FC<{ isActive?: boolean; children: React.ReactNode }> = ({ isActive, children }) => (
  <div className="relative w-full max-w-sm mx-auto">
    <BackgroundPlus className="absolute inset-0 rounded-2xl opacity-10" plusColor={isActive ? ACCENT : 'var(--border-strong)'} plusSize={40} fade />
    <div className="relative rounded-2xl border border-border-strong bg-surface/95 backdrop-blur-sm shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
      <div className="relative z-10 p-4">{children}</div>
    </div>
  </div>
)

const InteractiveChart: React.FC<{ data: number[]; positive: boolean; currency: string }> = ({ data, positive, currency }) => {
  const [containerRef, { width }] = useElementSize<HTMLDivElement>()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const desiredHeight = 140
  const padding = { top: 10, right: 8, bottom: 8, left: 8 }
  const innerW = Math.max(0, width - padding.left - padding.right)
  const innerH = Math.max(0, desiredHeight - padding.top - padding.bottom)

  const minV = Math.min(...data)
  const maxV = Math.max(...data)
  const range = maxV - minV || 1

  const points = useMemo(() => {
    const xFor = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW)
    const yFor = (v: number) => innerH - ((v - minV) / range) * innerH
    return data.map((v, i) => [xFor(i), yFor(v)] as const)
  }, [data, innerW, innerH, minV, range])
  const linePath = useMemo(
    () => points.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' '),
    [points],
  )
  const areaPath = points.length > 1 ? `${linePath} L ${innerW} ${innerH} L 0 ${innerH} Z` : ''

  const color = positive ? UP : DOWN
  const gradId = `spark-grad-${positive ? 'pos' : 'neg'}`

  const handlePointer = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left - padding.left
    if (x < 0 || x > innerW) {
      setHoverIdx(null)
      return
    }
    const ratio = x / innerW
    setHoverIdx(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))))
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full cursor-crosshair"
      style={{ height: desiredHeight }}
      onMouseMove={(e) => handlePointer(e.clientX)}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg width={width} height={desiredHeight} className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <g transform={`translate(${padding.left},${padding.top})`}>
          {areaPath && <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />}
          <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          {hoverIdx !== null && points[hoverIdx] && (
            <>
              <line x1={points[hoverIdx][0]} y1={0} x2={points[hoverIdx][0]} y2={innerH} stroke={ACCENT} strokeDasharray="3 3" strokeWidth={1} opacity={0.6} />
              <circle cx={points[hoverIdx][0]} cy={points[hoverIdx][1]} r={4} fill="var(--surface)" stroke={ACCENT} strokeWidth={2} />
            </>
          )}
        </g>
      </svg>

      {hoverIdx !== null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute top-0 right-0 rounded-md border border-border-strong bg-surface-2/95 px-2 py-1 text-xs shadow-md"
        >
          <span className="font-semibold text-text-h">{formatMoney(data[hoverIdx], currency)}</span>
        </motion.div>
      )}
    </div>
  )
}

const AssetPickerModal: React.FC<{
  isOpen: boolean
  onClose: () => void
  availableAssets: AssetSummary[]
  onAdd: (ticker: string) => void
}> = ({ isOpen, onClose, availableAssets, onAdd }) => {
  const { t } = useTranslation('market')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const filtered = availableAssets.filter(
    (a) => a.ticker.toLowerCase().includes(query.toLowerCase()) || a.name.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-xl border border-border-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        // A real native <dialog> would fight framer-motion's AnimatePresence
        // enter/exit animation (imperative showModal()/close() vs. declarative
        // mount/unmount) — role="dialog" + aria-modal on the animated div is the
        // standard accessible-modal pattern for this case.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="dialog"
        aria-modal="true"
        aria-label={t('dashboard.pickerAria')}
      >
        <div className="border-b border-border-strong p-4">
          <input
            type="text"
            placeholder={t('dashboard.pickerPlaceholder')}
            aria-label={t('dashboard.pickerSearchAria')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-text-h placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-primary/60"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((asset) => (
              <button
                key={asset.ticker}
                type="button"
                onClick={() => {
                  onAdd(asset.ticker)
                  onClose()
                  setQuery('')
                }}
                className="flex w-full items-center gap-3 border-b border-border p-3 text-left transition-colors hover:bg-surface-2"
              >
                <TickerAvatar ticker={asset.ticker} size={32} />
                <div>
                  <div className="font-medium text-text-h">{asset.ticker}</div>
                  <div className="text-sm text-text-muted">{asset.name}</div>
                </div>
              </button>
            ))
          ) : (
            <div className="p-6 text-center text-text-muted">{t('dashboard.pickerEmpty')}</div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

const AssetCard: React.FC<{ asset: AssetCardData; onRemove: (ticker: string) => void; delay?: number }> = memo(
  ({ asset, onRemove, delay = 0 }) => {
  const { t } = useTranslation('market')
  const [isActive, setIsActive] = useState(false)
  const isPositive = asset.dailyChangePercent >= 0
  const flash = useFlashOnChange(asset.currentPrice)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ delay, duration: 0.3, ease: 'easeOut' }}
      whileHover={{ scale: 1.02 }}
      onMouseEnter={() => setIsActive(true)}
      onMouseLeave={() => setIsActive(false)}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onRemove(asset.ticker)}
        className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border-strong bg-surface-2 text-text-muted opacity-0 shadow-sm transition-opacity hover:text-danger group-hover:opacity-100"
        aria-label={t('dashboard.removeCardAria', { ticker: asset.ticker })}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <ProfessionalCard isActive={isActive}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div whileHover={{ rotate: 5, scale: 1.1 }}>
              <TickerAvatar ticker={asset.ticker} size={40} />
            </motion.div>
            <Link to={`/assets/${asset.ticker}`} className="min-w-0 hover:opacity-80">
              <h3 className="truncate text-base font-bold text-text-h font-mono">{asset.ticker}</h3>
              <p className="truncate text-xs font-medium tracking-wide text-text-muted">{asset.name}</p>
              {asset.sector && (
                <span className="mt-1 inline-block truncate rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  {asset.sector}
                </span>
              )}
            </Link>
          </div>
          <div className="text-right">
            <motion.div
              className={`font-mono text-lg font-bold text-text-h ${flash}`}
              animate={{ scale: isActive ? 1.05 : 1 }}
            >
              {formatMoney(asset.currentPrice, asset.currency)}
            </motion.div>
            <div className={`flex items-center justify-end gap-1 font-mono text-xs font-semibold ${isPositive ? 'text-success' : 'text-danger'}`}>
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {formatPercent(asset.dailyChangePercent)}
            </div>
          </div>
        </div>

        <div className="mb-3 overflow-hidden rounded-lg border border-border bg-gradient-to-br from-bg to-surface">
          <InteractiveChart data={asset.sparkline} positive={isPositive} currency={asset.currency} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{t('dashboard.avgReturn')}</div>
            <div className="font-mono text-xs font-bold text-text-h">{formatPercent(asset.averageReturn)}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{t('dashboard.volatility')}</div>
            <div className="font-mono text-xs font-bold text-text-h">{asset.volatility.toFixed(2)}%</div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-text-muted">{t('dashboard.maxDrawdown')}</div>
            <div className="font-mono text-xs font-bold text-danger">{asset.maxDrawdown.toFixed(2)}%</div>
          </div>
        </div>
      </ProfessionalCard>
    </motion.div>
  )
  },
)

const AssetTableRow: React.FC<{ asset: AssetCardData; onRemove: (ticker: string) => void }> = memo(
  ({ asset: a, onRemove }) => {
  const { t } = useTranslation('market')
  const flash = useFlashOnChange(a.currentPrice)

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2">
      <td className="px-4 py-3">
        <Link to={`/assets/${a.ticker}`} className="flex items-center gap-3">
          <TickerAvatar ticker={a.ticker} size={30} />
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold text-text-h">{a.ticker}</div>
            <div className="truncate text-xs text-text-muted">{a.name}</div>
          </div>
        </Link>
      </td>
      <td className={`px-4 py-3 text-right font-mono text-text-h ${flash}`}>{formatMoney(a.currentPrice, a.currency)}</td>
      <td
        className={`px-4 py-3 text-right font-mono font-semibold ${
          a.dailyChangePercent >= 0 ? 'text-success' : 'text-danger'
        }`}
      >
        {formatPercent(a.dailyChangePercent)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-text">{formatPercent(a.averageReturn)}</td>
      <td className="px-4 py-3 text-right font-mono text-text">{a.volatility.toFixed(2)}%</td>
      <td className="px-4 py-3 text-right font-mono text-danger">{a.maxDrawdown.toFixed(2)}%</td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => onRemove(a.ticker)}
          className="rounded-md p-1.5 text-text-faint transition-colors hover:bg-surface-3 hover:text-danger"
          aria-label={t('dashboard.removeAria', { ticker: a.ticker })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
  },
)

const AssetTable: React.FC<{ assets: AssetCardData[]; onRemove: (ticker: string) => void }> = ({ assets, onRemove }) => {
  const { t } = useTranslation('market')
  return (
    <div className="overflow-x-auto rounded-2xl border border-border-strong bg-surface/95 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border-strong text-left text-[11px] uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-medium">{t('dashboard.columnAsset')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('dashboard.columnPrice')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('dashboard.columnDailyChange')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('dashboard.avgReturn')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('dashboard.volatility')}</th>
            <th className="px-4 py-3 text-right font-medium">{t('dashboard.maxDrawdown')}</th>
            <th scope="col" className="px-4 py-3 sr-only">
              {t('dashboard.columnActions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <AssetTableRow key={a.ticker} asset={a} onRemove={onRemove} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================= Comparison section ============================= */

type CompareRange = '1M' | '3M' | '6M' | '1Y' | 'ALL'
const COMPARE_RANGES: CompareRange[] = ['1M', '3M', '6M', '1Y', 'ALL']
const COMPARE_MONTHS: Record<CompareRange, number | null> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, ALL: null }

function buildComparisonSeries(
  analyses: Record<string, AssetAnalysis>,
  tickers: string[],
  range: CompareRange,
): { labels: string[]; datasets: { label: string; data: (number | null)[] }[] } {
  const perTicker: Record<string, Map<string, number>> = {}
  let allDates = new Set<string>()

  for (const ticker of tickers) {
    const analysis = analyses[ticker]
    if (!analysis || analysis.prices.length === 0) continue

    const months = COMPARE_MONTHS[range]
    let prices = analysis.prices
    if (months !== null) {
      const lastDate = new Date(prices[prices.length - 1].date)
      const cutoff = new Date(lastDate)
      cutoff.setMonth(cutoff.getMonth() - months)
      prices = prices.filter((p) => new Date(p.date) >= cutoff)
    }
    if (prices.length === 0) continue

    const basePrice = prices[0].close_price
    const map = new Map<string, number>()
    for (const p of prices) {
      map.set(p.date, ((p.close_price - basePrice) / basePrice) * 100)
      allDates.add(p.date)
    }
    perTicker[ticker] = map
  }

  const labels = Array.from(allDates).sort()
  const datasets = tickers
    .filter((t) => perTicker[t])
    .map((t) => {
      const map = perTicker[t]
      // The x-axis is the UNION of every selected ticker's trading dates, so a
      // ticker whose market didn't trade on a given day (a different exchange's
      // holiday, a newer/thinner symbol, a 24/7 crypto series next to a 5-day
      // equity one, ...) has no entry for that date. Leaving those as gaps made
      // Chart.js break the line there — the more tickers selected, the more
      // calendar mismatches, the more "kesikli" the chart looked. Carry the
      // last known normalized value forward instead (flat over non-trading
      // days), which is how comparison charts on other market-data sites
      // render mismatched calendars. Only the days *before* a ticker's own
      // first data point stay null, so its line correctly starts late rather
      // than being back-filled into a period it has no data for.
      let lastValue: number | null = null
      const data = labels.map((d) => {
        const v = map.get(d)
        if (v !== undefined) {
          lastValue = v
        }
        return lastValue
      })
      return { label: t, data }
    })

  return { labels, datasets }
}

function formatCompareLabel(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(currentLocale(), { day: '2-digit', month: 'short' })
}

const ComparisonPanel: React.FC<{ analyses: Record<string, AssetAnalysis>; tickers: string[] }> = ({ analyses, tickers }) => {
  const { t } = useTranslation('market')
  const [range, setRange] = useState<CompareRange>('6M')
  const [activeTickers, setActiveTickers] = useState<string[]>(tickers)

  useEffect(() => {
    setActiveTickers((prev) => {
      const stillValid = prev.filter((t) => tickers.includes(t))
      const additions = tickers.filter((t) => !prev.includes(t))
      return [...stillValid, ...additions]
    })
  }, [tickers])

  const toggleTicker = (ticker: string) => {
    setActiveTickers((prev) => (prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker]))
  }

  const { labels, datasets } = useMemo(
    () => buildComparisonSeries(analyses, activeTickers, range),
    [analyses, activeTickers, range],
  )

  return (
    <div className="mt-10 rounded-2xl border border-border-strong bg-surface/95 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.45)] sm:p-7">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-h">{t('dashboard.comparisonTitle')}</h2>
          <p className="mt-1 text-sm text-text-muted">{t('dashboard.comparisonIntro')}</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border-strong bg-surface-2 p-1">
          {COMPARE_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                r === range ? 'bg-primary text-primary-ink' : 'text-text-muted hover:text-text-h'
              }`}
            >
              {r === 'ALL' ? t('dashboard.comparisonAll') : r}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {tickers.map((t) => {
          const isOn = activeTickers.includes(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleTicker(t)}
              className={`rounded-full border px-3 py-1.5 font-mono text-xs font-semibold transition-colors ${
                isOn
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border-strong bg-transparent text-text-muted hover:text-text'
              }`}
            >
              {t}
            </button>
          )
        })}
      </div>

      {datasets.length > 0 ? (
        <div style={{ height: 340 }}>
          <LineChart labels={labels.map(formatCompareLabel)} datasets={datasets} />
        </div>
      ) : (
        <div className="flex h-52 items-center justify-center text-sm text-text-muted">
          {t('dashboard.comparisonEmpty')}
        </div>
      )}
    </div>
  )
}

/* ============================= Main dashboard ============================= */

type SortKey = 'change-desc' | 'change-asc' | 'name' | 'volatility'
type ViewMode = 'cards' | 'table'

const SORT_LABEL_KEYS: Record<SortKey, string> = {
  'change-desc': 'dashboard.sortLabels.changeDesc',
  'change-asc': 'dashboard.sortLabels.changeAsc',
  name: 'dashboard.sortLabels.name',
  volatility: 'dashboard.sortLabels.volatility',
}

function sortCards(cards: AssetCardData[], sortKey: SortKey): AssetCardData[] {
  const sorted = [...cards]
  switch (sortKey) {
    case 'name':
      return sorted.sort((a, b) => a.ticker.localeCompare(b.ticker))
    case 'change-asc':
      return sorted.sort((a, b) => a.dailyChangePercent - b.dailyChangePercent)
    case 'volatility':
      return sorted.sort((a, b) => b.volatility - a.volatility)
    case 'change-desc':
    default:
      return sorted.sort((a, b) => b.dailyChangePercent - a.dailyChangePercent)
  }
}

const AssetMarketDashboard: React.FC = () => {
  const { t } = useTranslation('market')
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([])
  const [cards, setCards] = useState<AssetCardData[]>(marketCardsCache?.cards ?? [])
  const [analysesByTicker, setAnalysesByTicker] = useState<Record<string, AssetAnalysis>>(
    marketCardsCache?.analyses ?? {},
  )
  const [displayedTickers, setDisplayedTickers] = useState<string[]>([])
  const [loading, setLoading] = useState(marketCardsCache === null)
  const [error, setError] = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('change-desc')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(
    marketCardsCache ? new Date(marketCardsCache.fetchedAt) : null,
  )

  useEffect(() => {
    getAssets()
      .then((assets) => {
        setAllAssets(assets)
        setDisplayedTickers(assets.map((a) => a.ticker))
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const reloadCards = useCallback(
    (opts?: { force?: boolean }) => {
      if (displayedTickers.length === 0) {
        setCards([])
        setLoading(false)
        return
      }
      // Skip the network round-trip entirely if we already have fresh data for this exact
      // ticker set — e.g. the user navigated away from Piyasa Görünümü and back within the
      // same session. Without this, every mount re-fetched every asset's full analysis
      // (price history + metrics) from scratch, which is what made page-to-page navigation
      // feel slow. A "prices-updated" broadcast passes force:true to bypass this.
      if (
        !opts?.force &&
        marketCardsCache &&
        sameTickerSet(marketCardsCache.tickers, displayedTickers) &&
        Date.now() - marketCardsCache.fetchedAt < MARKET_CARDS_CACHE_FRESH_MS
      ) {
        return
      }
      setLoading(true)
      // allSettled, not all — a single slow/failing ticker (e.g. mid cold-start) would
      // otherwise block every other already-successful card from ever appearing, since
      // Promise.all rejects (and, worse, a hung request with no timeout would never even
      // settle) as soon as/unless every request does. Cards for whichever tickers
      // succeeded are shown regardless of the rest.
      Promise.allSettled(displayedTickers.map((ticker) => getAssetAnalysis(ticker)))
        .then((results) => {
          const analyses = results
            .filter((r): r is PromiseFulfilledResult<AssetAnalysis> => r.status === 'fulfilled')
            .map((r) => r.value)
          const nextCards = analyses.map(cardFromAnalysis)
          setCards(nextCards)
          setAnalysesByTicker((prev) => {
            const next = { ...prev }
            for (const a of analyses) next[a.ticker] = a
            return next
          })
          setError(analyses.length === 0 && results.length > 0 ? t('dashboard.loadError') : null)
          const now = new Date()
          setLastUpdated(now)
          marketCardsCache = {
            tickers: displayedTickers,
            cards: nextCards,
            analyses: Object.fromEntries(analyses.map((a) => [a.ticker, a])),
            fetchedAt: now.getTime(),
          }
        })
        .finally(() => setLoading(false))
    },
    [displayedTickers, t],
  )

  useEffect(() => {
    reloadCards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedTickers])

  // Full reload (sparkline + all metrics) only when the backend actually wrote new
  // price data (~5 min), not a blind 60s poll — live price/change in between comes
  // from the cheaper "quotes" channel merge below. Forced regardless of the cache above,
  // since this signal specifically means the cached data is now stale.
  useLiveSignal('prices-updated', () => reloadCards({ force: true }))

  const liveQuotes = useLiveChannel<AssetQuote[]>('quotes')
  useEffect(() => {
    if (!liveQuotes) return
    const byTicker = new Map(liveQuotes.map((q) => [q.ticker, q]))
    setCards((prev) =>
      prev.map((card) => {
        const q = byTicker.get(card.ticker)
        return q ? { ...card, currentPrice: q.last_price, dailyChangePercent: q.change_percent } : card
      }),
    )
  }, [liveQuotes])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsPickerOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleAdd = useCallback(
    (ticker: string) => {
      setDisplayedTickers((prev) => (prev.includes(ticker) ? prev : [...prev, ticker]))

      // Re-surfacing a previously-untracked asset from the picker should persist
      // too, not just show it again for this session — otherwise it silently
      // vanishes again on the next reload.
      const isDefault = allAssets.find((a) => a.ticker === ticker)?.is_default
      if (isDefault) return
      if (!getToken()) return

      rewatchAsset(ticker).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    },
    [allAssets],
  )

  const handleRemove = useCallback(
    (ticker: string) => {
      setDisplayedTickers((prev) => prev.filter((t) => t !== ticker))

      // Default assets aren't in anyone's personal watchlist — removing one only
      // hides it for this browser session, same as before. A user-tracked asset is
      // untracked for real, so it doesn't come back after a reload/relogin.
      const isDefault = allAssets.find((a) => a.ticker === ticker)?.is_default
      if (isDefault) return
      if (!getToken()) return

      untrackAsset(ticker).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    },
    [allAssets],
  )

  const availableToAdd = allAssets.filter((a) => !displayedTickers.includes(a.ticker))

  const visibleCards = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? cards.filter((c) => c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      : cards
    return sortCards(filtered, sortKey)
  }, [cards, query, sortKey])

  if (loading && cards.length === 0) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
          <p className="text-text-muted">{t('dashboard.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <BackgroundPlus className="fixed inset-0 -z-10 opacity-20" plusColor={ACCENT} plusSize={60} fade />

      <div className="mb-8 text-center sm:mb-12">
        <motion.h1
          className="mb-4 text-3xl font-bold tracking-tight text-text-h sm:text-4xl"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {t('dashboard.title')}
        </motion.h1>
        <motion.p
          className="mx-auto max-w-2xl text-base text-text-muted"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          {t('dashboard.subtitle')}
        </motion.p>

        {error && (
          <motion.div
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-amber-300"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {error}
          </motion.div>
        )}

        <motion.div
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          {availableToAdd.length > 0 && (
            <motion.button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="inline-flex items-center gap-3 rounded-xl border border-border-strong bg-surface-2 px-6 py-3 text-text-h shadow-lg transition-all hover:border-primary/40"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Search className="h-4 w-4" />
              <span className="font-medium">{t('dashboard.addAsset')}</span>
              <kbd className="hidden rounded-md border border-border-strong bg-bg px-2 py-1 font-mono text-xs text-text-muted sm:inline-block">
                ⌘K
              </kbd>
            </motion.button>
          )}
        </motion.div>
      </div>

      <FxTicker />

      {cards.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-text-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              className="w-full bg-transparent text-sm text-text-h placeholder:text-text-faint focus:outline-none"
              aria-label={t('dashboard.searchAria')}
            />
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border border-border-strong bg-surface-2 px-3 py-2.5 text-sm text-text-h focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label={t('dashboard.sortAria')}
          >
            {(Object.keys(SORT_LABEL_KEYS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {t(SORT_LABEL_KEYS[key])}
              </option>
            ))}
          </select>

          <div className="flex rounded-xl border border-border-strong bg-surface-2 p-1">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'cards' ? 'bg-primary text-primary-ink' : 'text-text-muted hover:text-text-h'
              }`}
              aria-pressed={viewMode === 'cards'}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> {t('dashboard.viewCards')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'table' ? 'bg-primary text-primary-ink' : 'text-text-muted hover:text-text-h'
              }`}
              aria-pressed={viewMode === 'table'}
            >
              <Table2 className="h-3.5 w-3.5" /> {t('dashboard.viewTable')}
            </button>
          </div>

          {lastUpdated && (
            <div className="live-indicator whitespace-nowrap" title={t('dashboard.refreshHint')}>
              <span className="live-indicator-dot" />
              {t('dashboard.lastUpdated', {
                time: lastUpdated.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }),
              })}
            </div>
          )}
        </div>
      )}

      {visibleCards.length === 0 && cards.length > 0 && (
        <div className="rounded-2xl border border-border-strong bg-surface/95 p-10 text-center text-text-muted">
          {t('dashboard.noMatch', { query })}
        </div>
      )}

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 lg:gap-8">
          <AnimatePresence mode="popLayout">
            {visibleCards.map((asset, index) => (
              <AssetCard key={asset.ticker} asset={asset} onRemove={handleRemove} delay={index * 0.08} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        visibleCards.length > 0 && <AssetTable assets={visibleCards} onRemove={handleRemove} />
      )}

      {cards.length > 0 && <ComparisonPanel analyses={analysesByTicker} tickers={displayedTickers} />}

      <AnimatePresence>
        {isPickerOpen && (
          <AssetPickerModal isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} availableAssets={availableToAdd} onAdd={handleAdd} />
        )}
      </AnimatePresence>
    </div>
  )
}

export default AssetMarketDashboard
