import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'pa_theme'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readInitialTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** App-wide light/dark theme, defaulting to (and preserving) the original dark
 * trading-terminal look — light is an opt-in the user reaches via the topbar toggle,
 * not a `prefers-color-scheme` default. `index.html` applies the saved choice
 * synchronously before first paint to avoid a flash of the wrong theme; this provider
 * keeps `<html data-theme>` and localStorage in sync with React state afterward. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5f7' : '#0a0e14')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // localStorage can throw in private-browsing/quota-exceeded contexts — the
      // toggle still works for the session, it just won't persist across reloads.
    }
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
