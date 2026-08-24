import { useEffect, useRef, useState } from 'react'

/**
 * Returns 'flash-up' / 'flash-down' for a brief window after `value` changes
 * from its previous render, '' otherwise. Pairs with the .flash-up/.flash-down
 * keyframe classes in index.css. Used to give polled (non-tick-level) data
 * — watchlist prices, screener rows, market cards — a visible "this just
 * updated" cue instead of silently swapping numbers in place.
 */
export function useFlashOnChange(value: number, durationMs = 900): 'flash-up' | 'flash-down' | '' {
  const prevRef = useRef(value)
  const [flash, setFlash] = useState<'flash-up' | 'flash-down' | ''>('')

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value
    if (value === prev) return

    setFlash(value > prev ? 'flash-up' : 'flash-down')
    const timer = setTimeout(() => setFlash(''), durationMs)
    return () => clearTimeout(timer)
  }, [value, durationMs])

  return flash
}
