import { useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ArrowUpRight, FlaskConical } from 'lucide-react'
import { DEMO_PRESET_IDS, getDemoPortfolio, type DemoPresetId, type DemoPortfolioAnalysis } from '../api'
import { useRemoteData } from '../lib/useRemoteData'
import { formatMoney, formatPercentFraction } from '../lib/currency'
import DataNotice from '../components/DataNotice'
import PortfolioSnapshot from '../components/PortfolioSnapshot'
import LineChart from '../charts/LineChart'
import DonutChart from '../charts/DonutChart'

export default function DemoPortfolioPage() {
  const { t } = useTranslation('portfolio')
  const [params, setParams] = useSearchParams()
  const selected = params.get('preset')
  const preset = DEMO_PRESET_IDS.find((id) => id === selected) ?? 'bist-five'
  return (
    <div className="demo-page">
      <header className="demo-intro">
        <span className="demo-eyebrow"><FlaskConical size={15} aria-hidden="true" /> {t('demo.eyebrow')}</span>
        <h1>{t('demo.title')}</h1><p>{t('demo.intro')}</p>
      </header>
      <div className="demo-presets" role="group" aria-label={t('demo.choose')}>
        {DEMO_PRESET_IDS.map((id, index) => (
          <button key={id} type="button" className={`demo-preset${id === preset ? ' is-selected' : ''}`}
            aria-pressed={id === preset} onClick={() => setParams({ preset: id }, { replace: true })}>
            <span className="demo-preset-number">0{index + 1}</span>
            <strong>{t(`demo.presets.${id}.title`)}</strong>
            <span>{t(`demo.presets.${id}.description`)}</span>
            <ArrowUpRight size={19} aria-hidden="true" />
          </button>
        ))}
      </div>
      <DemoResult key={preset} preset={preset} />
    </div>
  )
}

function DemoResult({ preset }: { preset: DemoPresetId }) {
  const { t } = useTranslation('portfolio')
  const loader = useCallback(() => getDemoPortfolio(preset), [preset])
  const request = useRemoteData<DemoPortfolioAnalysis | null>(loader, null)
  const [amount, setAmount] = useState('10000')
  const analysis = request.data
  if (!analysis) return <DataNotice {...request} />
  const principal = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(principal) && principal > 0 && principal <= 1_000_000_000
  const first = analysis.portfolio_index[0]?.value
  const last = analysis.portfolio_index.at(-1)?.value
  const ending = valid && first && last !== undefined ? principal * last / first : null
  const benchmarks = new Map(analysis.benchmark.map((point) => [point.date, point.value]))
  return (
    <>
      <PortfolioSnapshot analysis={analysis} />
      <section className="panel demo-performance" aria-label={t('demo.performance')}>
        <div className="demo-performance-heading"><div><span className="demo-eyebrow">{t('demo.historical')}</span>
          <h2>{t(`demo.presets.${preset}.title`)}</h2></div>
          <span className="demo-return mono">{formatPercentFraction(analysis.summary.total_return)}</span>
        </div>
        <LineChart labels={analysis.portfolio_index.map((point) => point.date)} datasets={[
          { label: t('builder.portfolioIndexLabel'), data: analysis.portfolio_index.map((point) => point.value) },
          ...(analysis.benchmark.length ? [{ label: analysis.benchmark_label,
            data: analysis.portfolio_index.map((point) => benchmarks.get(point.date) ?? NaN), color: '#5b9dee' }] : []),
        ]} />
        {!analysis.benchmark.length && <p className="muted">{t('builder.noBenchmark')}</p>}
      </section>
      <div className="demo-detail-grid">
        <section className="panel demo-allocation"><h2>{t('allocation.title')}</h2>
          <DonutChart labels={analysis.weights.map((item) => item.ticker)} data={analysis.weights.map((item) => item.weight * 100)} />
          <ul>{analysis.weights.map((item) => <li key={item.ticker}><span className="mono">{item.ticker}</span>
            <strong>{formatPercentFraction(item.weight)}</strong></li>)}</ul>
        </section>
        <section className="panel demo-calculator"><span className="demo-eyebrow">{t('demo.tryAmount')}</span>
          <h2>{t('demo.calculatorTitle')}</h2><p className="muted">{t('demo.calculatorHelp')}</p>
          <label htmlFor="demo-amount">{t('demo.startAmount', { currency: analysis.currency })}</label>
          <input id="demo-amount" type="number" min="1" max="1000000000" inputMode="decimal" value={amount}
            aria-invalid={!valid} aria-describedby="demo-amount-note" onChange={(event) => setAmount(event.target.value)} />
          <div className="demo-ending"><span>{t('demo.ending')}</span><strong className="mono">
            {ending === null ? '—' : formatMoney(ending, analysis.currency)}</strong></div>
          <p id="demo-amount-note" className={valid ? 'muted' : 'error'}>{t(valid ? 'demo.amountNote' : 'demo.invalidAmount')}</p>
          <Link to="/portfolio" state={{ demoPreset: preset }} className="btn-primary">{t('demo.editExample')} <ArrowRight size={17} aria-hidden="true" /></Link>
          <p className="muted demo-save-note">{t('demo.saveNote')}</p>
        </section>
      </div>
      <p className="snapshot-footnote">{t('demo.educational')}</p>
    </>
  )
}
