import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import DemoPortfolioPage from './DemoPortfolio'
import { getDemoPortfolio, type DemoPortfolioAnalysis } from '../api'

vi.mock('../api', () => ({ DEMO_PRESET_IDS: ['bist-five', 'us-tech', 'concentrated'], getDemoPortfolio: vi.fn() }))
vi.mock('../charts/LineChart', () => ({ default: () => <div>history-chart</div> }))
vi.mock('../charts/DonutChart', () => ({ default: () => <div>allocation-chart</div> }))
vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const example: DemoPortfolioAnalysis = {
  portfolio_id: 0, name: 'bist-five', preset_id: 'bist-five', currency: 'TRY', educational: true,
  portfolio_index: [{ date: '2025-01-01', value: 100 }, { date: '2025-03-01', value: 120 }],
  weights: [{ ticker: 'THYAO', weight: 0.6 }, { ticker: 'ASELS', weight: 0.4 }],
  correlation: { tickers: [], matrix: [] }, benchmark_label: 'BIST 100', benchmark: [],
  sector_allocation: [], currency_allocation: [],
  summary: { total_return: .2, average_return: .01, volatility: .1, max_drawdown: -.15,
    sharpe_ratio: 1, sortino_ratio: 1, calmar_ratio: 1, skewness: 0, kurtosis: 0, historical_var_95: -.02, historical_cvar_95: -.03 },
}

function Destination() {
  return <p>{JSON.stringify(useLocation().state)}</p>
}

function mount() {
  render(<MemoryRouter initialEntries={['/demo']}><Routes>
    <Route path="/demo" element={<DemoPortfolioPage />} />
    <Route path="/portfolio" element={<Destination />} />
  </Routes></MemoryRouter>)
}

beforeEach(() => {
  vi.mocked(getDemoPortfolio).mockReset().mockResolvedValue(example)
})

it('lets a guest explore historical amounts and rejects invalid input', async () => {
  mount()
  const input = await screen.findByLabelText('demo.startAmount')
  expect(screen.getByText(/12[.,]000[.,]00/)).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '2000' } })
  expect(screen.getByText(/2[.,]400[.,]00/)).toBeInTheDocument()
  fireEvent.change(input, { target: { value: '0' } })
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByText('demo.invalidAmount')).toBeInTheDocument()
  expect(screen.getByText('demo.ending').parentElement).toHaveTextContent('—')
})

it('switches examples and only passes a preset to the editable form', async () => {
  mount()
  await screen.findByLabelText('demo.startAmount')
  fireEvent.click(screen.getByRole('button', { name: /demo.presets.us-tech.title/ }))
  await waitFor(() => expect(getDemoPortfolio).toHaveBeenCalledWith('us-tech'))
  fireEvent.click(await screen.findByRole('link', { name: 'demo.editExample' }))
  expect(screen.getByText('{"demoPreset":"us-tech"}')).toBeInTheDocument()
})

it('shows an actionable error instead of fabricated results when history is unavailable', async () => {
  vi.mocked(getDemoPortfolio).mockRejectedValue(new Error('unavailable'))
  mount()
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByLabelText('demo.startAmount')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'retryData' })).toBeEnabled()
})
