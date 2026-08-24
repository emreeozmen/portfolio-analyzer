import { describe, expect, it } from 'vitest'
import { beta, dailyReturns } from './risk'

describe('dailyReturns', () => {
  it('computes simple percentage returns between consecutive values', () => {
    const result = dailyReturns([100, 110, 99])
    expect(result[0]).toBeCloseTo(0.1)
    expect(result[1]).toBeCloseTo(-0.1)
  })

  it('skips a step where the prior value is zero (avoids divide-by-zero)', () => {
    expect(dailyReturns([0, 100])).toEqual([])
  })
})

describe('beta', () => {
  it('returns 1 when the portfolio moves exactly like the benchmark', () => {
    const benchmark = [100, 102, 101, 105, 103, 108]
    expect(beta(benchmark, benchmark)).toBeCloseTo(1, 5)
  })

  it('returns roughly 2 when the portfolio moves twice as much as the benchmark', () => {
    const benchmark = [100, 102, 101, 105, 103, 108]
    // build a portfolio whose returns are exactly double the benchmark's
    const benchmarkReturns = dailyReturns(benchmark)
    const portfolio = [100]
    for (const r of benchmarkReturns) portfolio.push(portfolio[portfolio.length - 1] * (1 + r * 2))

    expect(beta(portfolio, benchmark)).toBeCloseTo(2, 5)
  })

  it('returns null when there is not enough overlapping history', () => {
    expect(beta([100, 101], [100, 101])).toBeNull()
  })

  it('returns null when the benchmark has zero variance', () => {
    expect(beta([100, 105, 98], [100, 100, 100])).toBeNull()
  })
})
