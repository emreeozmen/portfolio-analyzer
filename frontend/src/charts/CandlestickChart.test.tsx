import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import CandlestickChart, { type CandleDatum } from './CandlestickChart'
import { ThemeProvider } from '../lib/ThemeContext'

// jsdom doesn't implement ResizeObserver — CandlestickChart uses one to redraw on
// container resize. A minimal no-op stub is enough for rendering in tests.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // @ts-expect-error test-only stub, not a spec-complete ResizeObserver
    globalThis.ResizeObserver = ResizeObserverStub
  }
})

function sampleData(days: number): CandleDatum[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(2026, 0, 1 + i).toISOString().slice(0, 10)
    const base = 100 + Math.sin(i / 5) * 10
    return { date, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i }
  })
}

function renderWithTheme(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('CandlestickChart', () => {
  it('renders without crashing when no SMA overlay is requested', () => {
    expect(() =>
      renderWithTheme(<CandlestickChart ticker="THYAO" name="Türk Hava Yolları" currency="TRY" data={sampleData(60)} />),
    ).not.toThrow()
  })

  it('renders without crashing with SMA overlays enabled', () => {
    expect(() =>
      renderWithTheme(
        <CandlestickChart
          ticker="THYAO"
          name="Türk Hava Yolları"
          currency="TRY"
          data={sampleData(260)}
          smaOverlays={[20, 50, 200]}
        />,
      ),
    ).not.toThrow()
  })

  it('renders without crashing when there is no price data at all', () => {
    expect(() =>
      renderWithTheme(<CandlestickChart ticker="THYAO" name="Türk Hava Yolları" currency="TRY" data={[]} smaOverlays={[20]} />),
    ).not.toThrow()
  })
})
