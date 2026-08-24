import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '../lib/currency'
import { currentLocale } from '../lib/locale'
import { useTheme } from '../lib/ThemeContext'
import { sma } from '../lib/indicators'

export interface CandleDatum {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface CandlestickChartProps {
  data: CandleDatum[]
  ticker: string
  name: string
  currency: string
  /** SMA periods to overlay on the price area (e.g. [20, 50]) — reuses the same
   * lib/indicators.ts sma() the Teknikler tab already computes from, drawn with the
   * chart's own xForIndex/yForPrice scale closures rather than a second chart. */
  smaOverlays?: number[]
}

// Distinct from the up/down candle colors and from --primary (used for the hover
// crosshair) so an overlay line never gets visually confused with either.
const SMA_COLORS = ['#5b9dee', '#a78bfa', '#f59e0b']

type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'ALL'
const RANGES: RangeKey[] = ['1M', '3M', '6M', '1Y', 'ALL']
const RANGE_MONTHS: Record<RangeKey, number | null> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, ALL: null }

function formatVolume(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(Math.round(v))
}

function formatAxisDate(d: Date): string {
  return d.toLocaleDateString(currentLocale(), { day: '2-digit', month: 'short' })
}

function formatTooltipDate(d: Date): string {
  return d.toLocaleDateString(currentLocale(), { day: '2-digit', month: 'long', year: 'numeric' })
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function clipToRange(data: CandleDatum[], range: RangeKey): CandleDatum[] {
  const months = RANGE_MONTHS[range]
  if (months === null || data.length === 0) return data
  const lastDate = new Date(data[data.length - 1].date)
  const cutoff = new Date(lastDate)
  cutoff.setMonth(cutoff.getMonth() - months)
  return data.filter((d) => new Date(d.date) >= cutoff)
}

interface ChartScales {
  chartLeft: number
  chartRight: number
  n: number
  colWidth: number
  priceAreaTop: number
  priceAreaBottom: number
  volumeAreaBottom: number
  xForIndex: (i: number) => number
}

const LAYOUT = { paddingTop: 16, paddingRight: 62, paddingBottom: 24, paddingLeft: 8, gap: 8, volumeRatio: 0.2 }

function CandlestickChart({ data, ticker, name, currency, smaOverlays = [] }: CandlestickChartProps) {
  const { t } = useTranslation('assets')
  const { theme } = useTheme()
  const [range, setRange] = useState<RangeKey>('6M')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverMouseY, setHoverMouseY] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scalesRef = useRef<ChartScales | null>(null)

  const candles = useMemo(() => clipToRange(data, range), [data, range])

  // Computed from the FULL (unclipped) price history, not just the visible range —
  // an SMA needs `period` days of history *before* the first visible candle to be
  // accurate there (otherwise e.g. SMA50 would show nothing at all on a 1M view).
  // Keyed by date so it aligns with `candles` regardless of the current range clip.
  const smaSeriesByPeriod = useMemo(() => {
    const closes = data.map((d) => d.close)
    const map = new Map<number, Map<string, number>>()
    for (const period of smaOverlays) {
      const series = sma(closes, period)
      const byDate = new Map<string, number>()
      series.forEach((v, i) => {
        if (v !== null) byDate.set(data[i].date, v)
      })
      map.set(period, byDate)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, smaOverlays.join(',')])

  const last = candles[candles.length - 1]
  const prev = candles.length > 1 ? candles[candles.length - 2] : last
  const first = candles[0]
  const hasData = candles.length > 0 && !!last && !!first

  const periodChangeAbs = hasData ? last.close - first.open : 0
  const periodChangePct = hasData ? (periodChangeAbs / first.open) * 100 : 0
  const barChangeAbs = hasData ? last.close - prev.close : 0
  const isUp = periodChangeAbs >= 0

  function draw() {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = container.clientWidth
    const h = container.clientHeight
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    if (candles.length === 0) {
      ctx.fillStyle = readToken('--text-muted')
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Veri yok', w / 2, h / 2)
      scalesRef.current = null
      return
    }

    const usableH = h - LAYOUT.paddingTop - LAYOUT.paddingBottom - LAYOUT.gap
    const priceAreaH = usableH * (1 - LAYOUT.volumeRatio)
    const volumeAreaH = usableH * LAYOUT.volumeRatio
    const priceAreaTop = LAYOUT.paddingTop
    const priceAreaBottom = priceAreaTop + priceAreaH
    const volumeAreaTop = priceAreaBottom + LAYOUT.gap
    const volumeAreaBottom = volumeAreaTop + volumeAreaH

    const chartLeft = LAYOUT.paddingLeft
    const chartRight = w - LAYOUT.paddingRight
    const chartWidth = Math.max(1, chartRight - chartLeft)

    const n = candles.length
    const colWidth = chartWidth / n
    const bodyWidth = Math.max(1.5, Math.min(colWidth * 0.62, 14))

    let priceMax = -Infinity
    let priceMin = Infinity
    let volMax = 0
    for (const c of candles) {
      if (c.high > priceMax) priceMax = c.high
      if (c.low < priceMin) priceMin = c.low
      if (c.volume > volMax) volMax = c.volume
    }
    const pad = (priceMax - priceMin) * 0.1 || priceMax * 0.01 || 1
    priceMax += pad
    priceMin -= pad
    if (volMax <= 0) volMax = 1

    const xForIndex = (i: number) => chartLeft + colWidth * i + colWidth / 2
    const yForPrice = (p: number) => priceAreaBottom - ((p - priceMin) / (priceMax - priceMin)) * priceAreaH
    const yForVolume = (v: number) => volumeAreaBottom - (v / volMax) * volumeAreaH

    const upColor = readToken('--success')
    const downColor = readToken('--danger')
    const borderColor = readToken('--border')
    const mutedColor = readToken('--text-muted')

    // gridlines + price labels
    const gridLines = 5
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = mutedColor
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let i = 0; i <= gridLines; i++) {
      const price = priceMin + ((priceMax - priceMin) * i) / gridLines
      const y = yForPrice(price)
      ctx.beginPath()
      ctx.moveTo(chartLeft, y)
      ctx.lineTo(chartRight, y)
      ctx.stroke()
      ctx.fillText(formatMoney(price, currency), chartRight + 8, y)
    }

    // dashed reference line at period-open price
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = mutedColor
    ctx.beginPath()
    ctx.moveTo(chartLeft, yForPrice(candles[0].open))
    ctx.lineTo(chartRight, yForPrice(candles[0].open))
    ctx.stroke()
    ctx.restore()

    // x-axis date labels
    const maxLabels = Math.max(2, Math.floor(chartWidth / 78))
    const labelStep = Math.max(1, Math.ceil(n / maxLabels))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let i = 0; i < n; i += labelStep) {
      ctx.fillText(formatAxisDate(new Date(candles[i].date)), xForIndex(i), volumeAreaBottom + 6)
    }

    // candles + volume
    for (let i = 0; i < n; i++) {
      const c = candles[i]
      const x = xForIndex(i)
      const up = c.close >= c.open
      const color = up ? upColor : downColor

      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(x, yForPrice(c.high))
      ctx.lineTo(x, yForPrice(c.low))
      ctx.stroke()

      const yOpen = yForPrice(c.open)
      const yClose = yForPrice(c.close)
      const bodyTop = Math.min(yOpen, yClose)
      const bodyH = Math.max(1, Math.abs(yClose - yOpen))
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyH)

      ctx.globalAlpha = 0.42
      const vY = yForVolume(c.volume)
      ctx.fillRect(x - bodyWidth / 2, vY, bodyWidth, volumeAreaBottom - vY)
      ctx.globalAlpha = 1
    }

    // SMA overlay lines, drawn on top of the candles (standard chart convention),
    // using the same xForIndex/yForPrice scale as everything else in this price area.
    smaOverlays.forEach((period, colorIdx) => {
      const byDate = smaSeriesByPeriod.get(period)
      if (!byDate || byDate.size === 0) return
      ctx.strokeStyle = SMA_COLORS[colorIdx % SMA_COLORS.length]
      ctx.lineWidth = 1.5
      ctx.beginPath()
      let started = false
      for (let i = 0; i < n; i++) {
        const v = byDate.get(candles[i].date)
        if (v === undefined) {
          started = false
          continue
        }
        const x = xForIndex(i)
        const y = yForPrice(v)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    })

    scalesRef.current = { chartLeft, chartRight, n, colWidth, priceAreaTop, priceAreaBottom, volumeAreaBottom, xForIndex }

    if (hoverIndex !== null && candles[hoverIndex]) {
      const x = xForIndex(hoverIndex)
      ctx.save()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = readToken('--primary')
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, priceAreaTop)
      ctx.lineTo(x, volumeAreaBottom)
      ctx.stroke()
      if (hoverMouseY !== null && hoverMouseY >= priceAreaTop && hoverMouseY <= priceAreaBottom) {
        ctx.beginPath()
        ctx.moveTo(chartLeft, hoverMouseY)
        ctx.lineTo(chartRight, hoverMouseY)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  useEffect(() => {
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, hoverIndex, hoverMouseY, currency, theme, smaSeriesByPeriod])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles])

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const scales = scalesRef.current
    if (!scales || candles.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    let idx = Math.floor((mouseX - scales.chartLeft) / scales.colWidth)
    idx = Math.max(0, Math.min(scales.n - 1, idx))

    setHoverIndex(idx)
    setHoverMouseY(mouseY)
    setTooltipPos({ x: mouseX, y: mouseY })
  }

  function handleMouseLeave() {
    setHoverIndex(null)
    setHoverMouseY(null)
    setTooltipPos(null)
  }

  const hoverCandle = hoverIndex !== null ? candles[hoverIndex] : null

  return (
    <div className="candle-chart">
      <div className="candle-header">
        <div>
          <div className="candle-ticker-row">
            <span className="candle-ticker">{ticker}</span>
            <span className="candle-meta"> · {name}</span>
          </div>
          {hasData && (
            <div className="candle-price-row">
              <span className="candle-price">{formatMoney(last.close, currency)}</span>
              <span className={isUp ? 'candle-change is-up' : 'candle-change is-down'}>
                {isUp ? '▲' : '▼'} {isUp ? '+' : ''}
                {periodChangeAbs.toFixed(2)} ({isUp ? '+' : ''}
                {periodChangePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
        <nav className="candle-range-tabs">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={r === range ? 'candle-range-tab is-active' : 'candle-range-tab'}
              onClick={() => setRange(r)}
            >
              {r === 'ALL' ? t('candlestick.all') : r}
            </button>
          ))}
        </nav>
      </div>

      {hasData && (
        <div className="candle-stat-rail">
          <div className="candle-stat">
            <span className="candle-stat-label">Open</span>
            <span className="candle-stat-value">{formatMoney(last.open, currency)}</span>
          </div>
          <div className="candle-stat">
            <span className="candle-stat-label">High</span>
            <span className="candle-stat-value">{formatMoney(last.high, currency)}</span>
          </div>
          <div className="candle-stat">
            <span className="candle-stat-label">Low</span>
            <span className="candle-stat-value">{formatMoney(last.low, currency)}</span>
          </div>
          <div className="candle-stat">
            <span className="candle-stat-label">Close</span>
            <span className="candle-stat-value">{formatMoney(last.close, currency)}</span>
          </div>
          <div className="candle-stat">
            <span className="candle-stat-label">Chg</span>
            <span className={barChangeAbs >= 0 ? 'candle-stat-value is-up' : 'candle-stat-value is-down'}>
              {barChangeAbs >= 0 ? '+' : ''}
              {barChangeAbs.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {smaOverlays.length > 0 && (
        <div className="candle-stat-rail" style={{ gap: 16 }}>
          {smaOverlays.map((period, i) => (
            <span key={period} className="candle-stat" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: SMA_COLORS[i % SMA_COLORS.length],
                }}
              />
              <span className="candle-stat-label" style={{ margin: 0 }}>
                SMA{period}
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="candle-canvas-wrap" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          // A hand-drawn <canvas> chart has no accessible content of its own — role="img"
          // + aria-label is the correct WAI-ARIA pattern here, not a real <img> (there's
          // no image src, it's rendered via the 2D drawing API below).
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="img"
          aria-label={
            hasData
              ? t('candlestick.ariaWithData', {
                  ticker,
                  range,
                  price: formatMoney(last.close, currency),
                  change: periodChangePct.toFixed(2),
                })
              : t('candlestick.ariaNoData', { ticker })
          }
        />
        {hoverCandle && tooltipPos && (
          <div
            className="candle-tooltip"
            style={{
              left: Math.min(tooltipPos.x + 14, (containerRef.current?.clientWidth ?? 999) - 160),
              top: Math.min(tooltipPos.y + 14, (containerRef.current?.clientHeight ?? 999) - 130),
            }}
          >
            <div className="candle-tooltip-date">{formatTooltipDate(new Date(hoverCandle.date))}</div>
            <div className="candle-tooltip-row"><span>Open</span><span>{formatMoney(hoverCandle.open, currency)}</span></div>
            <div className="candle-tooltip-row"><span>High</span><span>{formatMoney(hoverCandle.high, currency)}</span></div>
            <div className="candle-tooltip-row"><span>Low</span><span>{formatMoney(hoverCandle.low, currency)}</span></div>
            <div className="candle-tooltip-row"><span>Close</span><span>{formatMoney(hoverCandle.close, currency)}</span></div>
            <div className="candle-tooltip-row"><span>Vol</span><span>{formatVolume(hoverCandle.volume)}</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

export default CandlestickChart
