import { currentLocale } from './locale'

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

export function formatMoney(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  const number = value.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return symbol ? `${symbol}${number}` : `${number} ${currency}`
}

/** Formats an already-percent-scaled number (e.g. a daily change_percent of 2.5) as
 * "+2.50%"/"-2.50%" — the one shared implementation for what used to be a dozen
 * byte-identical copies of this same one-liner across watchlist/ticker/screener-style
 * components. */
export function formatSignedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

/** Formats a fraction (e.g. 0.153 for 15.3%) as "15.30%" — for metrics that come back
 * as a fraction of 1 (volatility, returns, weights) rather than already percent-scaled. */
export function formatPercentFraction(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}
