import { describe, expect, it } from 'vitest'
import { formatMoney, formatPercentFraction, formatSignedPercent } from './currency'

describe('formatMoney', () => {
  it('formats TRY with the lira symbol and two decimals', () => {
    expect(formatMoney(1234.5, 'TRY')).toBe('₺1.234,50')
  })

  it('formats USD with the dollar symbol', () => {
    expect(formatMoney(99, 'USD')).toBe('$99,00')
  })

  it('falls back to "<amount> <code>" for an unmapped currency', () => {
    expect(formatMoney(10, 'ZZZ')).toBe('10,00 ZZZ')
  })
})

describe('formatSignedPercent', () => {
  it('prefixes a positive value with +', () => {
    expect(formatSignedPercent(2.5)).toBe('+2.50%')
  })

  it('leaves a negative value as-is', () => {
    expect(formatSignedPercent(-1.234)).toBe('-1.23%')
  })

  it('prefixes zero with +', () => {
    expect(formatSignedPercent(0)).toBe('+0.00%')
  })
})

describe('formatPercentFraction', () => {
  it('converts a fraction to a percent string', () => {
    expect(formatPercentFraction(0.153)).toBe('15.30%')
  })

  it('handles a negative fraction', () => {
    expect(formatPercentFraction(-0.05)).toBe('-5.00%')
  })
})
