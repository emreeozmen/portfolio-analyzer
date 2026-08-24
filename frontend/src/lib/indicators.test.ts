import { describe, expect, it } from 'vitest'
import { PERFORMANCE_WINDOWS, ema, lastValue, macd, periodReturn, rsi, sma } from './indicators'

describe('sma', () => {
  it('returns null before the window is filled', () => {
    const result = sma([1, 2, 3], 5)
    expect(result).toEqual([null, null, null])
  })

  it('averages the trailing window once enough data exists', () => {
    const result = sma([1, 2, 3, 4, 5], 3)
    expect(result).toEqual([null, null, 2, 3, 4])
  })
})

describe('rsi', () => {
  it('returns nulls when there is not enough history', () => {
    const result = rsi([1, 2, 3], 14)
    expect(result.every((v) => v === null)).toBe(true)
  })

  it('returns 100 for a strictly rising series (no losses)', () => {
    const rising = Array.from({ length: 20 }, (_, i) => 100 + i)
    const result = rsi(rising, 14)
    expect(lastValue(result)).toBe(100)
  })

  it('returns 0 for a strictly falling series (no gains)', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 200 - i)
    const result = rsi(falling, 14)
    expect(lastValue(result)).toBe(0)
  })
})

describe('ema', () => {
  it('returns null before the window is filled', () => {
    expect(ema([1, 2], 5)).toEqual([null, null])
  })

  it('seeds the first value with a simple average', () => {
    const result = ema([1, 2, 3], 3)
    expect(result[2]).toBeCloseTo(2)
  })
})

describe('macd', () => {
  it('returns nulls when there is not enough history for the slow EMA', () => {
    const result = macd([1, 2, 3, 4, 5])
    expect(result).toEqual({ macd: null, signal: null, histogram: null })
  })

  it('computes a positive macd for a steadily rising series', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5)
    const result = macd(rising)
    expect(result.macd).not.toBeNull()
    expect(result.macd as number).toBeGreaterThan(0)
  })
})

describe('periodReturn', () => {
  const prices = [
    { date: '2026-01-01', close: 100 },
    { date: '2026-01-08', close: 110 },
  ]

  it('computes the return across the full series for the "all" window', () => {
    const allWindow = PERFORMANCE_WINDOWS.find((w) => w.all)!
    expect(periodReturn(prices, allWindow)).toBeCloseTo(10)
  })

  it('returns null for an empty price series', () => {
    const allWindow = PERFORMANCE_WINDOWS.find((w) => w.all)!
    expect(periodReturn([], allWindow)).toBeNull()
  })

  it('returns null when the window base price is zero (avoids divide-by-zero)', () => {
    const allWindow = PERFORMANCE_WINDOWS.find((w) => w.all)!
    const zeroBase = [
      { date: '2026-01-01', close: 0 },
      { date: '2026-01-08', close: 10 },
    ]
    expect(periodReturn(zeroBase, allWindow)).toBeNull()
  })
})

describe('lastValue', () => {
  it('returns the last non-null entry', () => {
    expect(lastValue([1, null, 3, null])).toBe(3)
  })

  it('returns null when every entry is null', () => {
    expect(lastValue([null, null])).toBeNull()
  })
})
