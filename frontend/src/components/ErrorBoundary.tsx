import { Component, type ErrorInfo, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { TriangleAlert } from 'lucide-react'
import i18n from '../i18n'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

// A tab left open across a new deploy still has the OLD index.html's chunk manifest in
// memory — clicking through to a lazy route not yet loaded in this session then requests
// a chunk file (e.g. AssetScreener-<oldhash>.js) that Vercel's CDN no longer serves,
// since the new deploy replaced it with a new hash. This is exactly what "the page won't
// open, refreshing fixes it" looks like from the outside: a plain reload re-fetches the
// current index.html and its correct (current) chunk manifest. Auto-doing that reload
// once removes the manual step. The sessionStorage guard stops a reload loop if the
// error is something else entirely that a reload can't actually fix (e.g. a real outage).
const STALE_CHUNK_RELOAD_KEY = 'pa_stale_chunk_reload_at'
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000

function isStaleChunkError(error: Error): boolean {
  return /fetch dynamically imported module|importing a module script failed|dynamically imported module/i.test(
    error.message,
  )
}

// A plain reload() is still served by whichever service worker already controls this
// tab — the PWA's own cached app shell — so it does NOT by itself fetch the new deploy's
// index.html/chunk manifest; the reload can reproduce the exact same stale-chunk error
// forever. Telling the registration to check for an update and waiting for the resulting
// new worker to actually take over (the 'controllerchange' event) before reloading is
// what actually gets fresh content. Falls straight to a plain reload if there's no
// service worker at all, or if no new one shows up within a few seconds (e.g. this tab's
// worker genuinely was already current, and the error has some other cause).
function reloadPastServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    window.location.reload()
    return
  }
  let done = false
  const reloadOnce = () => {
    if (done) return
    done = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true })
  navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(reloadOnce)
  setTimeout(reloadOnce, 4000)
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uygulama hatası:', error, info.componentStack)
    // A no-op when VITE_SENTRY_DSN is unset (see main.tsx) — this is the one place a
    // React render-time error is ever seen at all, since it doesn't reach window.onerror.
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } })

    if (isStaleChunkError(error)) {
      const lastReload = Number(sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? '0')
      if (Date.now() - lastReload > STALE_CHUNK_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()))
        reloadPastServiceWorker()
      }
    }
  }

  handleReload = () => {
    this.setState({ error: null })
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-icon error-boundary-icon-danger">
              <TriangleAlert size={26} />
            </div>
            <h1>{i18n.t('errorBoundary.title', { ns: 'common' })}</h1>
            <p className="muted">{i18n.t('errorBoundary.body', { ns: 'common' })}</p>
            <p className="error-boundary-detail mono">{this.state.error.message}</p>
            <button type="button" className="btn-primary" onClick={this.handleReload}>
              {i18n.t('errorBoundary.reload', { ns: 'common' })}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
