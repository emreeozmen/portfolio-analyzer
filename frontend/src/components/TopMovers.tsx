import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AssetQuote } from '../api'
import TickerAvatar from './TickerAvatar'
import Sparkline from './Sparkline'
import { useFlashOnChange } from '../lib/useFlashOnChange'

function formatChange(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function MoverRow({ quote, onSelect }: { quote: AssetQuote; onSelect: (ticker: string) => void }) {
  const flash = useFlashOnChange(quote.last_price)
  const isUp = quote.change_percent >= 0

  return (
    <button type="button" className="mover-row" onClick={() => onSelect(quote.ticker)}>
      <TickerAvatar ticker={quote.ticker} size={24} />
      <span className="mover-name">
        <span className="mover-ticker">{quote.ticker}</span>
        <span className="mover-fullname">{quote.name}</span>
      </span>
      <Sparkline data={quote.sparkline} width={30} height={18} />
      <span className={`mover-change mono ${isUp ? 'text-up' : 'text-down'} ${flash}`}>
        {formatChange(quote.change_percent)}
      </span>
    </button>
  )
}

interface TopMoversProps {
  quotes: AssetQuote[]
}

/** Real-data "market movers" sidebar widget — gainers/losers computed client-side
 * from the same batched quote list the homepage's Watchlist sidebar already fetches
 * (no extra API call). Only an entry that's actually positive/negative counts toward
 * gainers/losers respectively (same rule as CryptoLeaderboard.tsx's gainers/losers),
 * so a broadly-green or broadly-red day doesn't mislabel the least-extreme entries
 * as the opposite direction.
 */
function TopMovers({ quotes }: TopMoversProps) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  if (quotes.length === 0) return null

  const sorted = [...quotes].sort((a, b) => b.change_percent - a.change_percent)
  const gainers = sorted.filter((q) => q.change_percent > 0).slice(0, 5)
  const losers = sorted
    .filter((q) => q.change_percent < 0)
    .slice(-5)
    .reverse()
  const onSelect = (ticker: string) => navigate(`/assets/${ticker}`)

  return (
    <div className="movers-widget">
      <div className="movers-section">
        <div className="movers-header">{t('topMovers.gainers')}</div>
        {gainers.length > 0 ? (
          <div className="movers-list">
            {gainers.map((q) => (
              <MoverRow key={q.ticker} quote={q} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <p className="muted" style={{ padding: '0 14px 12px', fontSize: 12.5 }}>
            {t('topMovers.noGainersToday')}
          </p>
        )}
      </div>
      <div className="movers-section">
        <div className="movers-header">{t('topMovers.losers')}</div>
        {losers.length > 0 ? (
          <div className="movers-list">
            {losers.map((q) => (
              <MoverRow key={q.ticker} quote={q} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <p className="muted" style={{ padding: '0 14px 12px', fontSize: 12.5 }}>
            {t('topMovers.noLosersToday')}
          </p>
        )}
      </div>
    </div>
  )
}

export default TopMovers
