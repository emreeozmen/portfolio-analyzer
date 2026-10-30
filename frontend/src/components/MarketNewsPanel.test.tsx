import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import MarketNewsPanel from './MarketNewsPanel'
import { getMarketNews, type NewsItem } from '../api'

let live: NewsItem[] | null = null

vi.mock('../api', () => ({ getMarketNews: vi.fn() }))
vi.mock('../lib/useLiveChannel', () => ({ useLiveChannel: () => live }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

beforeEach(() => {
  live = null
  vi.mocked(getMarketNews).mockReset()
})

it('keeps the news section discoverable when an empty feed is returned and can reload', async () => {
  vi.mocked(getMarketNews).mockResolvedValueOnce([]).mockResolvedValueOnce([{
    id: '1', title: 'Real headline', url: 'https://www.bloomberght.com/example', summary: '',
    publisher: 'Bloomberg HT', published_at: null, thumbnail_url: null, related_symbol: '',
  }])
  render(<MarketNewsPanel />)
  expect(screen.getByRole('heading', { name: 'news.title' })).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'news.retry' }))
  expect(await screen.findByRole('link', { name: /Real headline/ })).toHaveAttribute('href', 'https://www.bloomberght.com/example')
})

it('keeps the heading visible when the news service fails', async () => {
  vi.mocked(getMarketNews).mockRejectedValue(new Error('offline'))
  render(<MarketNewsPanel />)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'news.title' })).toBeInTheDocument()
})

it('does not let an empty live update hide successfully fetched headlines', async () => {
  live = []
  vi.mocked(getMarketNews).mockResolvedValue([{
    id: '2', title: 'Available headline', url: 'https://www.haberturk.com/example', summary: '',
    publisher: 'Habertürk Ekonomi', published_at: null, thumbnail_url: null, related_symbol: '',
  }])
  render(<MarketNewsPanel />)
  expect(await screen.findByRole('link', { name: /Available headline/ })).toBeInTheDocument()
})
