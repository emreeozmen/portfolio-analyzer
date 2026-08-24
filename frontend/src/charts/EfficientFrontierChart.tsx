import { Chart as ChartJS, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js'
import { Chart } from 'react-chartjs-2'
import { useTranslation } from 'react-i18next'
import type { RiskReturnPoint } from '../api'
import { useTheme } from '../lib/ThemeContext'

ChartJS.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend)

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

interface EfficientFrontierChartProps {
  frontier: RiskReturnPoint[]
  currentPoint: RiskReturnPoint
  suggestedPoint: RiskReturnPoint
}

function EfficientFrontierChart({ frontier, currentPoint, suggestedPoint }: EfficientFrontierChartProps) {
  const { t } = useTranslation('portfolio')
  useTheme() // re-render (and re-read tokens below) on theme toggle — see LineChart.tsx
  const textMuted = readToken('--text-muted')
  const gridColor = readToken('--border')
  const surfaceColor = readToken('--surface-2')
  const borderColor = readToken('--border-strong')
  const textH = readToken('--text-h')
  const fontFamily = readToken('--mono') || 'monospace'
  const primary = readToken('--primary') || '#c9a15f'
  const success = readToken('--success') || '#2fbf76'
  const danger = readToken('--danger') || '#ec5f66'

  const data = {
    datasets: [
      {
        label: t('optimization.frontierChart.efficientFrontier'),
        data: frontier.map((p) => ({ x: p.volatility * 100, y: p.return * 100 })),
        borderColor: primary,
        backgroundColor: primary,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.2,
        fill: false,
        showLine: true,
      },
      {
        label: t('optimization.frontierChart.currentPortfolio'),
        data: [{ x: currentPoint.volatility * 100, y: currentPoint.return * 100 }],
        borderColor: danger,
        backgroundColor: danger,
        pointRadius: 7,
        pointHoverRadius: 8,
        showLine: false,
      },
      {
        label: t('optimization.frontierChart.suggestedPortfolio'),
        data: [{ x: suggestedPoint.volatility * 100, y: suggestedPoint.return * 100 }],
        borderColor: success,
        backgroundColor: success,
        pointRadius: 7,
        pointHoverRadius: 8,
        showLine: false,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'linear' as const,
        title: {
          display: true,
          text: t('optimization.frontierChart.volatilityAxis'),
          color: textMuted,
          font: { family: fontFamily, size: 11 },
        },
        ticks: { color: textMuted, font: { family: fontFamily, size: 11 } },
        grid: { color: gridColor },
        border: { color: gridColor },
      },
      y: {
        title: {
          display: true,
          text: t('optimization.frontierChart.returnAxis'),
          color: textMuted,
          font: { family: fontFamily, size: 11 },
        },
        ticks: { color: textMuted, font: { family: fontFamily, size: 11 } },
        grid: { color: gridColor },
        border: { color: gridColor },
      },
    },
    plugins: {
      legend: {
        labels: { color: textMuted, font: { size: 12 }, usePointStyle: true, pointStyle: 'circle' },
      },
      tooltip: {
        backgroundColor: surfaceColor,
        titleColor: textH,
        bodyColor: textH,
        borderColor,
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: fontFamily },
        titleFont: { family: fontFamily },
        callbacks: {
          title: () => '',
          label: (ctx: { dataset: { label?: string }; raw: unknown }) => {
            const point = ctx.raw as { x: number; y: number }
            return t('optimization.frontierChart.tooltipLabel', {
              label: ctx.dataset.label,
              return: point.y.toFixed(1),
              volatility: point.x.toFixed(1),
            })
          },
        },
      },
    },
  }

  return (
    <div className="chart-wrapper" role="img" aria-label={t('optimization.frontierChart.chartAriaLabel')}>
      <Chart type="line" data={data} options={options} />
    </div>
  )
}

export default EfficientFrontierChart
