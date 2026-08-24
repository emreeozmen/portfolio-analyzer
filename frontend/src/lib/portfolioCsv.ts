/** Client-side parser for a "ticker,weight" portfolio-weights CSV — no backend
 * round-trip needed since ticker validity can already be checked against the
 * `assets` list the portfolio form already has in hand (see PortfolioBuilder.tsx).
 * Handles both lib/csv.ts's own always-quoted output and a typical unquoted
 * Excel/Sheets CSV export a user might paste in.
 */

const TICKER_ALIASES = new Set(['ticker', 'sembol', 'symbol', 'hisse'])
const WEIGHT_ALIASES = new Set(['weight', 'agirlik', 'ağırlık', 'oran', 'percent'])

export interface PortfolioCsvRow {
  ticker: string
  weight: string
}

export interface PortfolioCsvRowError {
  row: number
  message: string
}

export interface PortfolioCsvParseResult {
  rows: PortfolioCsvRow[]
  errors: PortfolioCsvRowError[]
}

function parseCsvLines(csvText: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const text = csvText.replace(/\r\n/g, '\n').replace(/﻿/g, '')

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function findColumn(header: string[], aliases: Set<string>): number {
  return header.findIndex((h) => aliases.has(h.trim().toLowerCase()))
}

export function parsePortfolioWeightsCsv(csvText: string, knownTickers: string[]): PortfolioCsvParseResult {
  const lines = parseCsvLines(csvText)
  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'CSV dosyası boş veya okunamadı' }] }
  }

  const header = lines[0]
  const tickerCol = findColumn(header, TICKER_ALIASES)
  const weightCol = findColumn(header, WEIGHT_ALIASES)
  if (tickerCol === -1 || weightCol === -1) {
    return { rows: [], errors: [{ row: 1, message: "CSV'de 'ticker' ve 'weight' sütunları bulunamadı" }] }
  }

  const known = new Set(knownTickers.map((t) => t.toUpperCase()))
  const rows: PortfolioCsvRow[] = []
  const errors: PortfolioCsvRowError[] = []

  lines.slice(1).forEach((cells, idx) => {
    const rowNumber = idx + 2 // row 1 is the header
    const ticker = (cells[tickerCol] ?? '').trim().toUpperCase()
    const weightRaw = (cells[weightCol] ?? '').trim()

    if (!ticker) {
      errors.push({ row: rowNumber, message: 'Sembol boş olamaz' })
      return
    }
    if (!known.has(ticker)) {
      errors.push({ row: rowNumber, message: `Bilinmeyen veya izlenmeyen sembol: ${ticker}` })
      return
    }
    const weight = Number(weightRaw.replace(',', '.'))
    if (!Number.isFinite(weight) || weight <= 0) {
      errors.push({ row: rowNumber, message: `Geçersiz ağırlık: '${weightRaw}'` })
      return
    }
    rows.push({ ticker, weight: String(weight) })
  })

  return { rows, errors }
}
