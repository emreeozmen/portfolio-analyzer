import { memo } from 'react'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
}

/** A tiny, dependency-free inline trend line for a table cell — not interactive
 * (no hover/tooltip), unlike the bigger card chart on the Piyasa Görünümü page.
 * Color follows whether the series ended above or below where it started. */
function Sparkline({ data, width = 72, height = 26 }: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const points = data.map((v, i) => `${i * stepX},${height - ((v - min) / range) * height}`).join(' ')
  const isUp = data[data.length - 1] >= data[0]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="sparkline"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={isUp ? 'var(--success)' : 'var(--danger)'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default memo(Sparkline)
