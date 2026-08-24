import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Coins, Inbox } from 'lucide-react'
import { getDividendHistory, type DividendPayment } from '../api'
import Skeleton from '../components/Skeleton'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { formatMoney } from '../lib/currency'
import { currentLocale } from '../lib/locale'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(currentLocale(), { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Every real dividend payment the user's currently-open holdings actually received,
 * across every portfolio combined — sourced from Yahoo Finance's own per-share
 * dividend history (see backend `GET /holdings/dividends`), grouped one row per
 * (ticker, ex-dividend date). This is a payment history, not a forward-looking
 * calendar: there's no real "upcoming dividend" data source here, so nothing here is
 * a projection — every figure already happened.
 */
function DividendCalendarPage() {
  const { t } = useTranslation('dividends')
  const [payments, setPayments] = useState<DividendPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getDividendHistory()
      .then(setPayments)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const totalTry = useMemo(
    () => payments.reduce((sum, p) => sum + (p.amount_try ?? 0), 0),
    [payments],
  )
  const fxUnavailableCount = useMemo(() => payments.filter((p) => p.amount_try === null).length, [payments])

  return (
    <div>
      <PageHeader icon={Coins} title={t('title')} subtitle={t('intro')} />

      {error && <p className="error">{error}</p>}

      {!loading && payments.length > 0 && (
        <div className="card-grid" style={{ marginBottom: 20 }}>
          <div className="card">
            <div className="card-label">{t('totalIncome')}</div>
            <div className="card-value text-up">{formatMoney(totalTry, 'TRY')}</div>
          </div>
          <div className="card">
            <div className="card-label">{t('paymentCount')}</div>
            <div className="card-value">{payments.length}</div>
          </div>
        </div>
      )}

      {fxUnavailableCount > 0 && (
        <p className="muted" style={{ marginBottom: 16 }}>
          {t('fxUnavailable', { count: fxUnavailableCount })}
        </p>
      )}

      {loading && (
        <div className="panel">
          <div className="table-scroll">
            <table>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Skeleton width={90} height={13} />
                    </td>
                    <td>
                      <Skeleton width={70} height={13} />
                    </td>
                    <td>
                      <Skeleton width={100} height={13} />
                    </td>
                    <td>
                      <Skeleton width={100} height={13} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && payments.length === 0 && !error && (
        <EmptyState icon={Inbox}>
          <Trans t={t} i18nKey="empty" components={{ link: <Link to="/portfolio" /> }} />
        </EmptyState>
      )}

      {!loading && payments.length > 0 && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('columnDate')}</th>
                  <th>{t('columnAsset')}</th>
                  <th>{t('columnPerShare')}</th>
                  <th>{t('columnQuantity')}</th>
                  <th>{t('columnTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={`${p.ticker}-${p.pay_date}`}>
                    <td className="muted">{formatDate(p.pay_date)}</td>
                    <td>
                      <Link to={`/assets/${p.ticker}`} className="mono">
                        {p.ticker}
                      </Link>
                    </td>
                    <td className="mono">{formatMoney(p.amount_per_share, p.currency)}</td>
                    <td className="mono">{p.quantity.toLocaleString(currentLocale())}</td>
                    <td className="mono text-up">{formatMoney(p.amount, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export default DividendCalendarPage
