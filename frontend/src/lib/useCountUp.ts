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
    let lastUpdate = 0
    // Throttled to ~20 updates/sec — a full 60fps re-render cadence is imperceptible
    // for a simple count-up and needlessly multiplies React re-renders when several of
    // these run in parallel (e.g. the homepage net-worth tiles mount 5 of these at once).
    const UPDATE_INTERVAL_MS = 50

    const step = (timestamp: number) => {
      if (start === null) start = timestamp
      const progress = Math.min((timestamp - start) / durationMs, 1)
      if (progress >= 1) {
        // Snap to the exact end value on the final frame — Math.floor(1 * end) would
        // otherwise permanently truncate any decimal part of `end` itself, not just
        // the in-between animated values.
        setValue(end)
        return
      }
      if (timestamp - lastUpdate >= UPDATE_INTERVAL_MS) {
        lastUpdate = timestamp
        setValue(Math.floor(progress * end))
      }
      rafId = requestAnimationFrame(step)
    }
    rafId = requestAnimationFrame(step)

    return () => cancelAnimationFrame(rafId)
  }, [end, durationMs])

  return value
}
