import { describe, expect, it } from 'vitest'
import { parsePortfolioWeightsCsv } from './portfolioCsv'

const KNOWN_TICKERS = ['THYAO', 'ASELS', 'GARAN']

describe('parsePortfolioWeightsCsv', () => {
  it('parses valid quoted rows (matches lib/csv.ts downloadCsv output)', () => {
    const csv = '"ticker","weight"\n"THYAO","60"\n"ASELS","40"'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { ticker: 'THYAO', weight: '60' },
      { ticker: 'ASELS', weight: '40' },
    ])
  })

  it('parses plain unquoted rows', () => {
    const csv = 'ticker,weight\nTHYAO,60\nASELS,40'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.rows).toHaveLength(2)
  })

  it('recognizes Turkish header aliases', () => {
    const csv = 'sembol,agirlik\nTHYAO,100'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([{ ticker: 'THYAO', weight: '100' }])
  })

  it('reports a missing-column error and returns no rows', () => {
    const csv = 'foo,bar\n1,2'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.rows).toEqual([])
    expect(result.errors[0].message).toMatch(/ticker.*weight/)
  })

  it('flags an unknown ticker without dropping other valid rows', () => {
    const csv = 'ticker,weight\nTHYAO,60\nUNKNOWN,40'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.rows).toEqual([{ ticker: 'THYAO', weight: '60' }])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(3)
  })

  it('flags a non-numeric or non-positive weight', () => {
    const csv = 'ticker,weight\nTHYAO,abc\nASELS,-5'
    const result = parsePortfolioWeightsCsv(csv, KNOWN_TICKERS)
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(2)
  })

  it('returns an error for an empty CSV', () => {
    const result = parsePortfolioWeightsCsv('', KNOWN_TICKERS)
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
  })
})
