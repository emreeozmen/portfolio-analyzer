import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PieChart, ShieldCheck } from 'lucide-react'
import { getPublicPortfolioAnalysis, type PortfolioAnalysis } from '../api'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import LineChart from '../charts/LineChart'
import DonutChart, { DONUT_PALETTE } from '../charts/DonutChart'

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function PublicPortfolioPage() {
  const { t } = useTranslation('portfolio')
  const { token } = useParams<{ token: string }>()
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    setLoading(true)
    getPublicPortfolioAnalysis(token)
      .then(setAnalysis)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [token])

  const benchmarkByDate = new Map(analysis?.benchmark.map((b) => [b.date, b.value]) ?? [])
  const hasBenchmark = (analysis?.benchmark.length ?? 0) > 0

  return (
    <div>
      <PageHeader icon={PieChart} title={analysis?.name ?? t('shared.title')} subtitle={t('shared.subtitle')} />

      {loading && <p className="muted">{t('correlation.title')}...</p>}
      {error && <p className="error">{error}</p>}

      {analysis && !loading && (
        <>
          <section className="panel">
            <p className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <ShieldCheck size={16} /> {t('shared.readOnlyNote')}
            </p>
            <div className="card-grid">
              <Card label={t('builder.totalReturn')} value={formatPercent(analysis.summary.total_return)} />
              <Card label={t('builder.avgDailyReturn')} value={formatPercent(analysis.summary.average_return)} />
              <Card label={t('builder.annualVolatility')} value={formatPercent(analysis.summary.volatility)} />
              <Card label={t('builder.maxDrawdown')} value={formatPercent(analysis.summary.max_drawdown)} />
              <Card label={t('builder.sharpeRatio')} value={analysis.summary.sharpe_ratio.toFixed(2)} />
              <Card label={t('builder.assetCount')} value={String(analysis.weights.length)} />
            </div>
            <LineChart
              labels={analysis.portfolio_index.map((p) => p.date)}
              datasets={[
                { label: t('builder.portfolioIndexLabel'), data: analysis.portfolio_index.map((p) => p.value) },
                ...(hasBenchmark
                  ? [
                      {
                        label: analysis.benchmark_label,
                        data: analysis.portfolio_index.map((p) => benchmarkByDate.get(p.date) ?? NaN),
                        color: '#5b9dee',
                      },
                    ]
                  : []),
              ]}
            />
            {!hasBenchmark && (
              <p className="muted" style={{ marginTop: 10 }}>
                {t('builder.noBenchmark')}
              </p>
            )}
          </section>

          <section className="panel">
            <h2>{t('allocation.title')}</h2>
            <div className="allocation-layout">
              <div className="allocation-chart">
                <DonutChart
                  labels={analysis.weights.map((w) => w.ticker)}
                  data={analysis.weights.map((w) => w.weight * 100)}
                />
              </div>
              <ul className="allocation-legend">
                {analysis.weights.map((w, i) => (
                  <li key={w.ticker} className="allocation-legend-row">
                    <span
                      className="allocation-swatch"
                      style={{ background: DONUT_PALETTE[i % DONUT_PALETTE.length] }}
                    />
                    <span className="allocation-legend-ticker mono">{w.ticker}</span>
                    <span className="allocation-legend-weight mono">{formatPercent(w.weight)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {analysis.correlation.tickers.length >= 2 && (
            <section className="panel">
              <h2>{t('correlation.title')}</h2>
              <div className="table-scroll">
                <table className="correlation-table">
                  <thead>
                    <tr>
                      <th scope="col" className="sr-only">
                        {t('correlation.cornerLabel')}
                      </th>
                      {analysis.correlation.tickers.map((ticker) => (
                        <th key={ticker} className="mono">
                          {ticker}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.correlation.tickers.map((rowTicker, i) => (
                      <tr key={rowTicker}>
                        <th className="mono">{rowTicker}</th>
                        {analysis.correlation.matrix[i].map((v, j) => (
                          <td key={analysis.correlation.tickers[j]} className="corr-cell">
                            {v.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default PublicPortfolioPage
