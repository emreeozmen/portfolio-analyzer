import { useEffect, useRef } from 'react'

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Canvas gradient stops need a color string the 2D context's own (more
// limited) parser accepts — color-mix()/CSS custom properties aren't
// reliably supported there, so convert the hex token to rgba() by hand
// instead of leaning on CSS color functions.
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(201, 161, 95, ${alpha})`
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** A slow, continuously-drifting stock-line wave behind the hero — decorative
 * only (aria-hidden), drawn in the app's own --primary token so it stays in
 * sync with the palette rather than a hardcoded color. Skips the animation
 * loop entirely under prefers-reduced-motion, drawing one static frame instead.
 */
function HeroWaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const lineColor = readToken('--primary') || '#c9a15f'
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = parent.clientWidth * dpr
      canvas.height = parent.clientHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    let rafId: number | null = null
    let offset = 0

    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      ctx.clearRect(0, 0, width, height)

      ctx.beginPath()
      ctx.lineWidth = 2
      ctx.strokeStyle = lineColor
      for (let x = 0; x <= width; x += 5) {
        const y = Math.sin((x + offset) * 0.01) * 30 + Math.cos((x + offset * 0.5) * 0.02) * 20 + height / 2
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.lineTo(width, height)
      ctx.lineTo(0, height)
      const gradient = ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, hexToRgba(lineColor, 0.22))
      gradient.addColorStop(1, hexToRgba(lineColor, 0))
      ctx.fillStyle = gradient
      ctx.fill()
    }

    const loop = () => {
      draw()
      offset += 1.2
      rafId = requestAnimationFrame(loop)
    }

    if (reduceMotion) {
      draw()
    } else {
      rafId = requestAnimationFrame(loop)
    }

    return () => {
      ro.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />
}

export default HeroWaveCanvas
