import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import './i18n'
import App from './App.tsx'
import { ThemeProvider } from './lib/ThemeContext.tsx'
import { LanguageProvider } from './lib/LanguageContext.tsx'

// A missing/empty DSN makes every Sentry.* call a documented no-op, so this runs
// identically whether or not VITE_SENTRY_DSN is set — get a free one at
// https://sentry.io (New Project → React) and add it to frontend/.env.local.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
)
