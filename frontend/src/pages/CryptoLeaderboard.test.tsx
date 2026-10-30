import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CryptoLeaderboardPage from './CryptoLeaderboard'
import { getCryptoQuotes } from '../api'

let live: unknown = null
vi.mock('../api', () => ({ getCryptoQuotes: vi.fn() }))
vi.mock('../lib/useLiveChannel', () => ({ useLiveChannel: () => live }))
vi.mock('../lib/useFlashOnChange', () => ({ useFlashOnChange: () => '' }))
vi.mock('../components/TickerAvatar', () => ({ default: () => null }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const coin = { symbol: 'BTC', name: 'Bitcoin', last_price: 100, change_percent: 2, market_cap: 1000, currency: 'USD' }

beforeEach(() => {
  live = null
  vi.mocked(getCryptoQuotes).mockReset()
})

describe('crypto failure and recovery', () => {
  it('does not describe a failed request as a market with no gainers or losers', async () => {
    vi.mocked(getCryptoQuotes).mockRejectedValue(new TypeError('Failed to fetch'))
    render(<CryptoLeaderboardPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('loadError')
    expect(screen.queryByText('noGainersToday')).not.toBeInTheDocument()
    expect(screen.queryByText('noLosersToday')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'retry' })).toBeEnabled()
  })

  it('clears the error and populates the table after a manual retry', async () => {
    vi.mocked(getCryptoQuotes).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue([coin])
    render(<CryptoLeaderboardPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getAllByText('Bitcoin').length).toBeGreaterThan(0)
  })

  it('recovers from a failed initial request when a live quote arrives', async () => {
    vi.mocked(getCryptoQuotes).mockRejectedValue(new TypeError('offline'))
    const { rerender } = render(<CryptoLeaderboardPage />)
    await screen.findByRole('alert')
    live = [coin]
    await act(async () => rerender(<CryptoLeaderboardPage />))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getAllByText('Bitcoin').length).toBeGreaterThan(0)
  })
})
