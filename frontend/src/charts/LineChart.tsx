import { forwardRef } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../lib/ThemeContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

const PALETTE = ['#c9a15f', '#5b9dee', '#2fbf76', '#ec5f66', '#a78bfa', '#22d3ee']

interface LineChartDataset {
  label: string
  data: (number | null)[]
  color?: string
  /** Dashed stroke — for a projected/simulated line rather than realized history. */
  dashed?: boolean
  /** Shades the area between this dataset and the dataset at the given index (a Chart.js
   * `fill` target), or down to the chart's origin when set to `'origin'` (a simple area
   * chart, e.g. a single index's intraday move). Omit for a plain line. */
  fillToDatasetIndex?: number | 'origin'
}

interface LineChartProps {
  labels: string[]
  datasets: LineChartDataset[]
  /** Accessible name for the chart, read by screen readers (the canvas itself has no
   * text alternative of its own). Falls back to a generic "Chart" label so every
   * existing call site stays accessible without needing to pass one. */
  ariaLabel?: string
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A Chart.js "progressive line" animation (per-point x/y delay, drawing the line in from
 * left to right) rather than the default all-at-once fade. The total sweep is capped at a
 * fixed duration regardless of point count — a naive fixed per-point delay would take
 * minutes to finish on a full year of daily data. */
function buildDrawInAnimation(pointCount: number): ChartOptions<'line'>['animation'] {
  if (prefersReducedMotion() || pointCount < 2) return false
  const totalDrawMs = 900
  const perPointDelay = totalDrawMs / pointCount

  // Chart.js's per-property (x/y) animation config with index-based `from`/`delay`
  // callbacks (the documented "progressive line" recipe) isn't fully modeled by its
  // own TS types, hence the cast.
  return {
    x: {
      type: 'number' as const,
      easing: 'linear' as const,
      duration: perPointDelay,
      from: NaN,
      delay: (ctx: { type?: string; index?: number }) =>
        ctx.type === 'data' && ctx.index !== undefined ? ctx.index * perPointDelay : 0,
    },
    y: {
      type: 'number' as const,
      easing: 'linear' as const,
      duration: perPointDelay,
      from: (ctx: {
        type?: string
        index?: number
        datasetIndex?: number
        chart: { scales: { y?: { getPixelForValue: (v: number) => number; min: number } }; getDatasetMeta: (i: number) => { data: { getProps: (props: string[], final: boolean) => { y: number } }[] } }
      }) => {
        if (ctx.type !== 'data' || ctx.index === undefined || ctx.datasetIndex === undefined) return undefined
        if (ctx.index === 0) {
          const yScale = ctx.chart.scales.y
          return yScale ? yScale.getPixelForValue(yScale.min) : undefined
        }
        const prevPoint = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1]
        return prevPoint ? prevPoint.getProps(['y'], true).y : undefined
      },
      delay: (ctx: { type?: string; index?: number }) =>
        ctx.type === 'data' && ctx.index !== undefined ? ctx.index * perPointDelay : 0,
    },
  } as unknown as ChartOptions<'line'>['animation']
}

const LineChart = forwardRef<ChartJS<'line'> | undefined, LineChartProps>(function LineChart(
  { labels, datasets, ariaLabel },
  ref,
) {
  const { t } = useTranslation('common')
  // Subscribing to theme here (even though the value itself is unused) is what makes
  // this component re-render — and thus re-read the tokens below via getComputedStyle
  // — when the user toggles light/dark; the <html data-theme> flip alone is a DOM
  // mutation outside React's render tracking and wouldn't otherwise trigger a repaint.
  useTheme()
  const textMuted = readToken('--text-muted')
  const gridColor = readToken('--border')
  const surfaceColor = readToken('--surface-2')
  const borderColor = readToken('--border-strong')
  const textH = readToken('--text-h')
  const fontFamily = readToken('--mono') || 'monospace'

  const data = {
    labels,
    datasets: datasets.map((ds, i) => ({
      label: ds.label,
      data: ds.data,
      borderColor: ds.color ?? PALETTE[i % PALETTE.length],
      backgroundColor: ds.fillToDatasetIndex !== undefined ? `${ds.color ?? PALETTE[i % PALETTE.length]}26` : 'transparent',
      pointRadius: 0,
      borderWidth: 2,
      borderDash: ds.dashed ? [6, 4] : undefined,
      tension: 0.15,
      fill: ds.fillToDatasetIndex !== undefined ? ds.fillToDatasetIndex : false,
    })),
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    animation: buildDrawInAnimation(labels.length),
    scales: {
      x: {
        ticks: { maxTicksLimit: 8, color: textMuted, font: { family: fontFamily, size: 11 } },
        grid: { color: gridColor },
        border: { color: gridColor },
      },
      y: {
        ticks: { color: textMuted, font: { family: fontFamily, size: 11 } },
        grid: { color: gridColor },
        border: { color: gridColor },
      },
    },
    plugins: {
      legend: {
        display: datasets.length > 1,
        labels: { color: textMuted, font: { size: 12 }, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: {
        backgroundColor: surfaceColor,
        titleColor: textH,
        bodyColor: textH,
        borderColor: borderColor,
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: fontFamily },
        titleFont: { family: fontFamily },
      },
    },
  }

  return (
    <div className="chart-wrapper" role="img" aria-label={ariaLabel ?? t('chart')}>
      <Line ref={ref} data={data} options={options} />
    </div>
  )
})

export default LineChart
