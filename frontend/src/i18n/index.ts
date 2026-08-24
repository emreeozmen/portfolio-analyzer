import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import trCommon from './locales/tr/common.json'
import trHome from './locales/tr/home.json'
import trMarket from './locales/tr/market.json'
import trAssets from './locales/tr/assets.json'
import trPortfolio from './locales/tr/portfolio.json'
import trAlerts from './locales/tr/alerts.json'
import trCrypto from './locales/tr/crypto.json'
import trInflation from './locales/tr/inflation.json'
import trDividends from './locales/tr/dividends.json'
import trAuth from './locales/tr/auth.json'

import enCommon from './locales/en/common.json'
import enHome from './locales/en/home.json'
import enMarket from './locales/en/market.json'
import enAssets from './locales/en/assets.json'
import enPortfolio from './locales/en/portfolio.json'
import enAlerts from './locales/en/alerts.json'
import enCrypto from './locales/en/crypto.json'
import enInflation from './locales/en/inflation.json'
import enDividends from './locales/en/dividends.json'
import enAuth from './locales/en/auth.json'

export const STORAGE_KEY = 'pa_lang'
export const SUPPORTED_LANGUAGES = ['tr', 'en'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function readInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'tr') return stored
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded contexts — fall
    // through to the default below, same as ThemeContext's readInitialTheme.
  }
  return 'tr'
}

i18n.use(initReactI18next).init({
  resources: {
    tr: {
      common: trCommon,
      home: trHome,
      market: trMarket,
      assets: trAssets,
      portfolio: trPortfolio,
      alerts: trAlerts,
      crypto: trCrypto,
      inflation: trInflation,
      dividends: trDividends,
      auth: trAuth,
    },
    en: {
      common: enCommon,
      home: enHome,
      market: enMarket,
      assets: enAssets,
      portfolio: enPortfolio,
      alerts: enAlerts,
      crypto: enCrypto,
      inflation: enInflation,
      dividends: enDividends,
      auth: enAuth,
    },
  },
  lng: readInitialLanguage(),
  fallbackLng: 'tr',
  defaultNS: 'common',
  ns: ['common', 'home', 'market', 'assets', 'portfolio', 'alerts', 'crypto', 'inflation', 'dividends', 'auth'],
  interpolation: { escapeValue: false }, // React already escapes — double-escaping would mangle Turkish/English punctuation
  returnNull: false,
})

export default i18n
