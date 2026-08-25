import { useEffect, useState } from 'react'
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
  useTranslation() // subscribes to language changes so formatValue's locale re-reads on toggle
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
    // Decorative, continuously-updating marquee (duplicated content, no way to pause
    // it) — the same figures are available in accessible, non-marquee form on
    // Piyasa Görünümü, so this is hidden from assistive tech rather than announced
    // via aria-live, which would otherwise re-read the whole strip on every tick.
    <div className="ticker-strip" aria-hidden="true">
      <div className="ticker-strip-track">
        {[...quotes, ...quotes].map((q, i) => (
          <TickerItem key={`${q.symbol}-${i}`} quote={q} />
        ))}
      </div>
    </div>
  )
}

export default LiveTickerStrip
