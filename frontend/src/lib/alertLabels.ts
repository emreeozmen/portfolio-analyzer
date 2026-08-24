import type { AlertCondition, PriceAlert } from '../api'
import i18n from '../i18n'
import { currentLocale } from './locale'

const CONDITION_KEYS: Record<AlertCondition, string> = {
  price_above: 'condition.priceAbove',
  price_below: 'condition.priceBelow',
  rsi_above: 'condition.rsiAbove',
  rsi_below: 'condition.rsiBelow',
  macd_bull_cross: 'condition.macdBullCross',
  macd_bear_cross: 'condition.macdBearCross',
  volume_spike: 'condition.volumeSpike',
}

// MACD crossover conditions have no meaningful threshold (see alert_service.py's
// THRESHOLD_REQUIRED_CONDITIONS) — the label alone is the full description.
const THRESHOLDLESS_CONDITIONS: ReadonlySet<AlertCondition> = new Set(['macd_bull_cross', 'macd_bear_cross'])

export function alertConditionText(condition: AlertCondition, threshold: number): string {
  const label = i18n.t(CONDITION_KEYS[condition], { ns: 'alerts' })
  if (THRESHOLDLESS_CONDITIONS.has(condition)) return label
  if (condition === 'volume_spike') return `${label} ${threshold.toLocaleString(currentLocale())}×`
  const value = condition.startsWith('rsi') ? threshold.toFixed(0) : threshold.toLocaleString(currentLocale())
  return `${label} ${value}`
}

export function alertText(alert: PriceAlert): string {
  return `${alert.ticker}: ${alertConditionText(alert.condition, alert.threshold)}`
}

export function formatAlertDateTime(iso: string): string {
  return new Date(iso).toLocaleString(currentLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
