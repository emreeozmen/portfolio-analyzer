import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import MarketOverviewPanel from './MarketOverviewPanel'

vi.mock('../api', () => ({
  getBist100History: vi.fn().mockResolvedValue([]),
  getTickerStrip: vi.fn().mockResolvedValue([]),
  getMajorIndices: vi.fn().mockResolvedValue([]),
  getCryptoGlobalStats: vi.fn().mockRejectedValue(new Error('CoinGecko unavailable')),
  getCryptoQuotes: vi.fn().mockResolvedValue([{ symbol: 'BTC', last_price: 100, change_percent: 2 }]),
  getFxQuotes: vi.fn().mockResolvedValue([]),
  getCommodities: vi.fn().mockResolvedValue([]),
  getInflationByCountry: vi.fn().mockResolvedValue([]),
}))
vi.mock('../lib/useLiveChannel', () => ({ useLiveChannel: () => null }))
vi.mock('./TickerAvatar', () => ({ default: () => null }))
vi.mock('../charts/LineChart', () => ({ default: () => null }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

it('keeps available coin prices visible when the independent global statistics provider fails', async () => {
  render(<MarketOverviewPanel />)
  expect(await screen.findByText('BTC')).toBeInTheDocument()
  expect(screen.getByText('crypto.title')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('connectionError')
})
