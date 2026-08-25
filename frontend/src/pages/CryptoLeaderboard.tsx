import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCryptoQuotes, type CryptoQuote } from '../api'
import TickerAvatar from '../components/TickerAvatar'
import Skeleton from '../components/Skeleton'
import { useLiveChannel } from '../lib/useLiveChannel'
import { useFlashOnChange } from '../lib/useFlashOnChange'
import { currentLocale } from '../lib/locale'

function formatCryptoPrice(value: number): string {
  const decimals = value >= 1 ? 2 : value >= 0.01 ? 4 : 8
  return `$${value.toLocaleString(currentLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function formatChange(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function formatMarketCap(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString(currentLocale(), { maximumFractionDigits: 0 })}`
}

function LeaderboardRow({ rank, quote }: { rank: number; quote: CryptoQuote }) {
  const flash = useFlashOnChange(quote.last_price)
  const isUp = quote.change_percent >= 0

  return (
    <li className="leaderboard-row">
      <span className="leaderboard-rank">{rank}</span>
      <TickerAvatar ticker={quote.symbol} size={30} />
      <span className="leaderboard-name">
        <span className="leaderboard-symbol">{quote.symbol}</span>
        <span className="leaderboard-fullname">{quote.name}</span>
      </span>
      <span className={`leaderboard-price mono ${flash}`}>{formatCryptoPrice(quote.last_price)}</span>
      <span className={`leaderboard-change mono ${isUp ? 'text-up' : 'text-down'}`}>{formatChange(quote.change_percent)}</span>
    </li>
  )
}

function MarketCapRow({ rank, quote }: { rank: number; quote: CryptoQuote }) {
  const flash = useFlashOnChange(quote.last_price)
  const isUp = quote.change_percent >= 0

  return (
    <tr>
      <td className="mono leaderboard-rank">{rank}</td>
      <td>
        <span className="screener-symbol-link">
          <TickerAvatar ticker={quote.symbol} size={28} />
          <span>
            <span className="screener-ticker">{quote.symbol}</span>
            <span className="screener-name">{quote.name}</span>
          </span>
        </span>
      </td>
      <td className={`mono ${flash}`}>{formatCryptoPrice(quote.last_price)}</td>
      <td className="mono">{formatMarketCap(quote.market_cap)}</td>
      <td className={`mono ${isUp ? 'text-up' : 'text-down'}`}>{formatChange(quote.change_percent)}</td>
    </tr>
  )
}

function LeaderboardSkeleton() {
  return (
    <ul className="leaderboard-list">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="skeleton-row">
          <Skeleton className="skeleton-avatar" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <Skeleton width={90} height={13} />
            <Skeleton width={130} height={11} />
          </div>
          <Skeleton width={70} height={13} />
        </li>
      ))}
    </ul>
  )
}

function CryptoLeaderboardPage() {
  const { t } = useTranslation('crypto')
  const [quotes, setQuotes] = useState<CryptoQuote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = (showSpinner: boolean) => {
    if (showSpinner) setLoading(true)
    getCryptoQuotes()
      .then((data) => {
        setQuotes(data)
        setLastUpdated(new Date())
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => load(true), [])

  const liveQuotes = useLiveChannel<CryptoQuote[]>('crypto')
  useEffect(() => {
    if (!liveQuotes) return
    setQuotes(liveQuotes)
    setLastUpdated(new Date())
  }, [liveQuotes])

  const sorted = [...quotes].sort((a, b) => b.change_percent - a.change_percent)
  // Slicing the top/bottom 5 regardless of sign would mislabel "least-up"
  // coins as "losers" on a day where the whole curated list is green (and
  // vice versa) — only count an entry as a gainer/loser if it's actually
  // positive/negative.
  const gainers = sorted.filter((q) => q.change_percent > 0).slice(0, 5)
  const losers = sorted
    .filter((q) => q.change_percent < 0)
    .slice(-5)
    .reverse()

  return (
    <div>
      <h1>{t('title')}</h1>
      <p className="muted" style={{ marginBottom: 8 }}>
        {t('intro', { count: quotes.length || '—' })}
      </p>
      {lastUpdated && (
        <div className="live-indicator" style={{ marginBottom: 20 }}>
          <span className="live-indicator-dot" />
          {t('lastUpdated', { time: lastUpdated.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }) })}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="leaderboard-grid">
        <div className="panel leaderboard-panel">
          <div className="panel-header-row">
            <h2>{t('topGainers')}</h2>
          </div>
          {loading ? (
            <LeaderboardSkeleton />
          ) : gainers.length > 0 ? (
            <ul className="leaderboard-list">
              {gainers.map((q, i) => (
                <LeaderboardRow key={q.symbol} rank={i + 1} quote={q} />
              ))}
            </ul>
          ) : (
            <p className="muted">{t('noGainersToday')}</p>
          )}
        </div>

        <div className="panel leaderboard-panel">
          <div className="panel-header-row">
            <h2>{t('topLosers')}</h2>
          </div>
          {loading ? (
            <LeaderboardSkeleton />
          ) : losers.length > 0 ? (
            <ul className="leaderboard-list">
              {losers.map((q, i) => (
                <LeaderboardRow key={q.symbol} rank={i + 1} quote={q} />
              ))}
            </ul>
          ) : (
            <p className="muted">{t('noLosersToday')}</p>
          )}
        </div>
      </div>

      <div className="panel screener-panel" style={{ marginTop: 20 }}>
        <div className="panel-header-row" style={{ padding: '16px 16px 0' }}>
          <h2>{t('allByMarketCap')}</h2>
        </div>
        <div className="table-scroll">
          <table className="screener-table">
            <thead>
              <tr>
                <th>{t('columnRank')}</th>
                <th>{t('columnAsset')}</th>
                <th>{t('columnPrice')}</th>
                <th>{t('columnMarketCap')}</th>
                <th>{t('columnChange24h')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5}>
                        <div className="skeleton-row" style={{ padding: 0 }}>
                          <Skeleton className="skeleton-avatar" />
                          <Skeleton width={200} height={13} />
                        </div>
                      </td>
                    </tr>
                  ))
                : quotes.map((q, i) => <MarketCapRow key={q.symbol} rank={i + 1} quote={q} />)}
            </tbody>
          </table>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 8 }}>
        {t('footerNote')}
      </p>
    </div>
  )
}

export default CryptoLeaderboardPage
