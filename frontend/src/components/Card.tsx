import { memo } from 'react'

interface CardProps {
  label: string
  value: string
}

// Pure and rendered dozens of times per page (every stat tile across every analysis
// panel) — memo keeps a full metric grid from re-rendering when only one sibling's
// value actually changed.
function Card({ label, value }: CardProps) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
    </div>
  )
}

export default memo(Card)
