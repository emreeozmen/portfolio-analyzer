import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'
import { getTaxReport, type YearlyRealizedPL } from '../api'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { downloadCsv } from '../lib/csv'
import { formatMoney } from '../lib/currency'

// Sale records aren't currency-tagged individually (see backend
// realized_pl_summary/realized_pl_by_year) — same TRY assumption the existing
// HoldingsPanel realized-P&L section already makes for this data.
const CURRENCY = 'TRY'

function TaxReportPage() {
  const { t } = useTranslation('portfolio')
  const [years, setYears] = useState<YearlyRealizedPL[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTaxReport()
      .then((data) => {
        setYears(data)
        if (data.length > 0) setSelectedYear(data[0].year)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const current = years.find((y) => y.year === selectedYear) ?? null

  const handleExportCsv = () => {
    if (!current) return
    const rows: string[][] = [
      [t('taxReport.columnTicker'), t('taxReport.columnProceeds'), t('taxReport.columnCostBasis'), t('taxReport.columnRealizedPl'), t('taxReport.columnSaleCount')],
      ...current.tickers.map((row) => [
        row.ticker,
        row.total_proceeds.toFixed(2),
        row.total_cost_basis.toFixed(2),
        row.total_realized_pl.toFixed(2),
        String(row.sale_count),
      ]),
      [],
      [
        t('taxReport.total'),
        current.total_proceeds.toFixed(2),
        current.total_cost_basis.toFixed(2),
        current.total_realized_pl.toFixed(2),
        String(current.sale_count),
      ],
    ]
    downloadCsv(`vergi-raporu-${current.year}.csv`, rows)
  }

  return (
    <div>
      <PageHeader icon={Receipt} title={t('taxReport.title')} subtitle={t('taxReport.subtitle')} />
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">{t('optimization.calculating')}</p>}

      {!loading && years.length === 0 && (
        <div className="panel">
          <EmptyState icon={Receipt}>{t('taxReport.empty')}</EmptyState>
        </div>
      )}

      {!loading && years.length > 0 && (
        <section className="panel">
          <div className="panel-header-row">
            <div className="candle-range-tabs">
              {years.map((y) => (
                <button
                  key={y.year}
                  type="button"
                  className={y.year === selectedYear ? 'candle-range-tab is-active' : 'candle-range-tab'}
                  onClick={() => setSelectedYear(y.year)}
                >
                  {y.year}
                </button>
              ))}
            </div>
            <button type="button" className="btn-secondary" onClick={handleExportCsv}>
              {t('taxReport.downloadCsv')}
            </button>
          </div>

          {current && (
            <>
              <div className="card-grid" style={{ marginTop: 18 }}>
                <Card label={t('taxReport.totalProceeds')} value={formatMoney(current.total_proceeds, CURRENCY)} />
                <Card label={t('taxReport.totalCostBasis')} value={formatMoney(current.total_cost_basis, CURRENCY)} />
                <div className="card">
                  <div className="card-label">{t('taxReport.totalRealizedPl')}</div>
                  <div className={`card-value ${current.total_realized_pl >= 0 ? 'text-up' : 'text-down'}`}>
                    {formatMoney(current.total_realized_pl, CURRENCY)}
                  </div>
                </div>
                <Card label={t('taxReport.saleCount')} value={String(current.sale_count)} />
              </div>

              <div className="table-scroll" style={{ marginTop: 20 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t('taxReport.columnTicker')}</th>
                      <th>{t('taxReport.columnProceeds')}</th>
                      <th>{t('taxReport.columnCostBasis')}</th>
                      <th>{t('taxReport.columnRealizedPl')}</th>
                      <th>{t('taxReport.columnSaleCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.tickers.map((row) => (
                      <tr key={row.ticker}>
                        <td className="mono">{row.ticker}</td>
                        <td>{formatMoney(row.total_proceeds, CURRENCY)}</td>
                        <td>{formatMoney(row.total_cost_basis, CURRENCY)}</td>
                        <td className={row.total_realized_pl >= 0 ? 'text-up' : 'text-down'}>
                          {formatMoney(row.total_realized_pl, CURRENCY)}
                        </td>
                        <td>{row.sale_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default TaxReportPage
