import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}

function StaleChunkBomb(): never {
  throw new Error('Failed to fetch dynamically imported module: https://example.com/assets/Foo-abc123.js')
}

afterEach(() => {
  sessionStorage.clear()
})

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

  it('auto-reloads once when the error is a stale-chunk dynamic-import failure', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    // @ts-expect-error -- replacing window.location for this test only
    delete window.location
    window.location = { ...originalLocation, reload: reloadSpy } as unknown as Location

    render(
      <ErrorBoundary>
        <StaleChunkBomb />
      </ErrorBoundary>,
    )

    expect(reloadSpy).toHaveBeenCalledTimes(1)

    window.location = originalLocation
    consoleErrorSpy.mockRestore()
  })

  it('does not reload again within the cooldown window', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    // @ts-expect-error -- replacing window.location for this test only
    delete window.location
    window.location = { ...originalLocation, reload: reloadSpy } as unknown as Location

    sessionStorage.setItem('pa_stale_chunk_reload_at', String(Date.now()))

    render(
      <ErrorBoundary>
        <StaleChunkBomb />
      </ErrorBoundary>,
    )

    expect(reloadSpy).not.toHaveBeenCalled()

    window.location = originalLocation
    consoleErrorSpy.mockRestore()
  })
})
