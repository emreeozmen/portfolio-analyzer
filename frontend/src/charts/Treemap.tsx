import { DONUT_PALETTE } from './DonutChart'

export interface TreemapRow {
  label: string
  weight: number
}

export interface TreemapRect extends TreemapRow {
  x: number
  y: number
  width: number
  height: number
}

/** Simple, provably-correct "slice-and-dice" treemap layout (equivalent to D3's
 * treemapSliceDice): recursively splits the item list into two weight-balanced
 * groups and cuts the current rectangle's longer side between them. This is not a
 * fully "squarified" treemap (which additionally optimizes every cell's aspect
 * ratio) — it's far less code and impossible to get subtly wrong, and for a
 * portfolio breakdown of a handful of sectors/currencies that's a better trade than
 * chasing perfectly square cells. Always tiles the full rectangle exactly, with no
 * overlaps, for any non-empty input with a positive weight sum.
 */
export function layoutTreemap(items: TreemapRow[], x = 0, y = 0, width = 100, height = 100): TreemapRect[] {
  if (items.length === 0) return []
  if (items.length === 1) return [{ ...items[0], x, y, width, height }]

  const total = items.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return []

  // Find the split point where the running weight sum first reaches half the total —
  // balances the two groups' areas as evenly as the item boundaries allow.
  let cumulative = 0
  let splitIndex = 1
  for (let i = 0; i < items.length - 1; i++) {
    cumulative += items[i].weight
    if (cumulative >= total / 2) {
      splitIndex = i + 1
      break
    }
  }

  const groupA = items.slice(0, splitIndex)
  const groupB = items.slice(splitIndex)
  const fractionA = groupA.reduce((sum, item) => sum + item.weight, 0) / total

  if (width >= height) {
    const widthA = width * fractionA
    return [
      ...layoutTreemap(groupA, x, y, widthA, height),
      ...layoutTreemap(groupB, x + widthA, y, width - widthA, height),
    ]
  }
  const heightA = height * fractionA
  return [
    ...layoutTreemap(groupA, x, y, width, heightA),
    ...layoutTreemap(groupB, x, y + heightA, width, height - heightA),
  ]
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

interface TreemapProps {
  rows: TreemapRow[]
}

/** A proportional-area breakdown (sector/currency exposure, ...) — real semantic
 * <ul>/<li> positioned via CSS percentages, not a canvas. Each cell's label/percent
 * is normal DOM text, so unlike the Chart.js-based charts this needs no separate
 * role="img"/aria-label treatment: a screen reader just reads the list like any
 * other. Renders nothing for fewer than 2 rows, same guard ExposureBreakdown's
 * donut+legend predecessor used. */
function Treemap({ rows }: TreemapProps) {
  if (rows.length < 2) return null

  const sorted = [...rows].sort((a, b) => b.weight - a.weight)
  const colorIndexByLabel = new Map(sorted.map((r, i) => [r.label, i]))
  const rects = layoutTreemap(sorted)

  return (
    <ul className="treemap-wrapper">
      {rects.map((rect) => (
        <li
          key={rect.label}
          className="treemap-cell"
          style={{
            left: `${rect.x}%`,
            top: `${rect.y}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`,
            background: DONUT_PALETTE[(colorIndexByLabel.get(rect.label) ?? 0) % DONUT_PALETTE.length],
          }}
          title={`${rect.label}: ${formatPercent(rect.weight)}`}
        >
          {rect.weight >= 0.04 && (
            <>
              <span className="treemap-cell-label">{rect.label}</span>
              <span className="treemap-cell-weight mono">{formatPercent(rect.weight)}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export default Treemap
