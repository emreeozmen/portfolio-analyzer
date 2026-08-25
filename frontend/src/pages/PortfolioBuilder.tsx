import { memo, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { Chart as ChartJSInstance } from 'chart.js'
import { useLocation, useNavigate } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { FolderOpen, PieChart } from 'lucide-react'
import {
  createPortfolio,
  createShareLink,
  deletePortfolio,
  deleteShareLink,
  getAssets,
  getHoldingsValuation,
  getPortfolioAnalysis,
  getPortfolioBacktest,
  getPortfolioDetail,
  getPortfolioGoalProjection,
  getPortfolioMonteCarlo,
  getPortfolioOptimization,
  getPortfolios,
  trackAsset,
  updatePortfolio,
  type AssetSummary,
  type GoalProjectionResult,
  type MonteCarloResult,
  type Portfolio,
  type PortfolioAnalysis,
  type PortfolioOptimization,
  type RollingBacktestResult,
  type SymbolSearchResult,
} from '../api'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import LineChart from '../charts/LineChart'
import DonutChart, { DONUT_PALETTE } from '../charts/DonutChart'
import EfficientFrontierChart from '../charts/EfficientFrontierChart'
import HoldingsPanel from '../components/HoldingsPanel'
import ExposureBreakdown from '../components/ExposureBreakdown'
import Skeleton from '../components/Skeleton'
import RiskAlerts, { type RiskAlert } from '../components/RiskAlerts'
import { downloadCsv } from '../lib/csv'
import { parsePortfolioWeightsCsv, type PortfolioCsvParseResult } from '../lib/portfolioCsv'
import { beta, STRESS_SHOCKS } from '../lib/risk'
import { useTheme } from '../lib/ThemeContext'
import { useLiveSignal } from '../lib/useLiveChannel'
import { currentLocale } from '../lib/locale'

interface AssetRow {
  ticker: string
  weight: string
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

const EMPTY_ROW: AssetRow = { ticker: '', weight: '' }

// Kept in sync with the backend's own defaults/labels (analysis_service.monte_carlo_analysis
// horizon options, n_simulations default) — the simulation itself now runs server-side
// (correlated multi-asset draw, see backend/analysis/portfolio_metrics.py), these are just
// the tab/label config for the UI.
const MONTE_CARLO_HORIZONS = [
  { label: '1A', days: 21 },
  { label: '3A', days: 63 },
  { label: '6A', days: 126 },
  { label: '1Y', days: 252 },
] as const

const MONTE_CARLO_CONFIDENCE_LEVELS = [0.95, 0.99] as const
const MONTE_CARLO_SIMULATIONS = 2000

const BACKTEST_WINDOWS = [
  { label: '1A', days: 21 },
  { label: '3A', days: 63 },
  { label: '6A', days: 126 },
  { label: '1Y', days: 252 },
] as const

const BENCHMARK_PRESETS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^NDX', label: 'Nasdaq 100' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: 'GC=F', label: 'Altın' },
]

/** Continuous heatmap coloring (not the old 4-bucket classification): intensity scales
 * smoothly with |value|, direction (danger=positive/correlated, success=negative/
 * diversifying) matches the semantics buildPortfolioAlerts already uses for its
 * high-correlation warning. 55% cap keeps the strongest cells readable against text. */
function correlationCellStyle(value: number): React.CSSProperties {
  const clamped = Math.max(-1, Math.min(1, value))
  const intensity = Math.round(Math.abs(clamped) * 55)
  const token = clamped >= 0 ? 'danger' : 'success'
  return { backgroundColor: `color-mix(in srgb, var(--${token}) ${intensity}%, transparent)` }
}

const AllocationSection = memo(function AllocationSection({
  analysis,
  donutRef,
}: {
  analysis: PortfolioAnalysis
  donutRef?: Ref<ChartJSInstance<'doughnut'>>
}) {
  const { t } = useTranslation('portfolio')
  const labels = analysis.weights.map((w) => w.ticker)
  const data = analysis.weights.map((w) => w.weight * 100)

  return (
    <section className="panel">
      <h2>{t('allocation.title')}</h2>
      <div className="allocation-layout">
        <div className="allocation-chart">
          <DonutChart ref={donutRef} labels={labels} data={data} ariaLabel={t('allocation.chartAriaLabel')} />
        </div>
        <ul className="allocation-legend">
          {analysis.weights.map((w, i) => (
            <li key={w.ticker} className="allocation-legend-row">
              <span className="allocation-swatch" style={{ background: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
              <span className="allocation-legend-ticker mono">{w.ticker}</span>
              <span className="allocation-legend-weight mono">{formatPercent(w.weight)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
})

function ExposureSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  if (analysis.sector_allocation.length < 2 && analysis.currency_allocation.length < 2) return null

  return (
    <section className="panel">
      <h2>{t('exposure.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('exposure.intro')}
      </p>
      <ExposureBreakdown title={t('exposure.bySector')} rows={analysis.sector_allocation} />
      <ExposureBreakdown title={t('exposure.byCurrency')} rows={analysis.currency_allocation} />
    </section>
  )
}

const OptimizationSection = memo(function OptimizationSection({
  analysis,
  onApplyWeights,
}: {
  analysis: PortfolioAnalysis
  onApplyWeights: (weights: { ticker: string; weight: number }[]) => void
}) {
  const { t } = useTranslation('portfolio')
  const [objective, setObjective] = useState<'max_sharpe' | 'min_variance' | 'risk_parity'>('max_sharpe')
  const [result, setResult] = useState<PortfolioOptimization | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (analysis.weights.length < 2) return
    setLoading(true)
    setError(null)
    getPortfolioOptimization(analysis.portfolio_id, objective)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.portfolio_id, objective])

  if (analysis.weights.length < 2) {
    return (
      <section className="panel">
        <h2>{t('optimization.title')}</h2>
        <p className="muted">{t('optimization.needsTwoAssets')}</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-header-row">
        <h2>{t('optimization.title')}</h2>
        <div className="candle-range-tabs">
          <button
            type="button"
            className={objective === 'max_sharpe' ? 'candle-range-tab is-active' : 'candle-range-tab'}
            onClick={() => setObjective('max_sharpe')}
          >
            {t('optimization.maxSharpe')}
          </button>
          <button
            type="button"
            className={objective === 'min_variance' ? 'candle-range-tab is-active' : 'candle-range-tab'}
            onClick={() => setObjective('min_variance')}
          >
            {t('optimization.minVariance')}
          </button>
          <button
            type="button"
            className={objective === 'risk_parity' ? 'candle-range-tab is-active' : 'candle-range-tab'}
            onClick={() => setObjective('risk_parity')}
          >
            {t('optimization.riskParity')}
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('optimization.introPrefix')}{' '}
        {objective === 'max_sharpe' && t('optimization.introMaxSharpe')}
        {objective === 'min_variance' && t('optimization.introMinVariance')}
        {objective === 'risk_parity' && t('optimization.introRiskParity')}{' '}
        {t('optimization.introSuffix')}
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('optimization.calculating')}</p>}
      {result && !loading && (
        <>
          <div className="table-scroll">
            <table className="rebalance-table">
              <thead>
                <tr>
                  <th>{t('optimization.columnAsset')}</th>
                  <th>{t('optimization.columnCurrentPercent')}</th>
                  <th>{t('optimization.columnSuggestedPercent')}</th>
                </tr>
              </thead>
              <tbody>
                {result.suggested_weights.map((w) => {
                  const current = result.current_weights.find((c) => c.ticker === w.ticker)?.weight ?? 0
                  return (
                    <tr key={w.ticker}>
                      <td className="mono">{w.ticker}</td>
                      <td>{(current * 100).toFixed(1)}%</td>
                      <td>{(w.weight * 100).toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="card-grid" style={{ marginTop: 18 }}>
            <Card label={t('optimization.currentVolatility')} value={formatPercent(result.current_summary.volatility)} />
            <Card label={t('optimization.suggestedVolatility')} value={formatPercent(result.suggested_summary.volatility)} />
            <Card label={t('optimization.currentSharpe')} value={result.current_summary.sharpe_ratio.toFixed(2)} />
            <Card label={t('optimization.suggestedSharpe')} value={result.suggested_summary.sharpe_ratio.toFixed(2)} />
          </div>
          {result.frontier.length > 1 && (
            <>
              <p className="muted" style={{ marginTop: 18, marginBottom: 12 }}>
                {t('optimization.frontierIntro')}
              </p>
              <EfficientFrontierChart
                frontier={result.frontier}
                currentPoint={result.current_point}
                suggestedPoint={result.suggested_point}
              />
            </>
          )}
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 18 }}
            onClick={() =>
              onApplyWeights(result.suggested_weights.map((w) => ({ ticker: w.ticker, weight: w.weight * 100 })))
            }
          >
            {t('optimization.applySuggested')}
          </button>
        </>
      )}
    </section>
  )
})

const CorrelationSection = memo(function CorrelationSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  const { tickers, matrix } = analysis.correlation
  const [hovered, setHovered] = useState<{ row: number; col: number } | null>(null)
  if (tickers.length < 2) {
    return (
      <section className="panel">
        <h2>{t('correlation.title')}</h2>
        <p className="muted">{t('correlation.needsTwoAssets')}</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <h2>{t('correlation.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('correlation.intro')}
      </p>
      <div className="table-scroll">
        {/* onMouseLeave here only clears a hover-highlight visual affordance — every
            cell's data is already reachable via its own row/column <th> regardless of
            hover state, so this doesn't gate any functionality. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <table className="correlation-table" onMouseLeave={() => setHovered(null)}>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                {t('correlation.cornerLabel')}
              </th>
              {tickers.map((ticker, j) => (
                <th key={ticker} className={`mono ${hovered?.col === j ? 'corr-highlight' : ''}`}>
                  {ticker}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((rowTicker, i) => (
              <tr key={rowTicker}>
                <th className={`mono ${hovered?.row === i ? 'corr-highlight' : ''}`}>{rowTicker}</th>
                {tickers.map((colTicker, j) => (
                  <td
                    key={colTicker}
                    className={`corr-cell ${
                      hovered && (hovered.row === i || hovered.col === j) ? 'corr-cell-highlight' : ''
                    }`}
                    style={correlationCellStyle(matrix[i][j])}
                    onMouseEnter={() => setHovered({ row: i, col: j })}
                  >
                    {matrix[i][j].toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="corr-scale">
        <span className="mono muted">-1</span>
        <div className="corr-scale-bar" />
        <span className="mono muted">+1</span>
      </div>
    </section>
  )
})

function buildPortfolioAlerts(analysis: PortfolioAnalysis, t: TFunction<'portfolio'>): RiskAlert[] {
  const alerts: RiskAlert[] = []
  const { summary, correlation } = analysis

  if (summary.volatility > 0.4) {
    alerts.push({ tone: 'warn', text: t('alerts.highVolatility', { value: (summary.volatility * 100).toFixed(1) }) })
  }
  if (summary.max_drawdown < -0.25) {
    alerts.push({
      tone: 'danger',
      text: t('alerts.deepDrawdown', { percent: Math.abs(summary.max_drawdown * 100).toFixed(1) }),
    })
  }
  if (summary.sharpe_ratio < 0) {
    alerts.push({ tone: 'warn', text: t('alerts.negativeSharpe') })
  }

  for (let i = 0; i < correlation.tickers.length; i++) {
    for (let j = i + 1; j < correlation.tickers.length; j++) {
      if (correlation.matrix[i][j] >= 0.85) {
        alerts.push({
          tone: 'info',
          text: t('alerts.highCorrelation', {
            tickerA: correlation.tickers[i],
            tickerB: correlation.tickers[j],
            value: correlation.matrix[i][j].toFixed(2),
          }),
        })
      }
    }
  }

  return alerts
}

function RebalancingSection({
  portfolioId,
  targetWeights,
  refreshKey,
}: {
  portfolioId: number
  targetWeights: Record<string, number>
  refreshKey: number
}) {
  const { t } = useTranslation('portfolio')
  const [rows, setRows] = useState<{ ticker: string; target: number; actual: number; diffValue: number; currency: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getHoldingsValuation(portfolioId)
      .then((res) => {
        const mixed = res.summary.mixed_currency
        // Mixed-currency portfolios rebalance off the TRY-normalized value (real FX
        // rate, not skipped); single-currency portfolios keep using native values so
        // there's no unnecessary conversion noise in the suggested amounts.
        const valueOf = (h: (typeof res.holdings)[number]) => (mixed ? h.market_value_try : h.market_value)
        const priced = res.holdings.filter((h) => valueOf(h) !== null)
        if (priced.length === 0) {
          setRows([])
          return
        }
        const totalValue = priced.reduce((s, h) => s + (valueOf(h) ?? 0), 0)
        setRows(
          priced.map((h) => {
            const actual = totalValue > 0 ? (valueOf(h) ?? 0) / totalValue : 0
            const target = targetWeights[h.ticker] ?? 0
            return {
              ticker: h.ticker,
              target,
              actual,
              diffValue: (target - actual) * totalValue,
              currency: mixed ? 'TRY' : h.currency,
            }
          }),
        )
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId, refreshKey])

  if (error) return null
  if (rows === null) return null
  if (rows.length === 0) return null

  const material = rows.filter((r) => Math.abs(r.target - r.actual) * 100 > 2)
  if (material.length === 0) return null

  return (
    <section className="panel">
      <h2>{t('rebalancing.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('rebalancing.intro')}
      </p>
      <div className="table-scroll">
        <table className="rebalance-table">
          <thead>
            <tr>
              <th>{t('rebalancing.columnAsset')}</th>
              <th>{t('rebalancing.columnTarget')}</th>
              <th>{t('rebalancing.columnCurrent')}</th>
              <th>{t('rebalancing.columnSuggestion')}</th>
            </tr>
          </thead>
          <tbody>
            {material.map((r) => {
              const isBuy = r.target > r.actual
              return (
                <tr key={r.ticker}>
                  <td className="mono">{r.ticker}</td>
                  <td>{(r.target * 100).toFixed(1)}%</td>
                  <td>{(r.actual * 100).toFixed(1)}%</td>
                  <td className={isBuy ? 'rebalance-buy' : 'rebalance-sell'}>
                    {isBuy ? t('rebalancing.buy') : t('rebalancing.sell')} ~{formatMoneyPlain(Math.abs(r.diffValue), r.currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatMoneyPlain(value: number, currency: string): string {
  return `${value.toLocaleString(currentLocale(), { maximumFractionDigits: 0 })} ${currency}`
}

function StressTestSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  if (analysis.benchmark.length < 5) return null

  const benchmarkByDate = new Map(analysis.benchmark.map((b) => [b.date, b.value]))
  const aligned = analysis.portfolio_index
    .filter((p) => benchmarkByDate.has(p.date))
    .map((p) => ({ portfolio: p.value, benchmark: benchmarkByDate.get(p.date) as number }))

  const portfolioBeta = beta(
    aligned.map((a) => a.portfolio),
    aligned.map((a) => a.benchmark),
  )
  if (portfolioBeta === null) return null

  return (
    <section className="panel">
      <h2>{t('stressTest.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        <Trans
          t={t}
          i18nKey="stressTest.intro"
          values={{ beta: portfolioBeta.toFixed(2) }}
          components={{ strong: <strong className="mono" /> }}
        />
      </p>
      <div className="stress-grid">
        {STRESS_SHOCKS.map((shock) => (
          <div className="stress-cell" key={shock}>
            <div className="stress-cell-shock">{t('stressTest.shockLabel', { shock: (shock * 100).toFixed(0) })}</div>
            <div className="stress-cell-value">%{(shock * portfolioBeta * 100).toFixed(1)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

const RiskMetricsSection = memo(function RiskMetricsSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  const { summary } = analysis
  return (
    <section className="panel">
      <h2>{t('riskMetrics.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('riskMetrics.intro')}
      </p>
      <div className="card-grid">
        <Card label={t('riskMetrics.sortino')} value={summary.sortino_ratio.toFixed(2)} />
        <Card label={t('riskMetrics.calmar')} value={summary.calmar_ratio.toFixed(2)} />
        <Card label={t('riskMetrics.skewness')} value={summary.skewness.toFixed(2)} />
        <Card label={t('riskMetrics.kurtosis')} value={summary.kurtosis.toFixed(2)} />
        <Card label={t('riskMetrics.historicalVar')} value={formatPercent(summary.historical_var_95)} />
        <Card label={t('riskMetrics.historicalCvar')} value={formatPercent(summary.historical_cvar_95)} />
      </div>
    </section>
  )
})

const BacktestSection = memo(function BacktestSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  const [windowIndex, setWindowIndex] = useState(1)
  const [result, setResult] = useState<RollingBacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedWindow = BACKTEST_WINDOWS[windowIndex]
  const windowLabel = t(`performanceWindows.${selectedWindow.label}`, { ns: 'assets' })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getPortfolioBacktest(analysis.portfolio_id, selectedWindow.days)
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((err) => {
        if (!cancelled) {
          setResult(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysis.portfolio_id, selectedWindow.days])

  return (
    <section className="panel">
      <div className="panel-header-row">
        <h2>{t('backtest.title')}</h2>
        <div className="candle-range-tabs">
          {BACKTEST_WINDOWS.map((w, i) => (
            <button
              key={w.label}
              type="button"
              className={i === windowIndex ? 'candle-range-tab is-active' : 'candle-range-tab'}
              onClick={() => setWindowIndex(i)}
            >
              {t(`performanceWindows.${w.label}`, { ns: 'assets' })}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('backtest.intro', { window: windowLabel })}
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('backtest.loading')}</p>}
      {!loading && !error && !result && (
        <p className="muted">{t('backtest.insufficientData', { days: selectedWindow.days + 1 })}</p>
      )}
      {!loading && !error && result && (
        <>
          <div className="card-grid">
            <Card label={t('backtest.meanReturn')} value={formatSignedPercent(result.mean_return_percent)} />
            <Card label={t('backtest.medianReturn')} value={formatSignedPercent(result.median_return_percent)} />
            <Card label={t('backtest.bestPeriod')} value={formatSignedPercent(result.best_return_percent)} />
            <Card label={t('backtest.worstPeriod')} value={formatSignedPercent(result.worst_return_percent)} />
            <Card label={t('backtest.positiveRate')} value={formatPercent(result.positive_rate)} />
            <Card label={t('backtest.sampleCount')} value={String(result.sample_count)} />
          </div>
          {result.worst_drawdown_period && (
            <div className="card-grid" style={{ marginTop: 12, marginBottom: 18 }}>
              <Card
                label={t('backtest.worstDrawdown')}
                value={formatSignedPercent(result.worst_drawdown_period.drawdown_percent)}
              />
              <Card
                label={t('backtest.worstDrawdownPeriod')}
                value={`${result.worst_drawdown_period.peak_date} → ${result.worst_drawdown_period.trough_date}`}
              />
              <Card
                label={t('backtest.worstDrawdownRecovery')}
                value={result.worst_drawdown_period.recovery_date ?? t('backtest.notRecoveredYet')}
              />
            </div>
          )}
          <LineChart
            labels={result.points.map((p) => p.start_date)}
            datasets={[
              {
                label: t('backtest.seriesLabel', { window: windowLabel }),
                data: result.points.map((p) => p.return_percent),
                color: '#c9a15f',
              },
            ]}
          />
        </>
      )}
    </section>
  )
})

const MonteCarloSection = memo(function MonteCarloSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  const [horizonIndex, setHorizonIndex] = useState(MONTE_CARLO_HORIZONS.length - 1)
  const [confidenceLevel, setConfidenceLevel] = useState<number>(MONTE_CARLO_CONFIDENCE_LEVELS[0])
  const [result, setResult] = useState<MonteCarloResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const horizon = MONTE_CARLO_HORIZONS[horizonIndex]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getPortfolioMonteCarlo(analysis.portfolio_id, {
      horizonDays: horizon.days,
      confidence: confidenceLevel,
      simulations: MONTE_CARLO_SIMULATIONS,
    })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((err) => {
        if (!cancelled) {
          setResult(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysis.portfolio_id, horizon.days, confidenceLevel])

  const horizonLabel = t(`performanceWindows.${horizon.label}`, { ns: 'assets' })

  return (
    <section className="panel">
      <div className="panel-header-row">
        <h2>{t('monteCarlo.title')}</h2>
        <div className="candle-range-tabs">
          {MONTE_CARLO_HORIZONS.map((h, i) => (
            <button
              key={h.label}
              type="button"
              className={i === horizonIndex ? 'candle-range-tab is-active' : 'candle-range-tab'}
              onClick={() => setHorizonIndex(i)}
            >
              {t(`performanceWindows.${h.label}`, { ns: 'assets' })}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('monteCarlo.intro', {
          count: MONTE_CARLO_SIMULATIONS.toLocaleString(currentLocale()),
          horizon: horizonLabel,
        })}
      </p>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('monteCarlo.loading')}</p>}
      {!loading && !error && !result && <p className="muted">{t('monteCarlo.insufficientData')}</p>}
      {!loading && !error && result && (
        <>
          <div className="card-grid">
            <Card
              label={t('monteCarlo.var', { confidence: (confidenceLevel * 100).toFixed(0), horizon: horizonLabel })}
              value={formatPercent(result.value_at_risk_percent)}
            />
            <Card
              label={t('monteCarlo.cvar', { confidence: (confidenceLevel * 100).toFixed(0), horizon: horizonLabel })}
              value={formatPercent(result.conditional_value_at_risk_percent)}
            />
            <Card label={t('monteCarlo.probabilityOfLoss')} value={formatPercent(result.probability_of_loss)} />
            <Card label={t('monteCarlo.expectedValue')} value={result.expected_value.toFixed(1)} />
            <Card label={t('monteCarlo.bestCase')} value={result.best_case.toFixed(1)} />
            <Card label={t('monteCarlo.worstCase')} value={result.worst_case.toFixed(1)} />
          </div>
          <div className="candle-range-tabs" style={{ marginBottom: 12 }}>
            {MONTE_CARLO_CONFIDENCE_LEVELS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === confidenceLevel ? 'candle-range-tab is-active' : 'candle-range-tab'}
                onClick={() => setConfidenceLevel(c)}
              >
                {t('monteCarlo.confidenceTab', { confidence: (c * 100).toFixed(0) })}
              </button>
            ))}
          </div>
          <LineChart
            labels={result.days.map((d) => (d === 0 ? t('monteCarlo.today') : t('monteCarlo.dayLabel', { day: d })))}
            datasets={[
              {
                label: t('monteCarlo.upperBound', { value: (confidenceLevel * 100).toFixed(0) }),
                data: result.upper_bound,
                color: '#5b9dee',
              },
              {
                label: t('monteCarlo.lowerBound', { value: ((1 - confidenceLevel) * 100).toFixed(0) }),
                data: result.lower_bound,
                color: '#5b9dee',
                fillToDatasetIndex: 0,
              },
              { label: t('monteCarlo.medianScenario'), data: result.p50, color: '#c9a15f' },
            ]}
          />
        </>
      )}
    </section>
  )
})

const GOAL_HORIZON_YEARS = [5, 10, 15, 20] as const

function formatMonths(months: number, t: TFunction<'portfolio'>): string {
  if (months <= 0) return t('goalPlanning.reachedAlready')
  const years = Math.floor(months / 12)
  const remMonths = months % 12
  if (years === 0) return t('goalPlanning.months', { count: remMonths })
  if (remMonths === 0) return t('goalPlanning.years', { count: years })
  return t('goalPlanning.yearsAndMonths', { years, months: remMonths })
}

const GoalPlanningSection = memo(function GoalPlanningSection({ analysis }: { analysis: PortfolioAnalysis }) {
  const { t } = useTranslation('portfolio')
  useTheme() // re-render on theme toggle so the Chart.js color read below stays current
  const dangerColor = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#ec5f66'
  const [initialValue, setInitialValue] = useState('100000')
  const [monthlyContribution, setMonthlyContribution] = useState('5000')
  const [targetValue, setTargetValue] = useState('1000000')
  const [horizonYears, setHorizonYears] = useState<(typeof GOAL_HORIZON_YEARS)[number]>(10)
  const [result, setResult] = useState<GoalProjectionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedInitial = Number(initialValue)
  const parsedContribution = Number(monthlyContribution)
  const parsedTarget = Number(targetValue)
  const inputsValid =
    initialValue !== '' &&
    monthlyContribution !== '' &&
    targetValue !== '' &&
    Number.isFinite(parsedInitial) &&
    Number.isFinite(parsedContribution) &&
    Number.isFinite(parsedTarget) &&
    parsedTarget > 0

  useEffect(() => {
    if (!inputsValid) {
      setResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getPortfolioGoalProjection(analysis.portfolio_id, {
      initial: parsedInitial,
      monthly: parsedContribution,
      target: parsedTarget,
      horizonMonths: horizonYears * 12,
    })
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((err) => {
        if (!cancelled) {
          setResult(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysis.portfolio_id, inputsValid, parsedInitial, parsedContribution, parsedTarget, horizonYears])

  return (
    <section className="panel">
      <div className="panel-header-row">
        <h2>{t('goalPlanning.title')}</h2>
        <div className="candle-range-tabs">
          {GOAL_HORIZON_YEARS.map((y) => (
            <button
              key={y}
              type="button"
              className={y === horizonYears ? 'candle-range-tab is-active' : 'candle-range-tab'}
              onClick={() => setHorizonYears(y)}
            >
              {t('goalPlanning.yearSuffix', { years: y })}
            </button>
          ))}
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 18 }}>
        {t('goalPlanning.intro', { count: MONTE_CARLO_SIMULATIONS.toLocaleString(currentLocale()) })}
      </p>
      <div className="portfolio-row" style={{ marginBottom: 18 }}>
        <input
          type="number"
          placeholder={t('goalPlanning.initialAmount')}
          aria-label={t('goalPlanning.initialAmount')}
          value={initialValue}
          onChange={(e) => setInitialValue(e.target.value)}
          min={0}
          step="any"
        />
        <input
          type="number"
          placeholder={t('goalPlanning.monthlyContribution')}
          aria-label={t('goalPlanning.monthlyContribution')}
          value={monthlyContribution}
          onChange={(e) => setMonthlyContribution(e.target.value)}
          min={0}
          step="any"
        />
        <input
          type="number"
          placeholder={t('goalPlanning.targetAmount')}
          aria-label={t('goalPlanning.targetAmount')}
          value={targetValue}
          onChange={(e) => setTargetValue(e.target.value)}
          min={0}
          step="any"
        />
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('goalPlanning.loading')}</p>}
      {!loading && !error && !result && <p className="muted">{t('goalPlanning.insufficientData')}</p>}

      {!loading && !error && result && (
        <>
          <div className="card-grid">
            <Card
              label={t('goalPlanning.medianTime')}
              value={
                result.median_months_to_goal !== null
                  ? formatMonths(result.median_months_to_goal, t)
                  : t('goalPlanning.notReachedInYears', { years: horizonYears })
              }
            />
            <Card
              label={t('goalPlanning.optimisticScenario')}
              value={result.optimistic_months_to_goal !== null ? formatMonths(result.optimistic_months_to_goal, t) : '—'}
            />
            <Card
              label={t('goalPlanning.pessimisticScenario')}
              value={result.pessimistic_months_to_goal !== null ? formatMonths(result.pessimistic_months_to_goal, t) : '—'}
            />
            <Card
              label={t('goalPlanning.probabilityWithinYears', { years: horizonYears })}
              value={formatPercent(result.probability_within_horizon)}
            />
          </div>
          <LineChart
            labels={result.months.map((m) => `${m}A`)}
            datasets={[
              { label: t('goalPlanning.upperBound'), data: result.upper_path, color: '#5b9dee' },
              { label: t('goalPlanning.lowerBound'), data: result.lower_path, color: '#5b9dee', fillToDatasetIndex: 0 },
              { label: t('goalPlanning.medianScenario'), data: result.median_path, color: '#c9a15f' },
              {
                label: t('goalPlanning.target'),
                data: result.months.map(() => result.target_value),
                color: dangerColor,
                dashed: true,
              },
            ]}
          />
        </>
      )}
    </section>
  )
})

function PortfolioComparisonSection({ portfolios }: { portfolios: Portfolio[] }) {
  const { t } = useTranslation('portfolio')
  const [selected, setSelected] = useState<number[]>([])
  const [analysesById, setAnalysesById] = useState<Record<number, PortfolioAnalysis>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelected(portfolios.map((p) => p.id))
  }, [portfolios])

  useEffect(() => {
    if (selected.length === 0) return
    setLoading(true)
    setError(null)
    Promise.all(
      selected.map((id) =>
        getPortfolioAnalysis(id)
          .then((a) => [id, a] as const)
          .catch(() => [id, null] as const),
      ),
    )
      .then((results) => {
        setAnalysesById((prev) => {
          const next = { ...prev }
          for (const [id, analysis] of results) {
            if (analysis) next[id] = analysis
          }
          return next
        })
        if (results.every(([, a]) => a === null)) {
          setError(t('comparison.loadFailed'))
        }
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  if (portfolios.length < 2) return null

  const datasets = selected
    .map((id) => analysesById[id])
    .filter((a): a is PortfolioAnalysis => !!a)
    .map((a) => ({ label: a.name, data: a.portfolio_index.map((p) => p.value) }))
  const labels = selected
    .map((id) => analysesById[id])
    .find((a): a is PortfolioAnalysis => !!a)?.portfolio_index.map((p) => p.date)

  return (
    <section className="panel">
      <h2>{t('comparison.title')}</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t('comparison.intro')}
      </p>
      <div className="portfolio-list" style={{ marginBottom: 16 }}>
        {portfolios.map((p) => (
          <button
            key={p.id}
            type="button"
            className={selected.includes(p.id) ? 'portfolio-link active' : 'portfolio-link'}
            onClick={() => toggle(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('comparison.loading')}</p>}
      {!loading && datasets.length > 0 && labels && <LineChart labels={labels} datasets={datasets} />}
      {!loading && datasets.length === 0 && !error && (
        <p className="muted">{t('comparison.selectAtLeastOne')}</p>
      )}
    </section>
  )
}

function PortfolioBuilderPage() {
  const { t } = useTranslation('portfolio')
  const [assets, setAssets] = useState<AssetSummary[]>([])
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [name, setName] = useState('')
  const [rows, setRows] = useState<AssetRow[]>([EMPTY_ROW])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [holdingsVersion, setHoldingsVersion] = useState(0)
  const [benchmarkPreset, setBenchmarkPreset] = useState('')
  const [customBenchmarkSymbol, setCustomBenchmarkSymbol] = useState('')
  const [customBenchmarkLabel, setCustomBenchmarkLabel] = useState('')
  const [shareTokens, setShareTokens] = useState<Record<number, string>>({})
  const [shareError, setShareError] = useState<string | null>(null)
  const [csvPreview, setCsvPreview] = useState<PortfolioCsvParseResult | null>(null)
  const indexChartRef = useRef<ChartJSInstance<'line'>>(null)
  const allocationChartRef = useRef<ChartJSInstance<'doughnut'>>(null)
  const csvFileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const pending = (location.state as { addAfterLogin?: SymbolSearchResult } | null)?.addAfterLogin
    if (!pending) return
    trackAsset(pending)
      .then((asset) => navigate(`/assets/${asset.ticker}`, { replace: true }))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const loadPortfolios = () => {
    getPortfolios()
      .then(setPortfolios)
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    getAssets().then(setAssets).catch((err) => setError(err.message))
    loadPortfolios()
  }, [])

  useEffect(() => {
    if (selectedPortfolioId === null) {
      setAnalysis(null)
      return
    }
    // Guards against an out-of-order response: switching the selected portfolio
    // quickly before the previous fetch resolves could otherwise land a stale
    // portfolio's analysis on screen under the newly-selected one.
    let cancelled = false
    setLoadingAnalysis(true)
    getPortfolioAnalysis(selectedPortfolioId)
      .then((data) => {
        if (!cancelled) setAnalysis(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingAnalysis(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPortfolioId])

  // Re-runs the full analysis (correlation, benchmark overlay, ...) the moment the
  // backend actually refreshes prices (~5 min) — not a blind poll, and skipped
  // entirely while no portfolio is selected.
  useLiveSignal('prices-updated', () => {
    if (selectedPortfolioId === null) return
    getPortfolioAnalysis(selectedPortfolioId)
      .then(setAnalysis)
      .catch(() => {}) // silent — background refresh shouldn't surface a page-level error
  })

  const totalWeight = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0)

  const updateRow = (index: number, patch: Partial<AssetRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }])
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const distributeEqually = () => {
    setRows((prev) => {
      const filledCount = prev.filter((r) => r.ticker).length
      if (filledCount === 0) return prev
      const equalShare = (100 / filledCount).toFixed(2)
      return prev.map((r) => (r.ticker ? { ...r, weight: equalShare } : r))
    })
  }

  const handleWeightsCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvPreview(parsePortfolioWeightsCsv(String(reader.result ?? ''), assets.map((a) => a.ticker)))
      if (csvFileInputRef.current) csvFileInputRef.current.value = ''
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleApplyCsvPreview = () => {
    if (!csvPreview || csvPreview.rows.length === 0) return
    setRows(csvPreview.rows.map((r) => ({ ticker: r.ticker, weight: r.weight })))
    setCsvPreview(null)
  }

  const handleDownloadWeightsTemplate = () => {
    downloadCsv('portfoy-agirliklari-sablonu.csv', [
      ['ticker', 'weight'],
      ['THYAO', '60'],
      ['ASELS', '40'],
    ])
  }

  const resetForm = () => {
    setName('')
    setRows([{ ...EMPTY_ROW }])
    setEditingId(null)
    setBenchmarkPreset('')
    setCustomBenchmarkSymbol('')
    setCustomBenchmarkLabel('')
  }

  const handleEdit = async (id: number) => {
    setError(null)
    try {
      const detail = await getPortfolioDetail(id)
      setName(detail.name)
      setRows(detail.assets.map((a) => ({ ticker: a.ticker, weight: String(a.weight) })))
      setEditingId(id)
      if (detail.benchmark_symbol && BENCHMARK_PRESETS.some((p) => p.symbol === detail.benchmark_symbol)) {
        setBenchmarkPreset(detail.benchmark_symbol)
        setCustomBenchmarkSymbol('')
        setCustomBenchmarkLabel('')
      } else if (detail.benchmark_symbol) {
        setBenchmarkPreset('custom')
        setCustomBenchmarkSymbol(detail.benchmark_symbol)
        setCustomBenchmarkLabel(detail.benchmark_label ?? '')
      } else {
        setBenchmarkPreset('')
        setCustomBenchmarkSymbol('')
        setCustomBenchmarkLabel('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleShare = async (id: number) => {
    setShareError(null)
    try {
      const token = await createShareLink(id)
      setShareTokens((prev) => ({ ...prev, [id]: token }))
    } catch (err) {
      setShareError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUnshare = async (id: number) => {
    setShareError(null)
    try {
      await deleteShareLink(id)
      setShareTokens((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch (err) {
      setShareError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deletePortfolio(id)
      setDeleteConfirmId(null)
      if (selectedPortfolioId === id) setSelectedPortfolioId(null)
      if (editingId === id) resetForm()
      loadPortfolios()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const validRows = rows.filter((r) => r.ticker)
    if (validRows.length === 0) {
      setError(t('builder.atLeastOneAssetRequired'))
      return
    }
    const assetsInput = validRows.map((r) => ({ ticker: r.ticker, weight: Number(r.weight) }))

    let benchmarkSymbol: string | null = null
    let benchmarkLabel: string | null = null
    if (benchmarkPreset === 'custom') {
      benchmarkSymbol = customBenchmarkSymbol.trim() || null
      benchmarkLabel = customBenchmarkLabel.trim() || null
    } else if (benchmarkPreset) {
      benchmarkSymbol = benchmarkPreset
      benchmarkLabel = BENCHMARK_PRESETS.find((p) => p.symbol === benchmarkPreset)?.label ?? null
    }

    try {
      if (editingId !== null) {
        await updatePortfolio(editingId, name, assetsInput, benchmarkSymbol, benchmarkLabel)
        setSelectedPortfolioId(editingId)
      } else {
        const created = await createPortfolio(name, assetsInput, benchmarkSymbol, benchmarkLabel)
        setSelectedPortfolioId(created.id)
      }
      resetForm()
      loadPortfolios()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const applySuggestedWeights = (weights: { ticker: string; weight: number }[]) => {
    if (!analysis) return
    setName(analysis.name)
    setRows(weights.map((w) => ({ ticker: w.ticker, weight: w.weight.toFixed(2) })))
    setEditingId(analysis.portfolio_id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleExportCsv = () => {
    if (!analysis) return
    const rowsOut: string[][] = [
      [t('builder.exportPortfolioLabel'), analysis.name],
      [],
      [t('builder.selectAsset'), t('builder.exportWeightLabel')],
      ...analysis.weights.map((w) => [w.ticker, (w.weight * 100).toFixed(2)]),
      [],
      [t('builder.exportMetricLabel'), t('builder.exportValueLabel')],
      [t('builder.totalReturn'), formatPercent(analysis.summary.total_return)],
      [t('builder.avgDailyReturn'), formatPercent(analysis.summary.average_return)],
      [t('builder.annualVolatility'), formatPercent(analysis.summary.volatility)],
      [t('builder.maxDrawdown'), formatPercent(analysis.summary.max_drawdown)],
      [t('builder.sharpeRatio'), analysis.summary.sharpe_ratio.toFixed(2)],
    ]
    downloadCsv(`${analysis.name.replace(/\s+/g, '-')}-rapor.csv`, rowsOut)
  }

  const handleExportPdf = async () => {
    if (!analysis) return
    // jsPDF + jspdf-autotable (and jsPDF's own optional html2canvas/DOMPurify deps)
    // are a real weight (~150kB gzip) — dynamic-imported so viewing this page (or
    // using the CSV export) never pays for it, only actually clicking this button does.
    const { generatePortfolioPdf } = await import('../lib/pdf')
    generatePortfolioPdf(analysis, {
      indexChart: indexChartRef.current?.toBase64Image(),
      allocationChart: allocationChartRef.current?.toBase64Image(),
    })
  }

  // Memoized: analysis is re-fetched on portfolio selection, not on every render, so
  // rebuilding this Map (and re-running the O(n^2) alert scan below) on unrelated state
  // changes (typing in a form field, dragging a weight slider) is wasted work.
  const benchmarkByDate = useMemo(
    () => new Map(analysis?.benchmark.map((b) => [b.date, b.value]) ?? []),
    [analysis],
  )
  const hasBenchmark = (analysis?.benchmark.length ?? 0) > 0
  const portfolioAlerts = useMemo(() => (analysis ? buildPortfolioAlerts(analysis, t) : []), [analysis, t])

  return (
    <div>
      <PageHeader icon={PieChart} title={t('builder.title')} subtitle={t('builder.subtitle')} />

      {error && <p className="error">{error}</p>}

      <section className="panel">
        <h2>{editingId !== null ? t('builder.editPortfolio') : t('builder.newPortfolio')}</h2>
        <form onSubmit={handleSubmit} className="portfolio-form">
          <input
            placeholder={t('builder.portfolioNamePlaceholder')}
            aria-label={t('builder.portfolioNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          {rows.map((row, i) => (
            <div className="portfolio-row" key={i}>
              <select
                value={row.ticker}
                onChange={(e) => updateRow(i, { ticker: e.target.value })}
                aria-label={t('builder.selectAsset')}
                required
              >
                <option value="">{t('builder.selectAsset')}</option>
                {assets.map((a) => (
                  <option key={a.ticker} value={a.ticker}>
                    {a.ticker}
                  </option>
                ))}
              </select>
              <input
                type="range"
                className="weight-slider"
                value={row.weight === '' ? 0 : Math.min(100, Number(row.weight) || 0)}
                onChange={(e) => updateRow(i, { weight: e.target.value })}
                min={0}
                max={100}
                step={1}
                aria-label={t('builder.weightAria', { ticker: row.ticker || t('builder.selectAsset') })}
              />
              <input
                type="number"
                className="weight-number"
                placeholder={t('builder.weightPercentPlaceholder')}
                aria-label={t('builder.weightPercentAria', { ticker: row.ticker || t('builder.selectAsset') })}
                value={row.weight}
                onChange={(e) => updateRow(i, { weight: e.target.value })}
                min={0}
                max={100}
                step="any"
                required
              />
              {rows.length > 1 && (
                <button type="button" onClick={() => removeRow(i)} className="btn-ghost">
                  {t('builder.delete')}
                </button>
              )}
            </div>
          ))}

          <div className="portfolio-row" style={{ marginBottom: 8 }}>
            <label
              className="btn-secondary"
              style={{ cursor: 'pointer' }}
            >
              {t('builder.importWeightsCsv')}
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleWeightsCsvFile}
                style={{ display: 'none' }}
              />
            </label>
            <button type="button" className="btn-ghost" onClick={handleDownloadWeightsTemplate}>
              {t('builder.downloadWeightsTemplate')}
            </button>
          </div>

          {csvPreview && (
            <div className="portfolio-row" style={{ flexDirection: 'column', alignItems: 'stretch', marginBottom: 16 }}>
              {csvPreview.rows.length > 0 && (
                <div className="table-scroll" style={{ marginBottom: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('builder.selectAsset')}</th>
                        <th>{t('builder.weightPercentPlaceholder')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.ticker}</td>
                          <td>{r.weight}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {csvPreview.errors.length > 0 && (
                <ul className="muted" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
                  {csvPreview.errors.map((e, i) => (
                    <li key={i}>{t('holdings.rowError', { row: e.row, message: e.message })}</li>
                  ))}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleApplyCsvPreview}
                  disabled={csvPreview.rows.length === 0}
                >
                  {t('builder.applyCsvWeights')}
                </button>
                <button type="button" className="btn-ghost" onClick={() => setCsvPreview(null)}>
                  {t('builder.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="portfolio-row">
            <label htmlFor="benchmark-preset" className="muted" style={{ fontSize: 13 }}>
              {t('builder.benchmarkLabel')}
            </label>
            <select
              id="benchmark-preset"
              value={benchmarkPreset}
              onChange={(e) => setBenchmarkPreset(e.target.value)}
            >
              <option value="">{t('builder.benchmarkDefault')}</option>
              {BENCHMARK_PRESETS.map((p) => (
                <option key={p.symbol} value={p.symbol}>
                  {p.label}
                </option>
              ))}
              <option value="custom">{t('builder.benchmarkCustom')}</option>
            </select>
            {benchmarkPreset === 'custom' && (
              <>
                <input
                  placeholder={t('builder.benchmarkCustomSymbolPlaceholder')}
                  aria-label={t('builder.benchmarkCustomSymbolPlaceholder')}
                  value={customBenchmarkSymbol}
                  onChange={(e) => setCustomBenchmarkSymbol(e.target.value)}
                  required
                />
                <input
                  placeholder={t('builder.benchmarkCustomLabelPlaceholder')}
                  aria-label={t('builder.benchmarkCustomLabelPlaceholder')}
                  value={customBenchmarkLabel}
                  onChange={(e) => setCustomBenchmarkLabel(e.target.value)}
                  required
                />
              </>
            )}
          </div>

          <div className="portfolio-form-footer">
            <button type="button" onClick={addRow} className="btn-secondary">
              {t('builder.addAsset')}
            </button>
            <button type="button" onClick={distributeEqually} className="btn-secondary">
              {t('builder.distributeEqually')}
            </button>
            <span className={totalWeight === 100 ? 'weight-ok' : 'weight-warn'}>
              {t('builder.totalWeight', { total: totalWeight.toFixed(2) })}
            </span>
            <button type="submit" className="btn-primary">
              {editingId !== null ? t('builder.saveChanges') : t('builder.createPortfolio')}
            </button>
            {editingId !== null && (
              <button type="button" className="btn-ghost" onClick={resetForm}>
                {t('builder.cancel')}
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>{t('builder.myPortfolios')}</h2>
        {shareError && <p className="error">{shareError}</p>}
        {portfolios.length === 0 && <EmptyState icon={FolderOpen}>{t('builder.noPortfoliosYet')}</EmptyState>}
        <ul className="portfolio-list">
          {portfolios.map((p) => (
            <li key={p.id} className="portfolio-list-item">
              <button
                type="button"
                className={p.id === selectedPortfolioId ? 'portfolio-link active' : 'portfolio-link'}
                onClick={() => setSelectedPortfolioId(p.id)}
              >
                {p.name}
              </button>
              <button type="button" className="btn-ghost" onClick={() => handleEdit(p.id)}>
                {t('builder.edit')}
              </button>
              {shareTokens[p.id] ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() =>
                      navigator.clipboard.writeText(`${window.location.origin}/paylasilan/${shareTokens[p.id]}`)
                    }
                  >
                    {t('builder.copyShareLink')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => handleUnshare(p.id)}>
                    {t('builder.unshare')}
                  </button>
                </>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => handleShare(p.id)}>
                  {t('builder.share')}
                </button>
              )}
              {deleteConfirmId === p.id ? (
                <span className="delete-confirm">
                  {t('builder.confirmDelete')}
                  <button type="button" className="btn-ghost weight-warn" onClick={() => handleDelete(p.id)}>
                    {t('builder.confirmDeleteYes')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setDeleteConfirmId(null)}>
                    {t('builder.cancel')}
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => setDeleteConfirmId(p.id)}>
                  {t('builder.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <PortfolioComparisonSection portfolios={portfolios} />

      {loadingAnalysis && (
        <section className="panel">
          <Skeleton width={220} height={18} className="mono" />
          <div className="card-grid" style={{ marginTop: 18 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="card" key={i}>
                <Skeleton width={80} height={11} />
                <div style={{ marginTop: 10 }}>
                  <Skeleton width={70} height={22} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <Skeleton height={280} />
          </div>
        </section>
      )}

      {analysis && !loadingAnalysis && (
        <>
          <section className="panel">
            <div className="panel-header-row">
              <h2>{t('builder.performanceTitle', { name: analysis.name })}</h2>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => window.print()}>
                  {t('builder.printPdf')}
                </button>
                <button type="button" className="btn-secondary" onClick={handleExportCsv}>
                  {t('builder.downloadCsv')}
                </button>
                <button type="button" className="btn-secondary" onClick={handleExportPdf}>
                  {t('builder.downloadPdf')}
                </button>
              </div>
            </div>
            <RiskAlerts alerts={portfolioAlerts} />
            <div className="card-grid">
              <Card label={t('builder.totalReturn')} value={formatPercent(analysis.summary.total_return)} />
              <Card label={t('builder.avgDailyReturn')} value={formatPercent(analysis.summary.average_return)} />
              <Card label={t('builder.annualVolatility')} value={formatPercent(analysis.summary.volatility)} />
              <Card label={t('builder.maxDrawdown')} value={formatPercent(analysis.summary.max_drawdown)} />
              <Card label={t('builder.sharpeRatio')} value={analysis.summary.sharpe_ratio.toFixed(2)} />
              <Card label={t('builder.assetCount')} value={String(analysis.weights.length)} />
            </div>
            <LineChart
              ref={indexChartRef}
              ariaLabel={t('builder.chartAriaLabel', { name: analysis.name })}
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

          <AllocationSection analysis={analysis} donutRef={allocationChartRef} />
          <RiskMetricsSection analysis={analysis} />
          <ExposureSection analysis={analysis} />
          <OptimizationSection analysis={analysis} onApplyWeights={applySuggestedWeights} />
          <CorrelationSection analysis={analysis} />
          <StressTestSection analysis={analysis} />
          <BacktestSection analysis={analysis} />
          <MonteCarloSection analysis={analysis} />
          <GoalPlanningSection analysis={analysis} />
          <HoldingsPanel
            portfolioId={analysis.portfolio_id}
            assets={assets}
            onHoldingsChanged={() => setHoldingsVersion((v) => v + 1)}
          />
          <RebalancingSection
            portfolioId={analysis.portfolio_id}
            targetWeights={Object.fromEntries(analysis.weights.map((w) => [w.ticker, w.weight]))}
            refreshKey={holdingsVersion}
          />
        </>
      )}
    </div>
  )
}

export default PortfolioBuilderPage
