import { forwardRef } from 'react'
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../lib/ThemeContext'

ChartJS.register(ArcElement, Tooltip, Legend)

const PALETTE = ['#c9a15f', '#5b9dee', '#2fbf76', '#ec5f66', '#a78bfa', '#22d3ee', '#f59e0b', '#f472b6']

export const DONUT_PALETTE = PALETTE

interface DonutChartProps {
  labels: string[]
  data: number[]
  /** Accessible name for the chart — see LineChart.tsx's identical prop. */
  ariaLabel?: string
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const DonutChart = forwardRef<ChartJS<'doughnut'> | undefined, DonutChartProps>(function DonutChart(
  { labels, data, ariaLabel },
  ref,
) {
  const { t } = useTranslation('common')
  useTheme() // re-render (and re-read tokens below) on theme toggle — see LineChart.tsx
  const surfaceColor = readToken('--surface')
  const textH = readToken('--text-h')
  const surfaceBorder = readToken('--surface-2')

  const chartData = {
    labels,
    datasets: [
      {
        data,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: surfaceBorder || surfaceColor,
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surfaceColor,
        titleColor: textH,
        bodyColor: textH,
        borderColor: surfaceBorder,
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (ctx: { label?: string; parsed: number }) => `${ctx.label}: %${ctx.parsed.toFixed(1)}`,
        },
      },
    },
  }

  return (
    <div className="donut-wrapper" role="img" aria-label={ariaLabel ?? t('chart')}>
      <Doughnut ref={ref} data={chartData} options={options} />
    </div>
  )
})

export default DonutChart
