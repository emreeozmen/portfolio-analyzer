import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTickerStrip, type TickerStripQuote } from '../api'
import { useLiveChannel } from '../lib/useLiveChannel'
import { useFlashOnChange } from '../lib/useFlashOnChange'
import { currentLocale } from '../lib/locale'
import { formatSignedPercent as formatChange } from '../lib/currency'

function formatValue(value: number): string {
  return value.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function TickerItem({ quote }: { quote: TickerStripQuote }) {
  const flash = useFlashOnChange(quote.value)
  const isUp = quote.change_percent >= 0

  return (
    <span className="ticker-strip-item">
      <span className="ticker-strip-label">{quote.label}</span>
      <span className={`ticker-strip-value mono ${flash}`}>{formatValue(quote.value)}</span>
      <span className={`ticker-strip-change mono ${isUp ? 'text-up' : 'text-down'}`}>{formatChange(quote.change_percent)}</span>
    </span>
  )
}

function LiveTickerStrip() {
  const { t } = useTranslation('home')
  const [paused, setPaused] = useState(false)
  const [quotes, setQuotes] = useState<TickerStripQuote[]>([])
  const live = useLiveChannel<TickerStripQuote[]>('ticker-strip')

  useEffect(() => {
    // REST once for first paint (the WebSocket's first "ticker-strip" push can be up
    // to a minute away) — every update after that arrives live, no polling interval.
    getTickerStrip()
      .then(setQuotes)
      .catch(() => {
        /* a quiet strip beats a broken homepage — this is a decorative live ticker, not critical data */
      })
  }, [])

  useEffect(() => {
    if (live) setQuotes(live)
  }, [live])

  if (quotes.length === 0) return null

  return (
    <div className="ticker-strip">
      <div className="ticker-strip-track" data-paused={paused}>
        {[0, 1].map((copy) => (
          <div key={copy} className="ticker-strip-group" aria-hidden={copy === 1}>
            {quotes.map((quote) => <TickerItem key={quote.symbol} quote={quote} />)}
          </div>
        ))}
      </div>
      <button type="button" className="ticker-strip-toggle" onClick={() => setPaused(!paused)}
        aria-label={t(paused ? 'tickerPlay' : 'tickerPause')} title={t(paused ? 'tickerPlay' : 'tickerPause')}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </div>
  )
}

export default LiveTickerStrip
