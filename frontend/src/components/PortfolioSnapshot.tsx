import { useTranslation } from 'react-i18next'
import { Activity, Calendar, Layers } from 'lucide-react'
import type { PortfolioAnalysis } from '../api'
import { formatPercentFraction } from '../lib/currency'
import { currentLocale } from '../lib/locale'

function formatDate(value: string) {
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
}

export default function PortfolioSnapshot({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  const largest = analysis.weights.reduce<(typeof analysis.weights)[number] | null>(
    (best, item) => !best || item.weight > best.weight ? item : best, null,
  )
  const first = analysis.portfolio_index[0]
  const last = analysis.portfolio_index.at(-1)
  const start = analysis.data_window?.start_date ?? first?.date
  const end = analysis.data_window?.end_date ?? last?.date
  const observations = analysis.data_window?.observations ?? analysis.portfolio_index.length

  return (
    <section className="portfolio-snapshot" aria-label={t('snapshot.title')}>
      <div className="snapshot-heading">
        <div><span className="demo-eyebrow">{t('snapshot.eyebrow')}</span><h2>{t('snapshot.title')}</h2></div>
        <span className="snapshot-source">{t('snapshot.dailyData')}</span>
      </div>
      <div className="snapshot-grid">
        <article><Layers size={19} aria-hidden="true" /><h3>{t('snapshot.distribution')}</h3>
          <strong>{t('snapshot.assetCount', { count: analysis.weights.length })}</strong>
          <p>{largest ? t('snapshot.largest', { ticker: largest.ticker, weight: formatPercentFraction(largest.weight) }) : '—'}</p>
        </article>
        <article><Activity size={19} aria-hidden="true" /><h3>{t('snapshot.drawdown')}</h3>
          <strong>{formatPercentFraction(analysis.summary.max_drawdown)}</strong>
          <p>{t('snapshot.drawdownHelp')}</p>
        </article>
        <article><Calendar size={19} aria-hidden="true" /><h3>{t('snapshot.window')}</h3>
          <strong>{t('snapshot.observations', { count: observations })}</strong>
          <p>{start && end ? `${formatDate(start)} — ${formatDate(end)}` : '—'}</p>
        </article>
      </div>
      <p className="snapshot-footnote">{t('snapshot.note')}</p>
    </section>
  )
}
