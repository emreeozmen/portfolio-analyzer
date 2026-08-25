import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetQuote } from '../api'
import { formatMoney, formatSignedPercent as formatChange } from '../lib/currency'
import { currentLocale } from '../lib/locale'
import TickerAvatar from './TickerAvatar'
import Sparkline from './Sparkline'
import { useFlashOnChange } from '../lib/useFlashOnChange'

interface WatchlistProps {
  quotes: AssetQuote[]
  selectedTicker: string
  onSelect: (ticker: string) => void
}

const WatchlistRow = memo(function WatchlistRow({
  quote,
  isActive,
  onSelect,
}: {
  quote: AssetQuote
  isActive: boolean
  onSelect: (ticker: string) => void
}) {
  const flash = useFlashOnChange(quote.last_price)

  return (
    <button
      type="button"
      className={isActive ? 'watchlist-row is-active' : 'watchlist-row'}
      onClick={() => onSelect(quote.ticker)}
    >
      <span className="watchlist-symbol-cell">
        <TickerAvatar ticker={quote.ticker} size={26} />
        <span className="watchlist-symbol">
          <span className="watchlist-ticker">{quote.ticker}</span>
          <span className="watchlist-name">{quote.name}</span>
        </span>
      </span>
      <Sparkline data={quote.sparkline} width={34} height={20} />
      <span className={`watchlist-price ${flash}`}>{formatMoney(quote.last_price, quote.currency)}</span>
      <span className={quote.change_percent >= 0 ? 'watchlist-change is-up' : 'watchlist-change is-down'}>
        {formatChange(quote.change_percent)}
      </span>
    </button>
  )
})

function Watchlist({ quotes, selectedTicker, onSelect }: WatchlistProps) {
  const { t } = useTranslation('common')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    if (quotes.length > 0) setLastUpdated(new Date())
  }, [quotes])

  return (
    <div className="watchlist">
      <div className="watchlist-header">{t('watchlist.header')}</div>
      {lastUpdated && (
        <div className="live-indicator" style={{ padding: '0 14px 10px' }}>
          <span className="live-indicator-dot" />
          {t('watchlist.lastUpdated', {
            time: lastUpdated.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' }),
          })}
        </div>
      )}
      <div className="watchlist-column-labels">
        <span>{t('watchlist.symbol')}</span>
        <span />
        <span>{t('watchlist.last')}</span>
        <span>{t('watchlist.changePercent')}</span>
      </div>
      <ul className="watchlist-rows">
        {quotes.map((q) => (
          <li key={q.ticker}>
            <WatchlistRow quote={q} isActive={q.ticker === selectedTicker} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Watchlist
