import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { STORAGE_KEY, type SupportedLanguage } from '../i18n'

interface LanguageContextValue {
  language: SupportedLanguage
  toggleLanguage: () => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

/** App-wide TR/EN toggle, mirroring lib/ThemeContext.tsx's pattern: React state is
 * the source of truth, kept in sync with i18next's active language and localStorage.
 * Turkish stays the default (the app's original, deliberate design per CLAUDE.md) —
 * English is an opt-in the user reaches via the topbar toggle. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const [language, setLanguage] = useState<SupportedLanguage>(i18n.language === 'en' ? 'en' : 'tr')

  useEffect(() => {
    i18n.changeLanguage(language)
    document.documentElement.setAttribute('lang', language)
    try {
      localStorage.setItem(STORAGE_KEY, language)
    } catch {
      // Same tolerance as ThemeContext — the toggle still works for the session.
    }
  }, [language, i18n])

  const toggleLanguage = () => setLanguage((l) => (l === 'tr' ? 'en' : 'tr'))

  return <LanguageContext.Provider value={{ language, toggleLanguage }}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
