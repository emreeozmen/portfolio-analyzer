import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ExposureBreakdown from './ExposureBreakdown'
import { ThemeProvider } from '../lib/ThemeContext'

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe('ExposureBreakdown', () => {
  it('renders nothing for fewer than 2 rows', () => {
    const { container } = renderWithTheme(<ExposureBreakdown title="Sektör" rows={[{ label: 'Teknoloji', weight: 1 }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty row list', () => {
    const { container } = renderWithTheme(<ExposureBreakdown title="Sektör" rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the title and a legend row per entry for 2+ rows', () => {
    renderWithTheme(
      <ExposureBreakdown
        title="Sektör Dağılımı"
        rows={[
          { label: 'Teknoloji', weight: 0.6 },
          { label: 'Finans', weight: 0.4 },
        ]}
      />,
    )
    expect(screen.getByText('Sektör Dağılımı')).toBeInTheDocument()
    expect(screen.getByText('Teknoloji')).toBeInTheDocument()
    expect(screen.getByText('60.00%')).toBeInTheDocument()
    expect(screen.getByText('Finans')).toBeInTheDocument()
    expect(screen.getByText('40.00%')).toBeInTheDocument()
  })
})
