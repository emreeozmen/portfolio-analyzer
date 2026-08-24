/** Pure, dependency-free technical/performance calculations over a close-price series.
 * All numbers here are derived directly from the app's own OHLCV data — nothing fabricated.
 */

export interface PricePoint {
  date: string
  close: number
}

export function sma(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += values[j]
    return sum / period
  })
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (values.length <= period) return result

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return result

  const k = 2 / (period + 1)
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  let prev = seed / period
  result[period - 1] = prev

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    result[i] = prev
  }
  return result
}

export interface MacdResult {
  macd: number | null
  signal: number | null
  histogram: number | null
}

/** Standard MACD(12,26,9) computed from a close-price series. */
export function macd(values: number[]): MacdResult {
  const ema12 = ema(values, 12)
  const ema26 = ema(values, 26)
  const macdLine: number[] = []
  for (let i = 0; i < values.length; i++) {
    const a = ema12[i]
    const b = ema26[i]
    if (a !== null && b !== null) macdLine.push(a - b)
  }
  if (macdLine.length === 0) return { macd: null, signal: null, histogram: null }

  const signalSeries = ema(macdLine, 9)
  const macdValue = macdLine[macdLine.length - 1]
  const signalValue = lastValue(signalSeries)
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: signalValue !== null ? macdValue - signalValue : null,
  }
}

export function lastValue(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]
  }
  return null
}

export type PerformanceWindow = { label: string; days?: number; months?: number; ytd?: boolean; all?: boolean }

export const PERFORMANCE_WINDOWS: PerformanceWindow[] = [
  { label: '1G', days: 1 },
  { label: '1H', days: 7 },
  { label: '1A', months: 1 },
  { label: '3A', months: 3 },
  { label: '6A', months: 6 },
  { label: 'YBB', ytd: true },
  { label: '1Y', months: 12 },
  { label: 'Tümü', all: true },
]

export function periodReturn(prices: PricePoint[], window: PerformanceWindow): number | null {
  if (prices.length === 0) return null
  const last = prices[prices.length - 1]
  const lastDate = new Date(last.date)

  if (window.all) {
    const first = prices[0]
    return first.close === 0 ? null : (last.close / first.close - 1) * 100
  }

  let cutoff: Date
  if (window.ytd) {
    cutoff = new Date(lastDate.getFullYear(), 0, 1)
  } else if (window.days !== undefined) {
    cutoff = new Date(lastDate)
    cutoff.setDate(cutoff.getDate() - window.days)
  } else {
    cutoff = new Date(lastDate)
    cutoff.setMonth(cutoff.getMonth() - (window.months ?? 0))
  }

  const base = prices.find((p) => new Date(p.date) >= cutoff)
  if (!base || base.close === 0) return null
  return (last.close / base.close - 1) * 100
}
