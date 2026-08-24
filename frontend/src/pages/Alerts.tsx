import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { Bell, BellOff } from 'lucide-react'
import {
  deleteAlert,
  getAlerts,
  getCurrentUser,
  markAlertRead,
  updateNotificationPreferences,
  type CurrentUser,
  type PriceAlert,
} from '../api'
import Skeleton from '../components/Skeleton'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'
import { alertConditionText, formatAlertDateTime } from '../lib/alertLabels'

type StatusFilter = 'all' | 'active' | 'triggered'

function AlertsPage() {
  const { t } = useTranslation('alerts')
  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('page.statusAll') },
    { key: 'active', label: t('page.statusActive') },
    { key: 'triggered', label: t('page.statusTriggered') },
  ]
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [notificationUser, setNotificationUser] = useState<CurrentUser | null>(null)
  const [savingPreference, setSavingPreference] = useState(false)

  useEffect(() => {
    getCurrentUser()
      .then(setNotificationUser)
      .catch(() => setNotificationUser(null))
  }, [])

  const handleToggleEmailAlerts = async () => {
    if (notificationUser === null || savingPreference) return
    const next = !notificationUser.email_alerts_enabled
    setSavingPreference(true)
    setNotificationUser({ ...notificationUser, email_alerts_enabled: next })
    try {
      // Always resend the user's current digest_frequency alongside the toggle — the
      // backend takes both fields together, so omitting it here would silently reset
      // whatever digest preference the user set in Hesap Ayarları > Bildirimler.
      const updated = await updateNotificationPreferences(next, notificationUser.digest_frequency)
      setNotificationUser(updated)
    } catch (err) {
      setNotificationUser(notificationUser)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingPreference(false)
    }
  }

  const load = () => {
    setLoading(true)
    setError(null)
    getAlerts()
      .then(setAlerts)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteAlert(id)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleMarkRead = async (id: number) => {
    try {
      await markAlertRead(id)
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const filtered = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    if (statusFilter === 'active') return sorted.filter((a) => a.is_active)
    if (statusFilter === 'triggered') return sorted.filter((a) => a.is_triggered)
    return sorted
  }, [alerts, statusFilter])

  const counts = useMemo(
    () => ({
      all: alerts.length,
      active: alerts.filter((a) => a.is_active).length,
      triggered: alerts.filter((a) => a.is_triggered).length,
    }),
    [alerts],
  )

  return (
    <div>
      <PageHeader icon={Bell} title={t('page.title')} subtitle={t('page.intro')} />

      {notificationUser !== null && (
        <section className="panel" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={notificationUser.email_alerts_enabled}
              disabled={savingPreference}
              onChange={handleToggleEmailAlerts}
            />
            <span>{t('page.emailToggleLabel')}</span>
          </label>
          <span className="muted" style={{ fontSize: '0.85em' }}>
            {t('page.emailToggleHint')}
          </span>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      {!loading && alerts.length > 0 && (
        <div className="toolbar">
          <div className="candle-range-tabs">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={statusFilter === tab.key ? 'candle-range-tab is-active' : 'candle-range-tab'}
                onClick={() => setStatusFilter(tab.key)}
              >
                {tab.label} ({counts[tab.key]})
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="panel">
          <div className="table-scroll">
            <table>
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td>
                      <Skeleton width={70} height={13} />
                    </td>
                    <td>
                      <Skeleton width={160} height={13} />
                    </td>
                    <td>
                      <Skeleton width={90} height={13} />
                    </td>
                    <td>
                      <Skeleton width={110} height={13} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && alerts.length === 0 && (
        <EmptyState icon={BellOff}>
          <Trans t={t} i18nKey="page.empty" components={{ link: <Link to="/assets" /> }} />
        </EmptyState>
      )}

      {!loading && alerts.length > 0 && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('page.columnAsset')}</th>
                  <th>{t('page.columnCondition')}</th>
                  <th>{t('page.columnStatus')}</th>
                  <th>{t('page.columnCreated')}</th>
                  <th>{t('page.columnTriggered')}</th>
                  <th scope="col" className="sr-only">
                    {t('page.columnActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link to={`/assets/${a.ticker}`} className="mono">
                        {a.ticker}
                      </Link>
                    </td>
                    <td>{alertConditionText(a.condition, a.threshold)}</td>
                    <td>
                      {a.is_triggered ? (
                        <span className={a.is_read ? 'muted' : 'text-up'}>
                          {t('page.triggered')}
                          {!a.is_read && t('page.triggeredNew')}
                        </span>
                      ) : (
                        <span className="muted">{t('page.active')}</span>
                      )}
                    </td>
                    <td className="muted">{formatAlertDateTime(a.created_at)}</td>
                    <td className="muted">{a.triggered_at ? formatAlertDateTime(a.triggered_at) : '—'}</td>
                    <td>
                      {a.is_triggered && !a.is_read && (
                        <button type="button" className="btn-ghost" onClick={() => handleMarkRead(a.id)}>
                          {t('page.markRead')}
                        </button>
                      )}
                      <button type="button" className="btn-ghost weight-warn" onClick={() => handleDelete(a.id)}>
                        {t('page.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="muted" style={{ marginTop: 16 }}>
              {t('page.noneInFilter')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

export default AlertsPage
