import i18n from '../i18n'

/** The `Intl`/`toLocaleString` locale tag matching the app's current TR/EN language
 * (see i18n/index.ts + lib/LanguageContext.tsx) — used anywhere a component formats a
 * date, time, or number directly with the browser's Intl APIs rather than through
 * react-i18next's `t()`, so numeric/date formatting (decimal comma vs. period, month
 * names, ...) switches along with the rest of the UI's language instead of staying
 * hardcoded to Turkish conventions. */
export function currentLocale(): string {
  return i18n.language === 'en' ? 'en-US' : 'tr-TR'
}
