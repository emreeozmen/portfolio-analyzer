import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { deleteAlert, getAlerts, markAllAlertsRead, type PriceAlert } from '../api'
import { useLiveData } from '../lib/LiveDataContext'
import { alertText, formatAlertDateTime } from '../lib/alertLabels'

interface LiveAlertEvent {
  id: number
  ticker: string
  condition: PriceAlert['condition']
  threshold: number
  triggered_at: string
}

function NotificationBell() {
  const { t } = useTranslation('common')
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { subscribe } = useLiveData()

  useEffect(() => {
    getAlerts()
      .then(setAlerts)
      .catch(() => {}) // silent — a notification bell shouldn't surface fetch errors as a page-level error
  }, [])

  useEffect(() => {
    // The "alerts" channel is per-user (see backend/services/ws_manager.py) and only
    // carries an alert at the instant it triggers — prepend it rather than replacing
    // the list, since (unlike quotes/news) this is a stream of discrete events, not a
    // repeating snapshot.
    return subscribe('alerts', (payload) => {
      const event = payload as LiveAlertEvent
      setAlerts((prev) => [
        {
          id: event.id,
          ticker: event.ticker,
          condition: event.condition,
          threshold: event.threshold,
          is_active: false,
          is_triggered: true,
          is_read: false,
          created_at: event.triggered_at,
          triggered_at: event.triggered_at,
        },
        ...prev.filter((a) => a.id !== event.id),
      ])
    })
  }, [subscribe])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const triggered = alerts.filter((a) => a.is_triggered)
  const unreadCount = triggered.filter((a) => !a.is_read).length

  const handleToggle = () => {
    setOpen((prev) => !prev)
    if (!open && unreadCount > 0) {
      markAllAlertsRead()
        .then(() => setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true }))))
        .catch(() => {})
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteAlert(id)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch {
      // best-effort — leave the alert in the list if deletion failed
    }
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn-ghost notification-bell-trigger"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? t('notifications.ariaWithUnread', { count: unreadCount }) : t('notifications.aria')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        🔔
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>
      {/* Always present in the DOM (rather than conditionally mounted) so screen
       * readers reliably announce it when the text actually changes — a new alert
       * arriving while the tab is open is exactly the kind of infrequent, important
       * event aria-live is for, unlike the continuously-updating price tickers. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {unreadCount > 0 ? t('notifications.ariaWithUnread', { count: unreadCount }) : ''}
      </span>
      {open && (
        <div className="notification-dropdown">
          {triggered.length === 0 ? (
            <p className="muted" style={{ padding: '12px 14px' }}>
              {t('notifications.empty')}
            </p>
          ) : (
            <ul className="notification-list">
              {triggered.map((a) => (
                <li key={a.id} className="notification-item">
                  <Link to={`/assets/${a.ticker}`} className="notification-item-text" onClick={() => setOpen(false)}>
                    <span>{alertText(a)}</span>
                    {a.triggered_at && <span className="notification-item-time">{formatAlertDateTime(a.triggered_at)}</span>}
                  </Link>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => handleDelete(a.id)}
                    aria-label={t('notifications.deleteAria')}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/uyarilar" className="notification-view-all" onClick={() => setOpen(false)}>
            {t('notifications.viewAll')}
          </Link>
        </div>
      )}
    </div>
  )
}

export default NotificationBell
