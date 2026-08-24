import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import {
  createHolding,
  deleteHolding,
  deleteSale,
  getHoldingSales,
  getHoldingsValuation,
  getRealizedPLSummary,
  importHoldingsCsv,
  previewHoldingsImportCsv,
  sellHolding,
  updateHolding,
  type AssetSummary,
  type HoldingImportPreviewResult,
  type HoldingImportResult,
  type HoldingSale,
  type HoldingValuation,
  type RealizedPLSummary,
  type ValuationSummary,
} from '../api'
import { formatMoney } from '../lib/currency'
import { currentLocale } from '../lib/locale'
import { downloadCsv } from '../lib/csv'
import { useLiveSignal } from '../lib/useLiveChannel'

interface HoldingsPanelProps {
  portfolioId: number
  assets: AssetSummary[]
  onHoldingsChanged?: () => void
}

interface HoldingForm {
  ticker: string
  quantity: string
  purchasePrice: string
  purchaseDate: string
}

interface SellForm {
  quantity: string
  salePrice: string
  saleDate: string
}

const EMPTY_FORM: HoldingForm = { ticker: '', quantity: '', purchasePrice: '', purchaseDate: '' }
const EMPTY_SELL_FORM: SellForm = { quantity: '', salePrice: '', saleDate: '' }

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(currentLocale())
}

function HoldingsPanel({ portfolioId, assets, onHoldingsChanged }: HoldingsPanelProps) {
  const { t } = useTranslation('portfolio')
  const [holdings, setHoldings] = useState<HoldingValuation[]>([])
  const [summary, setSummary] = useState<ValuationSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<HoldingForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [sales, setSales] = useState<HoldingSale[]>([])
  const [realizedSummary, setRealizedSummary] = useState<RealizedPLSummary | null>(null)
  const [sellingTicker, setSellingTicker] = useState<string | null>(null)
  const [sellForm, setSellForm] = useState<SellForm>(EMPTY_SELL_FORM)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<HoldingImportResult | null>(null)
  const [csvPreview, setCsvPreview] = useState<HoldingImportPreviewResult | null>(null)
  const [pendingCsvText, setPendingCsvText] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoading(true)
    getHoldingsValuation(portfolioId)
      .then((res) => {
        setHoldings(res.holdings)
        setSummary(res.summary)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }

  const loadSales = () => {
    Promise.all([getHoldingSales(portfolioId), getRealizedPLSummary(portfolioId)])
      .then(([saleRows, summaryRow]) => {
        setSales(saleRows)
        setRealizedSummary(summaryRow)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(() => {
    load()
    loadSales()
    setForm(EMPTY_FORM)
    setEditingId(null)
    setSellingTicker(null)
    setSellForm(EMPTY_SELL_FORM)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId])

  // Re-values open positions the moment the backend actually refreshes prices (~5
  // min), rather than only when the user reloads the page or edits a holding.
  useLiveSignal('prices-updated', load)

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
  }

  const handleEdit = (h: HoldingValuation) => {
    setEditingId(h.id)
    setForm({
      ticker: h.ticker,
      quantity: String(h.quantity),
      purchasePrice: String(h.purchase_price),
      purchaseDate: h.purchase_date.slice(0, 10),
    })
  }

  const handleDelete = async (id: number) => {
    setError(null)
    try {
      await deleteHolding(id)
      load()
      onHoldingsChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startSell = (ticker: string) => {
    setSellingTicker(ticker)
    setSellForm(EMPTY_SELL_FORM)
  }

  const cancelSell = () => {
    setSellingTicker(null)
    setSellForm(EMPTY_SELL_FORM)
  }

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!sellingTicker || !sellForm.quantity || !sellForm.salePrice || !sellForm.saleDate) {
      setError(t('holdings.allFieldsRequired'))
      return
    }
    try {
      await sellHolding({
        ticker: sellingTicker,
        quantity: Number(sellForm.quantity),
        sale_price: Number(sellForm.salePrice),
        sale_date: new Date(sellForm.saleDate).toISOString(),
        portfolio_id: portfolioId,
      })
      cancelSell()
      load()
      loadSales()
      onHoldingsChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteSale = async (id: number) => {
    setError(null)
    try {
      await deleteSale(id)
      loadSales()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setImportResult(null)
    setCsvPreview(null)
    setImporting(true)

    const reader = new FileReader()
    reader.onload = async () => {
      const csvText = String(reader.result ?? '')
      try {
        const preview = await previewHoldingsImportCsv(csvText, portfolioId)
        setCsvPreview(preview)
        setPendingCsvText(csvText)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.onerror = () => {
      setError(t('holdings.fileReadError'))
      setImporting(false)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleCancelImport = () => {
    setCsvPreview(null)
    setPendingCsvText(null)
  }

  const handleConfirmImport = async () => {
    if (!pendingCsvText) return
    setError(null)
    setImporting(true)
    try {
      const result = await importHoldingsCsv(pendingCsvText, portfolioId)
      setImportResult(result)
      setCsvPreview(null)
      setPendingCsvText(null)
      load()
      onHoldingsChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  const handleDownloadTemplate = () => {
    downloadCsv('pozisyon-sablonu.csv', [
      ['ticker', 'quantity', 'purchase_price', 'purchase_date'],
      ['AKBNK', '10', '50.25', '2025-01-15'],
      ['THYAO', '5', '300', '2025-03-01'],
    ])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.ticker || !form.quantity || !form.purchasePrice || !form.purchaseDate) {
      setError(t('holdings.allFieldsRequired'))
      return
    }
    const input = {
      ticker: form.ticker,
      quantity: Number(form.quantity),
      purchase_price: Number(form.purchasePrice),
      purchase_date: new Date(form.purchaseDate).toISOString(),
      portfolio_id: portfolioId,
    }
    try {
      if (editingId !== null) {
        await updateHolding(editingId, input)
      } else {
        await createHolding(input)
      }
      resetForm()
      load()
      onHoldingsChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="panel">
      <h2>{t('holdings.title')}</h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        <Trans t={t} i18nKey="holdings.intro" components={{ link: <Link to="/temettuler" /> }} />
      </p>

      <div className="portfolio-row" style={{ marginBottom: 16 }}>
        <label
          className="btn-secondary"
          style={importing ? { cursor: 'default', opacity: 0.6, pointerEvents: 'none' } : { cursor: 'pointer' }}
        >
          {importing ? t('holdings.importing') : t('holdings.importCsv')}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportFile}
            disabled={importing}
            style={{ display: 'none' }}
          />
        </label>
        <button type="button" className="btn-ghost" onClick={handleDownloadTemplate}>
          {t('holdings.downloadTemplate')}
        </button>
      </div>
      {csvPreview && (
        <div style={{ marginBottom: 16 }}>
          {csvPreview.rows.length > 0 && (
            <div className="table-scroll" style={{ marginBottom: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('holdings.columnAsset')}</th>
                    <th>{t('holdings.columnQuantity')}</th>
                    <th>{t('holdings.columnPurchasePrice')}</th>
                    <th>{t('holdings.columnPurchaseDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.ticker}</td>
                      <td>{r.quantity}</td>
                      <td>{r.purchase_price}</td>
                      <td>{formatDate(r.purchase_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {csvPreview.errors.length > 0 && (
            <ul className="muted" style={{ margin: '0 0 10px', paddingLeft: 18 }}>
              {csvPreview.errors.map((e, i) => (
                <li key={i}>{t('holdings.rowError', { row: e.row, message: e.message })}</li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleConfirmImport}
              disabled={importing || csvPreview.rows.length === 0}
            >
              {importing ? t('holdings.importing') : t('holdings.confirmImport', { count: csvPreview.rows.length })}
            </button>
            <button type="button" className="btn-ghost" onClick={handleCancelImport} disabled={importing}>
              {t('holdings.cancelImport')}
            </button>
          </div>
        </div>
      )}

      {importResult && (
        <div className="muted" style={{ marginBottom: 16 }}>
          <p>
            {t('holdings.importedCount', { count: importResult.imported })}
            {importResult.errors.length > 0 && t('holdings.importErrorsCount', { count: importResult.errors.length })}
          </p>
          {importResult.errors.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {importResult.errors.map((e, i) => (
                <li key={i}>{t('holdings.rowError', { row: e.row, message: e.message })}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {summary && holdings.length > 0 && (
        <div className="card-grid">
          <div className="card">
            <div className="card-label">{t('holdings.totalCost')}</div>
            <div className="card-value">
              {summary.mixed_currency
                ? formatMoney(summary.total_cost_basis_try, 'TRY')
                : formatMoney(summary.total_cost_basis, summary.currency ?? 'TRY')}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t('holdings.currentValue')}</div>
            <div className="card-value">
              {summary.mixed_currency
                ? formatMoney(summary.total_market_value_try, 'TRY')
                : formatMoney(summary.total_market_value, summary.currency ?? 'TRY')}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t('holdings.pl')}</div>
            <div
              className={`card-value ${(summary.mixed_currency ? summary.total_unrealized_pl_try : summary.total_unrealized_pl) >= 0 ? 'text-up' : 'text-down'}`}
            >
              {summary.mixed_currency
                ? formatMoney(summary.total_unrealized_pl_try, 'TRY')
                : formatMoney(summary.total_unrealized_pl, summary.currency ?? 'TRY')}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t('holdings.returnPercent')}</div>
            <div
              className={`card-value ${(summary.mixed_currency ? summary.total_unrealized_pl_percent_try : summary.total_unrealized_pl_percent) >= 0 ? 'text-up' : 'text-down'}`}
            >
              {formatPercent(summary.mixed_currency ? summary.total_unrealized_pl_percent_try : summary.total_unrealized_pl_percent)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">{t('holdings.dividendIncome')}</div>
            <div className="card-value">
              {summary.mixed_currency
                ? formatMoney(summary.total_dividend_income_try, 'TRY')
                : formatMoney(summary.total_dividend_income, summary.currency ?? 'TRY')}
            </div>
          </div>
        </div>
      )}
      {summary?.mixed_currency && (
        <p className="muted" style={{ marginBottom: 16 }}>
          {t('holdings.mixedCurrencyNote')}
          {summary.fx_unavailable && t('holdings.fxUnavailableNote')}
        </p>
      )}

      {loading && <p className="muted">{t('holdings.loading')}</p>}

      {!loading && holdings.length > 0 && (
        <div className="table-scroll" style={{ marginBottom: 20 }}>
          <table>
            <thead>
              <tr>
                <th>{t('holdings.columnAsset')}</th>
                <th>{t('holdings.columnQuantity')}</th>
                <th>{t('holdings.columnPurchasePrice')}</th>
                <th>{t('holdings.columnPurchaseDate')}</th>
                <th>{t('holdings.columnCurrentPrice')}</th>
                <th>{t('holdings.columnCurrentValue')}</th>
                <th>{t('holdings.columnPl')}</th>
                <th>{t('holdings.columnDividend')}</th>
                <th scope="col" className="sr-only">
                  {t('holdings.columnActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <Fragment key={h.id}>
                  <tr>
                    <td className="mono">{h.ticker}</td>
                    <td>{h.quantity}</td>
                    <td>{formatMoney(h.purchase_price, h.currency)}</td>
                    <td>{formatDate(h.purchase_date)}</td>
                    <td>{h.current_price !== null ? formatMoney(h.current_price, h.currency) : '—'}</td>
                    <td>{h.market_value !== null ? formatMoney(h.market_value, h.currency) : '—'}</td>
                    <td className={h.unrealized_pl !== null && h.unrealized_pl >= 0 ? 'text-up' : 'text-down'}>
                      {h.unrealized_pl !== null
                        ? `${formatMoney(h.unrealized_pl, h.currency)} (${formatPercent(h.unrealized_pl_percent ?? 0)})`
                        : '—'}
                    </td>
                    <td>
                      {h.dividend_income !== null ? (
                        <>
                          {formatMoney(h.dividend_income, h.currency)}
                          {h.dividend_yield_ttm !== null && (
                            <span className="muted">
                              {t('holdings.dividendYieldSuffix', { yield: h.dividend_yield_ttm.toFixed(2) })}
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn-ghost" onClick={() => handleEdit(h)}>
                        {t('holdings.edit')}
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => startSell(h.ticker)}>
                        {t('holdings.sell')}
                      </button>
                      <button type="button" className="btn-ghost weight-warn" onClick={() => handleDelete(h.id)}>
                        {t('holdings.delete')}
                      </button>
                    </td>
                  </tr>
                  {sellingTicker === h.ticker && (
                    <tr>
                      <td colSpan={9}>
                        <form onSubmit={handleSell} className="portfolio-row" style={{ margin: '8px 0' }}>
                          <span className="mono">{t('holdings.sellPrompt', { ticker: h.ticker })}</span>
                          <input
                            type="number"
                            placeholder={t('holdings.quantityPlaceholder')}
                            aria-label={t('holdings.quantityAria')}
                            value={sellForm.quantity}
                            onChange={(e) => setSellForm((f) => ({ ...f, quantity: e.target.value }))}
                            min={0}
                            max={h.quantity}
                            step="any"
                            required
                          />
                          <input
                            type="number"
                            placeholder={t('holdings.salePricePlaceholder')}
                            aria-label={t('holdings.salePriceAria')}
                            value={sellForm.salePrice}
                            onChange={(e) => setSellForm((f) => ({ ...f, salePrice: e.target.value }))}
                            min={0}
                            step="any"
                            required
                          />
                          <input
                            type="date"
                            aria-label={t('holdings.saleDateAria')}
                            value={sellForm.saleDate}
                            onChange={(e) => setSellForm((f) => ({ ...f, saleDate: e.target.value }))}
                            required
                          />
                          <button type="submit" className="btn-primary">
                            {t('holdings.confirmSale')}
                          </button>
                          <button type="button" className="btn-ghost" onClick={cancelSell}>
                            {t('holdings.cancel')}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && holdings.length === 0 && (
        <p className="muted" style={{ marginBottom: 18 }}>
          {t('holdings.empty')}
        </p>
      )}

      <form onSubmit={handleSubmit} className="portfolio-form">
        <div className="portfolio-row">
          <select
            value={form.ticker}
            onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value }))}
            aria-label={t('holdings.selectAsset')}
            required
          >
            <option value="">{t('holdings.selectAsset')}</option>
            {assets.map((a) => (
              <option key={a.ticker} value={a.ticker}>
                {a.ticker}
              </option>
            ))}
          </select>
          <input
            type="number"
            placeholder={t('holdings.quantityPlaceholder')}
            aria-label={t('holdings.quantityPlaceholder')}
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            min={0}
            step="any"
            required
          />
          <input
            type="number"
            placeholder={t('holdings.purchasePricePlaceholder')}
            aria-label={t('holdings.purchasePricePlaceholder')}
            value={form.purchasePrice}
            onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))}
            min={0}
            step="any"
            required
          />
          <input
            type="date"
            aria-label={t('holdings.purchaseDateAria')}
            value={form.purchaseDate}
            onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))}
            required
          />
          <button type="submit" className="btn-primary">
            {editingId !== null ? t('holdings.save') : t('holdings.addPosition')}
          </button>
          {editingId !== null && (
            <button type="button" className="btn-ghost" onClick={resetForm}>
              {t('holdings.cancel')}
            </button>
          )}
        </div>
      </form>

      {sales.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>{t('holdings.realizedPlTitle')}</h3>
            <Link to="/vergi-raporu" className="mono" style={{ fontSize: 13 }}>
              {t('holdings.taxReportLink')} →
            </Link>
          </div>
          {realizedSummary && (
            <div className="card-grid" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="card-label">{t('holdings.totalRealizedPl')}</div>
                <div className={`card-value ${realizedSummary.total_realized_pl >= 0 ? 'text-up' : 'text-down'}`}>
                  {formatMoney(realizedSummary.total_realized_pl, summary?.currency ?? 'TRY')}
                </div>
              </div>
              <div className="card">
                <div className="card-label">{t('holdings.saleCount')}</div>
                <div className="card-value">{realizedSummary.sale_count}</div>
              </div>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('holdings.columnAsset')}</th>
                  <th>{t('holdings.columnQuantity')}</th>
                  <th>{t('holdings.columnSalePrice')}</th>
                  <th>{t('holdings.columnSaleDate')}</th>
                  <th>{t('holdings.columnCostBasis')}</th>
                  <th>{t('holdings.columnRealizedPl')}</th>
                  <th scope="col" className="sr-only">
                    {t('holdings.columnActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.ticker}</td>
                    <td>{s.quantity}</td>
                    <td>{formatMoney(s.sale_price, summary?.currency ?? 'TRY')}</td>
                    <td>{formatDate(s.sale_date)}</td>
                    <td>{formatMoney(s.cost_basis, summary?.currency ?? 'TRY')}</td>
                    <td className={s.realized_pl >= 0 ? 'text-up' : 'text-down'}>
                      {formatMoney(s.realized_pl, summary?.currency ?? 'TRY')}
                    </td>
                    <td>
                      <button type="button" className="btn-ghost weight-warn" onClick={() => handleDeleteSale(s.id)}>
                        {t('holdings.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default HoldingsPanel
