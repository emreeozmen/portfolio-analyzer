import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>çalışıyor</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('çalışıyor')).toBeInTheDocument()
  })

  it('renders a fallback message instead of crashing when a child throws', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Bir şeyler ters gitti')).toBeInTheDocument()
    expect(screen.getByText('Sayfayı Yenile')).toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})
