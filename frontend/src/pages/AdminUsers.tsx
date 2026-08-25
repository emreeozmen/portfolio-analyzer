import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { getAdminUsers, type AdminUser } from '../api'
import Card from '../components/Card'
import PageHeader from '../components/PageHeader'
import EmptyState from '../components/EmptyState'

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
}

// Owner-only utility page, not part of the app's localized product surface — see
// routers/auth.py's _require_admin. Every other account gets a 403 from the backend
// regardless of what this page renders, so the error state below is expected/normal
// for anyone but the configured admin account, not a bug to chase.
function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const activeLast7d = users?.filter((u) => {
    if (!u.last_seen_at) return false
    return Date.now() - new Date(u.last_seen_at).getTime() < 7 * 24 * 60 * 60 * 1000
  }).length ?? 0

  return (
    <div>
      <PageHeader icon={Users} title="Kayıtlı Kullanıcılar" subtitle="Sadece yönetici hesabına görünür." />
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Yükleniyor...</p>}

      {!loading && users && users.length === 0 && (
        <div className="panel">
          <EmptyState icon={Users}>Henüz kayıtlı kullanıcı yok.</EmptyState>
        </div>
      )}

      {!loading && users && users.length > 0 && (
        <section className="panel">
          <div className="card-grid">
            <Card label="Toplam Kullanıcı" value={String(users.length)} />
            <Card label="Son 7 Günde Aktif" value={String(activeLast7d)} />
          </div>

          <div className="table-scroll" style={{ marginTop: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>E-posta</th>
                  <th>Kayıt Tarihi</th>
                  <th>Son Aktif</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.email}</td>
                    <td>{formatDateTime(u.created_at)}</td>
                    <td>{formatDateTime(u.last_seen_at)}</td>
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

export default AdminUsersPage
