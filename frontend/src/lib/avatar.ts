/** Deterministic per-ticker visual identity (color + initials) — used instead of
 * real company logos, which are trademarked assets we don't have licensing to embed.
 */

const AVATAR_COLORS = ['#c9a15f', '#5b9dee', '#2fbf76', '#ec5f66', '#a78bfa', '#22d3ee', '#f0a35f', '#e879b9']

export function avatarColorFor(ticker: string): string {
  let hash = 0
  for (let i = 0; i < ticker.length; i++) hash = (hash * 31 + ticker.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function avatarInitials(ticker: string): string {
  return ticker.slice(0, 2).toUpperCase()
}
