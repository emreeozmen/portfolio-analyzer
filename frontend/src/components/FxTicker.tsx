import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFxQuotes, type FxQuote } from '../api'
import { useLiveChannel } from '../lib/useLiveChannel'
import { useFlashOnChange } from '../lib/useFlashOnChange'
import { currentLocale } from '../lib/locale'
import { formatSignedPercent as formatChange } from '../lib/currency'

function formatRate(value: number): string {
  return value.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function FxChip({ quote }: { quote: FxQuote }) {
  const flash = useFlashOnChange(quote.rate)
  const isUp = quote.change_percent >= 0

  return (
    <div className="flex min-w-[150px] shrink-0 items-center justify-between gap-3 rounded-xl border border-border-strong bg-surface-2 px-4 py-2.5">
      <span className="font-mono text-xs font-semibold text-text-muted">{quote.label}</span>
      <span className="flex flex-col items-end">
        <span className={`font-mono text-sm font-bold text-text-h ${flash}`}>{formatRate(quote.rate)}</span>
        <span className={`font-mono text-[11px] font-semibold ${isUp ? 'text-success' : 'text-danger'}`}>
          {formatChange(quote.change_percent)}
        </span>
      </span>
    </div>
  )
}

function FxTicker() {
  const { t } = useTranslation('market')
  const [quotes, setQuotes] = useState<FxQuote[]>([])
  const [error, setError] = useState<string | null>(null)
  const live = useLiveChannel<FxQuote[]>('fx')

  useEffect(() => {
    getFxQuotes()
      .then(setQuotes)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  useEffect(() => {
    if (live) setQuotes(live)
  }, [live])

  if (error || quotes.length === 0) return null

  return (
    // Decorative, frequently-updating strip (same reasoning as LiveTickerStrip.tsx) —
    // the same FX rates are available in accessible form elsewhere on this page.
    <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-1" aria-hidden="true">
      <span className="shrink-0 pr-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {t('fxTickerLabel')}
      </span>
      {quotes.map((q) => (
        <FxChip key={q.pair} quote={q} />
      ))}
    </div>
  )
}

export default FxTicker
