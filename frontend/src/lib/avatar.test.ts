import { describe, expect, it } from 'vitest'
import { avatarColorFor, avatarInitials } from './avatar'

describe('avatarColorFor', () => {
  it('is deterministic for the same ticker', () => {
    expect(avatarColorFor('THYAO')).toBe(avatarColorFor('THYAO'))
  })

  it('returns a valid hex color', () => {
    expect(avatarColorFor('MSFT')).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('avatarInitials', () => {
  it('takes the first two characters, uppercased', () => {
    expect(avatarInitials('thyao')).toBe('TH')
  })

  it('handles single-character tickers', () => {
    expect(avatarInitials('f')).toBe('F')
  })
})
