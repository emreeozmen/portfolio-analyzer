import Treemap from '../charts/Treemap'

interface ExposureBreakdownProps {
  title: string
  rows: { label: string; weight: number }[]
}

/** A labeled treemap for a weight breakdown (sector, currency, ...) — shared between
 * the per-portfolio exposure section (PortfolioBuilder.tsx, weighted by target
 * weights) and the homepage's real-money sector chart (Home.tsx, weighted by actual
 * current holdings value). Renders nothing for fewer than 2 distinct rows — a
 * single-value breakdown has nothing to visually break down. */
function ExposureBreakdown({ title, rows }: ExposureBreakdownProps) {
  if (rows.length < 2) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 14 }}>{title}</h3>
      <Treemap rows={rows} />
    </div>
  )
}

export default ExposureBreakdown
