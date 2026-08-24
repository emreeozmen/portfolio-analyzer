import '../i18n'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HoldingsPanel from './HoldingsPanel'
import type { AssetSummary, HoldingValuation, ValuationSummary } from '../api'

function renderPanel(props: Parameters<typeof HoldingsPanel>[0]) {
  return render(
    <MemoryRouter>
      <HoldingsPanel {...props} />
    </MemoryRouter>,
  )
}

vi.mock('../lib/LiveDataContext', () => ({
  useLiveData: () => ({ connected: true, subscribe: () => () => {} }),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    getHoldingsValuation: vi.fn(),
    getHoldingSales: vi.fn(),
    getRealizedPLSummary: vi.fn(),
    createHolding: vi.fn(),
    updateHolding: vi.fn(),
    deleteHolding: vi.fn(),
    sellHolding: vi.fn(),
    deleteSale: vi.fn(),
    importHoldingsCsv: vi.fn(),
  }
})

import {
  createHolding,
  deleteHolding,
  getHoldingSales,
  getHoldingsValuation,
  getRealizedPLSummary,
} from '../api'

const ASSETS: AssetSummary[] = [{ id: 1, ticker: 'THYAO', name: 'Türk Hava Yolları', currency: 'TRY' }]

const SAMPLE_HOLDING: HoldingValuation = {
  id: 1,
  ticker: 'THYAO',
  quantity: 10,
  purchase_price: 250,
  purchase_date: '2025-01-15T00:00:00',
  portfolio_id: 1,
  currency: 'TRY',
  sector: 'Industrials',
  current_price: 300,
  cost_basis: 2500,
  market_value: 3000,
  unrealized_pl: 500,
  unrealized_pl_percent: 20,
  market_value_try: 3000,
  cost_basis_try: 2500,
  dividend_income: 0,
  dividend_yield_ttm: 0,
  dividend_income_try: 0,
}

const SAMPLE_SUMMARY: ValuationSummary = {
  total_cost_basis: 2500,
  total_market_value: 3000,
  total_unrealized_pl: 500,
  total_unrealized_pl_percent: 20,
  currency: 'TRY',
  mixed_currency: false,
  priced_count: 1,
  unpriced_count: 0,
  total_cost_basis_try: 2500,
  total_market_value_try: 3000,
  total_unrealized_pl_try: 500,
  total_unrealized_pl_percent_try: 20,
  fx_unavailable: false,
  total_dividend_income: 0,
  total_dividend_income_try: 0,
}

beforeEach(() => {
  vi.mocked(getHoldingSales).mockResolvedValue([])
  vi.mocked(getRealizedPLSummary).mockResolvedValue({
    total_realized_pl: 0,
    total_proceeds: 0,
    total_cost_basis: 0,
    sale_count: 0,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('HoldingsPanel', () => {
  it('shows the empty state once loaded with no positions', async () => {
    vi.mocked(getHoldingsValuation).mockResolvedValue({ holdings: [], summary: SAMPLE_SUMMARY, sector_allocation: [] })

    renderPanel({ portfolioId: 1, assets: ASSETS })

    expect(await screen.findByText('Bu portföy için henüz pozisyon eklenmedi.')).toBeInTheDocument()
  })

  it('renders a holding row and summary cards once data loads', async () => {
    vi.mocked(getHoldingsValuation).mockResolvedValue({
      holdings: [SAMPLE_HOLDING],
      summary: SAMPLE_SUMMARY,
      sector_allocation: [],
    })

    renderPanel({ portfolioId: 1, assets: ASSETS })

    expect(await screen.findByText('THYAO')).toBeInTheDocument()
    expect(screen.getByText('₺500,00 (+20.00%)')).toBeInTheDocument() // row's combined P&L cell
    expect(screen.getAllByText('₺3.000,00').length).toBeGreaterThan(0) // summary card + table cell
  })

  it('shows a validation error and does not call createHolding when required fields are missing', async () => {
    // The add-position inputs are all HTML `required`, so a real click can't reach
    // this path (the browser's own constraint validation blocks submission first) —
    // dispatch the submit event directly to exercise the component's own JS-level
    // guard clause in handleSubmit.
    vi.mocked(getHoldingsValuation).mockResolvedValue({ holdings: [], summary: SAMPLE_SUMMARY, sector_allocation: [] })

    renderPanel({ portfolioId: 1, assets: ASSETS })
    await screen.findByText('Bu portföy için henüz pozisyon eklenmedi.')

    const form = screen.getByRole('button', { name: '+ Pozisyon ekle' }).closest('form')
    fireEvent.submit(form!)

    expect(await screen.findByText('Tüm alanlar zorunludur')).toBeInTheDocument()
    expect(createHolding).not.toHaveBeenCalled()
  })

  it('submits a new holding with the entered values and reloads the list', async () => {
    vi.mocked(getHoldingsValuation).mockResolvedValue({ holdings: [], summary: SAMPLE_SUMMARY, sector_allocation: [] })
    vi.mocked(createHolding).mockResolvedValue({
      id: 2,
      ticker: 'THYAO',
      quantity: 10,
      purchase_price: 250,
      purchase_date: '2025-01-15T00:00:00.000Z',
      portfolio_id: 1,
    })
    const onHoldingsChanged = vi.fn()
    const user = userEvent.setup()

    renderPanel({ portfolioId: 1, assets: ASSETS, onHoldingsChanged })
    await screen.findByText('Bu portföy için henüz pozisyon eklenmedi.')

    await user.selectOptions(screen.getByLabelText('Varlık seç'), 'THYAO')
    await user.type(screen.getByPlaceholderText('Miktar'), '10')
    await user.type(screen.getByPlaceholderText('Alım fiyatı'), '250')
    await user.type(screen.getByLabelText('Alım tarihi'), '2025-01-15')
    await user.click(screen.getByRole('button', { name: '+ Pozisyon ekle' }))

    await waitFor(() => expect(createHolding).toHaveBeenCalledTimes(1))
    const [payload] = vi.mocked(createHolding).mock.calls[0]
    expect(payload).toMatchObject({ ticker: 'THYAO', quantity: 10, purchase_price: 250, portfolio_id: 1 })
    expect(getHoldingsValuation).toHaveBeenCalledTimes(2) // initial load + reload after submit
    expect(onHoldingsChanged).toHaveBeenCalledTimes(1)
  })

  it('deletes a holding and reloads the list', async () => {
    vi.mocked(getHoldingsValuation).mockResolvedValue({
      holdings: [SAMPLE_HOLDING],
      summary: SAMPLE_SUMMARY,
      sector_allocation: [],
    })
    vi.mocked(deleteHolding).mockResolvedValue(undefined)
    const user = userEvent.setup()

    renderPanel({ portfolioId: 1, assets: ASSETS })
    await screen.findByText('THYAO')

    await user.click(screen.getByRole('button', { name: 'Sil' }))

    await waitFor(() => expect(deleteHolding).toHaveBeenCalledWith(1))
    expect(getHoldingsValuation).toHaveBeenCalledTimes(2)
  })
})
