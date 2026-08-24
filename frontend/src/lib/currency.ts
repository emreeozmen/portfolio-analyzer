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
