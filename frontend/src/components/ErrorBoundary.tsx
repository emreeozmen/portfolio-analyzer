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
