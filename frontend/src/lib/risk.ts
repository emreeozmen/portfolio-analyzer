/** Pure risk-scenario helpers over already-fetched series — beta and simple shock
 * scenarios computed client-side from real portfolio/benchmark index values, nothing
 * fabricated or fetched separately.
 */

export function dailyReturns(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) out.push(values[i] / values[i - 1] - 1)
  }
  return out
}

/** Portfolio beta relative to a benchmark, from two equal-length, date-aligned index
 * series (e.g. portfolio_index vs. the BIST100 benchmark overlay). Returns null when
 * there isn't enough overlapping history to compute a meaningful estimate.
 */
export function beta(portfolioValues: number[], benchmarkValues: number[]): number | null {
  const n = Math.min(portfolioValues.length, benchmarkValues.length)
  if (n < 3) return null

  const portfolioReturns = dailyReturns(portfolioValues.slice(-n))
  const benchmarkReturns = dailyReturns(benchmarkValues.slice(-n))
  const len = Math.min(portfolioReturns.length, benchmarkReturns.length)
  if (len < 2) return null

  const meanP = portfolioReturns.slice(0, len).reduce((a, b) => a + b, 0) / len
  const meanB = benchmarkReturns.slice(0, len).reduce((a, b) => a + b, 0) / len

  let covariance = 0
  let benchmarkVariance = 0
  for (let i = 0; i < len; i++) {
    const dp = portfolioReturns[i] - meanP
    const db = benchmarkReturns[i] - meanB
    covariance += dp * db
    benchmarkVariance += db * db
  }
  if (benchmarkVariance === 0) return null
  return covariance / benchmarkVariance
}

export const STRESS_SHOCKS = [-0.1, -0.2, -0.3]
