import { memo } from 'react'
import { avatarColorFor, avatarInitials } from '../lib/avatar'

interface TickerAvatarProps {
  ticker: string
  size?: number
}

// Pure and rendered many times per page (watchlists, screener/comparison tables, market
// cards) with the same ticker+size repeatedly across re-renders — memo skips re-running
// the hash-based color/initials derivation when neither prop actually changed.
function TickerAvatar({ ticker, size = 36 }: TickerAvatarProps) {
  const color = avatarColorFor(ticker)
  return (
    <div
      className="ticker-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.34),
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      {avatarInitials(ticker)}
    </div>
  )
}

export default memo(TickerAvatar)
