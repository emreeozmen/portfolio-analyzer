import { useEffect, useState } from 'react'

/** Animates a number from 0 to `end` over `durationMs`, once, on mount —
 * for the hero stat tiles ("5+", "7", ...). Respects prefers-reduced-motion
 * by jumping straight to the final value instead of animating.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useCountUp(end: number, durationMs = 1200): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? end : 0))

  useEffect(() => {
    if (prefersReducedMotion()) return

    let rafId: number
    let start: number | null = null

    const step = (timestamp: number) => {
      if (start === null) start = timestamp
      const progress = Math.min((timestamp - start) / durationMs, 1)
      // Snap to the exact end value on the final frame — Math.floor(1 * end) would
      // otherwise permanently truncate any decimal part of `end` itself, not just
      // the in-between animated values.
      setValue(progress < 1 ? Math.floor(progress * end) : end)
      if (progress < 1) rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)

    return () => cancelAnimationFrame(rafId)
  }, [end, durationMs])

  return value
}
