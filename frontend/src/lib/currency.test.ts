import { describe, expect, it } from 'vitest'
import { formatMoney } from './currency'

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
