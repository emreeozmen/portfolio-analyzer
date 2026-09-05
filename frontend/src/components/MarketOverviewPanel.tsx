import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { currentLocale } from '../lib/locale'
import {
  getBist100History,
  getCommodities,
  getCryptoGlobalStats,
  getCryptoQuotes,
  getFxQuotes,
  getInflationByCountry,
  getMajorIndices,
  getTickerStrip,
  type CryptoGlobalStats,
  type CryptoQuote,
  type FxQuote,
  type IndexHistoryPoint,
  type TickerStripQuote,
} from '../api'
import TickerAvatar from './TickerAvatar'
import LineChart from '../charts/LineChart'
import { useLiveChannel } from '../lib/useLiveChannel'
import { formatSignedPercent as formatChange } from '../lib/currency'

const HERO_RANGE_DAYS = [21, 63, 126, 252, Infinity] as const
const HERO_RANGE_LABELS = ['1A', '3A', '6A', '1Y'] as const

function formatCompactUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toFixed(0)}`
}

function formatIndexValue(v: number): string {
  return v.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The homepage's "at a glance" market overview: a hero index chart, major world
 * indices, a crypto market summary (including a real BTC/ETH/other dominance bar),
 * FX + commodities, and Turkey's published inflation rate. Every figure here is real
 * — either live (Yahoo Finance via the existing /markets endpoints, CoinGecko's
 * key-less /global endpoint) or, for inflation, the latest published annual rate
 * (inflation is never a live/intraday figure anywhere). No TR 10Y bond yield or TCMB
 * policy-rate card: neither has a real, verifiable, key-less data source (checked
 * against Yahoo Finance and TCMB's EVDS v3 API, which requires a personal account/key
 * and doesn't expose a meeting-calendar endpoint), so rather than guess a number,
 * those cards are simply omitted.
 */
function HeroIndexCard() {
  const { t } = useTranslation('market')
  const rangeLabels = [...HERO_RANGE_LABELS, t('heroRanges.all')]
  const [history, setHistory] = useState<IndexHistoryPoint[]>([])
  const [initialStrip, setInitialStrip] = useState<TickerStripQuote[]>([])
  const [rangeIndex, setRangeIndex] = useState(HERO_RANGE_DAYS.length - 1)
  const [error, setError] = useState(false)
  const liveStrip = useLiveChannel<TickerStripQuote[]>('ticker-strip')

  useEffect(() => {
    // The year of daily closes behind the chart is historical, not a live feed — fetched
    // once. The current value/change badge, on the other hand, updates live below.
    Promise.all([getBist100History(), getTickerStrip()])
      .then(([h, s]) => {
        setHistory(h)
        setInitialStrip(s)
      })
      .catch(() => setError(true))
  }, [])

  // Prefer the live WebSocket value over the one-time initial fetch, without mirroring
  // it into its own state — syncing a derived value via a second effect just costs an
  // extra render pass every time a live tick arrives, for no benefit over deriving it
  // directly during render.
  const strip = liveStrip ?? initialStrip
  const bist100 = strip.find((s) => s.symbol === 'XU100.IS')

  const days = HERO_RANGE_DAYS[rangeIndex]
  const sliced = Number.isFinite(days) ? history.slice(-days) : history

  if (error || (history.length === 0 && !bist100)) return null

  return (
    <div className="market-overview-hero">
      <div className="market-overview-hero-header">
        <div>
          <div className="market-overview-hero-label">BIST 100</div>
          {bist100 && (
            <div className="market-overview-hero-price-row">
              <span className="market-overview-hero-price mono">{formatIndexValue(bist100.value)}</span>
              <span className={`candle-change ${bist100.change_percent >= 0 ? 'is-up' : 'is-down'}`}>
                {bist100.change_percent >= 0 ? '▲' : '▼'} {formatChange(bist100.change_percent)}
              </span>
            </div>
          )}
        </div>
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
      {sliced.length > 1 && (
        <LineChart
          labels={sliced.map((p) => p.date)}
          datasets={[{ label: 'BIST 100', data: sliced.map((p) => p.close), fillToDatasetIndex: 'origin' }]}
        />
      )}
    </div>
  )
}

function MajorIndicesCard() {
  const { t } = useTranslation('market')
  const [initialIndices, setInitialIndices] = useState<TickerStripQuote[]>([])
  const live = useLiveChannel<TickerStripQuote[]>('indices')

  useEffect(() => {
    getMajorIndices().then(setInitialIndices).catch(() => {})
  }, [])

  const indices = live ?? initialIndices

  if (indices.length === 0) return null

  return (
    <div className="market-overview-card">
      <h3>{t('majorIndices.title')}</h3>
      <ul className="market-overview-list">
        {indices.map((idx) => (
          <li key={idx.symbol} className="market-overview-list-row">
            <span className="market-overview-list-symbol">
              <TickerAvatar ticker={idx.label} size={26} />
              <span>{idx.label}</span>
            </span>
            <span className="mono">{formatIndexValue(idx.value)}</span>
            <span className={`mono ${idx.change_percent >= 0 ? 'text-up' : 'text-down'}`}>
              {formatChange(idx.change_percent)}
            </span>
          </li>
        ))}
      </ul>
      <Link to="/market" className="market-overview-more-link">
        {t('majorIndices.viewAll')}
      </Link>
    </div>
  )
}

function CryptoSummaryCard() {
  const { t } = useTranslation('market')
  const [initialStats, setInitialStats] = useState<CryptoGlobalStats | null>(null)
  const [initialTopCoins, setInitialTopCoins] = useState<CryptoQuote[]>([])
  const liveStats = useLiveChannel<CryptoGlobalStats>('crypto-global')
  const liveCoins = useLiveChannel<CryptoQuote[]>('crypto')

  useEffect(() => {
    getCryptoGlobalStats()
      .then(setInitialStats)
      .catch(() => {})
    getCryptoQuotes()
      .then((quotes) => setInitialTopCoins(quotes.filter((q) => q.symbol === 'BTC' || q.symbol === 'ETH')))
      .catch(() => {})
  }, [])

  const stats = liveStats ?? initialStats
  const topCoins = liveCoins ? liveCoins.filter((q) => q.symbol === 'BTC' || q.symbol === 'ETH') : initialTopCoins

  if (!stats) return null

  return (
    <div className="market-overview-card">
      <h3>{t('crypto.title')}</h3>
      <div className="market-overview-hero-price-row" style={{ marginBottom: 4 }}>
        <span className="market-overview-hero-price mono" style={{ fontSize: 22 }}>
          {formatCompactUsd(stats.total_market_cap_usd)}
        </span>
        <span className={`candle-change ${stats.market_cap_change_percentage_24h >= 0 ? 'is-up' : 'is-down'}`}>
          {stats.market_cap_change_percentage_24h >= 0 ? '▲' : '▼'} {formatChange(stats.market_cap_change_percentage_24h)}
        </span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        {t('crypto.totalMarketCap')}
      </p>

      <div
        className="dominance-bar"
        // A CSS-composed segmented bar, not a real image — role="img" + aria-label
        // summarizing the three percentages is the correct pattern here.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={t('crypto.dominanceAria', {
          btc: stats.btc_dominance.toFixed(1),
          eth: stats.eth_dominance.toFixed(1),
          others: stats.others_dominance.toFixed(1),
        })}
      >
        <span className="dominance-segment is-btc" style={{ width: `${stats.btc_dominance}%` }} />
        <span className="dominance-segment is-eth" style={{ width: `${stats.eth_dominance}%` }} />
        <span className="dominance-segment is-others" style={{ width: `${stats.others_dominance}%` }} />
      </div>
      <div className="dominance-legend">
        <span><span className="dominance-dot is-btc" />BTC {stats.btc_dominance.toFixed(1)}%</span>
        <span><span className="dominance-dot is-eth" />ETH {stats.eth_dominance.toFixed(1)}%</span>
        <span><span className="dominance-dot is-others" />{t('crypto.other')} {stats.others_dominance.toFixed(1)}%</span>
      </div>

      {topCoins.length > 0 && (
        <ul className="market-overview-list" style={{ marginTop: 14 }}>
          {topCoins.map((c) => (
            <li key={c.symbol} className="market-overview-list-row">
              <span className="market-overview-list-symbol">
                <TickerAvatar ticker={c.symbol} size={22} />
                <span>{c.symbol}</span>
              </span>
              <span className="mono">${c.last_price.toLocaleString(currentLocale(), { maximumFractionDigits: 2 })}</span>
              <span className={`mono ${c.change_percent >= 0 ? 'text-up' : 'text-down'}`}>
                {formatChange(c.change_percent)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FxCommodityCard() {
  const { t } = useTranslation('market')
  const [initialFx, setInitialFx] = useState<FxQuote[]>([])
  const [initialCommodities, setInitialCommodities] = useState<TickerStripQuote[]>([])
  const liveFx = useLiveChannel<FxQuote[]>('fx')
  const liveCommodities = useLiveChannel<TickerStripQuote[]>('commodities')

  useEffect(() => {
    getFxQuotes().then(setInitialFx).catch(() => {})
    getCommodities().then(setInitialCommodities).catch(() => {})
  }, [])

  const fx = liveFx ?? initialFx
  const commodities = liveCommodities ?? initialCommodities

  const usdTry = fx.find((f) => f.pair === 'USDTRY=X')

  if (!usdTry && commodities.length === 0) return null

  return (
    <div className="market-overview-card">
      <h3>{t('fxCommodity.title')}</h3>
      {usdTry && (
        <div className="market-overview-hero-price-row" style={{ marginBottom: 14 }}>
          <span className="market-overview-list-symbol">
            <span>USD/TRY</span>
          </span>
          <span className="market-overview-hero-price mono" style={{ fontSize: 20 }}>
            {usdTry.rate.toFixed(4)}
          </span>
          <span className={`candle-change ${usdTry.change_percent >= 0 ? 'is-up' : 'is-down'}`}>
            {usdTry.change_percent >= 0 ? '▲' : '▼'} {formatChange(usdTry.change_percent)}
          </span>
        </div>
      )}
      <ul className="market-overview-list">
        {commodities.map((c) => (
          <li key={c.symbol} className="market-overview-list-row">
            <span className="market-overview-list-symbol">{c.label}</span>
            <span className="mono">${formatIndexValue(c.value)}</span>
            <span className={`mono ${c.change_percent >= 0 ? 'text-up' : 'text-down'}`}>
              {formatChange(c.change_percent)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MacroCard() {
  const { t } = useTranslation('market')
  const [inflation, setInflation] = useState<{ value: number; year: number } | null>(null)

  useEffect(() => {
    getInflationByCountry()
      .then((rows) => {
        const tr = rows.find((r) => r.country_code === 'TUR')
        if (tr) setInflation({ value: tr.value, year: tr.year })
      })
      .catch(() => {})
  }, [])

  if (!inflation) return null

  return (
    <div className="market-overview-card">
      <h3>{t('macro.title')}</h3>
      <div className="market-overview-hero-label">{t('macro.label')}</div>
      <div className="market-overview-hero-price mono" style={{ fontSize: 30, marginTop: 6 }}>
        %{inflation.value.toFixed(2)}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {t('macro.source', { year: inflation.year })}
      </p>
      <Link to="/enflasyon" className="market-overview-more-link">
        {t('macro.viewAll')}
      </Link>
    </div>
  )
}

function MarketOverviewPanel() {
  const { t } = useTranslation('market')
  return (
    <section className="home-section">
      <h2 className="home-section-title">{t('overview.title')}</h2>
      <HeroIndexCard />
      <div className="market-overview-grid">
        <MajorIndicesCard />
        <CryptoSummaryCard />
        <FxCommodityCard />
        <MacroCard />
      </div>
    </section>
  )
}

export default MarketOverviewPanel
