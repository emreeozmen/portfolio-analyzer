import { describe, expect, it } from 'vitest'
import { layoutTreemap, type TreemapRect, type TreemapRow } from './Treemap'

function totalArea(rects: TreemapRect[]): number {
  return rects.reduce((sum, r) => sum + r.width * r.height, 0)
}

function overlaps(a: TreemapRect, b: TreemapRect): boolean {
  const epsilon = 1e-6
  return a.x + a.width > b.x + epsilon && b.x + b.width > a.x + epsilon && a.y + a.height > b.y + epsilon && b.y + b.height > a.y + epsilon
}

describe('layoutTreemap', () => {
  it('returns an empty array for no items', () => {
    expect(layoutTreemap([])).toEqual([])
  })

  it('gives a single item the whole rectangle', () => {
    const rects = layoutTreemap([{ label: 'A', weight: 1 }])
    expect(rects).toEqual([{ label: 'A', weight: 1, x: 0, y: 0, width: 100, height: 100 }])
  })

  it('splits two equal items into two equal halves', () => {
    const rects = layoutTreemap([
      { label: 'A', weight: 0.5 },
      { label: 'B', weight: 0.5 },
    ])
    expect(rects).toHaveLength(2)
    expect(rects[0].width * rects[0].height).toBeCloseTo(rects[1].width * rects[1].height, 5)
  })

  it('covers the full container area exactly, with no gaps or overlaps, for varied inputs', () => {
    const inputs: TreemapRow[][] = [
      [
        { label: 'A', weight: 0.5 },
        { label: 'B', weight: 0.3 },
        { label: 'C', weight: 0.2 },
      ],
      [
        { label: 'A', weight: 0.4 },
        { label: 'B', weight: 0.25 },
        { label: 'C', weight: 0.2 },
        { label: 'D', weight: 0.1 },
        { label: 'E', weight: 0.05 },
      ],
      // A single dominant item plus several tiny ones — the pathological case where
      // the balanced-split loop can't find a midpoint before the last item.
      [
        { label: 'A', weight: 0.9 },
        { label: 'B', weight: 0.04 },
        { label: 'C', weight: 0.03 },
        { label: 'D', weight: 0.03 },
      ],
    ]

    for (const items of inputs) {
      const rects = layoutTreemap(items, 0, 0, 100, 100)
      expect(rects).toHaveLength(items.length)
      expect(totalArea(rects)).toBeCloseTo(100 * 100, 5)

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          expect(overlaps(rects[i], rects[j])).toBe(false)
        }
      }
    }
  })

  it('gives each rectangle an area proportional to its weight share', () => {
    const items: TreemapRow[] = [
      { label: 'A', weight: 0.6 },
      { label: 'B', weight: 0.4 },
    ]
    const rects = layoutTreemap(items, 0, 0, 200, 50)
    const total = 200 * 50
    const byLabel = Object.fromEntries(rects.map((r) => [r.label, r.width * r.height]))
    expect(byLabel.A / total).toBeCloseTo(0.6, 5)
    expect(byLabel.B / total).toBeCloseTo(0.4, 5)
  })

  it('returns an empty array when the weight sum is zero or negative', () => {
    expect(
      layoutTreemap([
        { label: 'A', weight: 0 },
        { label: 'B', weight: 0 },
      ]),
    ).toEqual([])
  })
})
