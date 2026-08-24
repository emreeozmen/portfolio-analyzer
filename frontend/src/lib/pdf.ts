import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { PortfolioAnalysis } from '../api'

type JsPDFWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } }

const MARGIN_X = 40
const PAGE_WIDTH = 515 // A4 pt width minus 2*MARGIN_X
const PRIMARY_RGB: [number, number, number] = [201, 161, 95] // --primary gold, matches the app's palette

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export interface PortfolioPdfChartImages {
  /** Chart.js's own chart.toBase64Image() output for the portfolio-index line chart. */
  indexChart?: string
  /** Same, for the asset-allocation donut chart. */
  allocationChart?: string
}

/** Builds and downloads a real, branded PDF report — not window.print()'s browser
 * print dialog (that stays available separately as "Yazdır"). Chart images come from
 * the already-rendered Chart.js canvases via chart.toBase64Image() (see LineChart.tsx/
 * DonutChart.tsx's forwardRef), so this needs no second charting pass and no
 * html2canvas dependency.
 */
export function generatePortfolioPdf(analysis: PortfolioAnalysis, images: PortfolioPdfChartImages = {}): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 50

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text(analysis.name, MARGIN_X, y)
  doc.setFont('helvetica', 'normal')
  y += 18
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text(`Rapor tarihi: ${new Date().toLocaleDateString('tr-TR')}`, MARGIN_X, y)
  doc.setTextColor(0)
  y += 24

  autoTable(doc, {
    startY: y,
    head: [['Metrik', 'Değer']],
    body: [
      ['Toplam Getiri', formatPercent(analysis.summary.total_return)],
      ['Ortalama Günlük Getiri', formatPercent(analysis.summary.average_return)],
      ['Volatilite (yıllık)', formatPercent(analysis.summary.volatility)],
      ['Maksimum Düşüş', formatPercent(analysis.summary.max_drawdown)],
      ['Sharpe Oranı', analysis.summary.sharpe_ratio.toFixed(2)],
    ],
    theme: 'grid',
    headStyles: { fillColor: PRIMARY_RGB },
    margin: { left: MARGIN_X, right: MARGIN_X },
  })
  y = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 24

  if (images.indexChart) {
    const imgHeight = PAGE_WIDTH * 0.4
    if (y + imgHeight > 780) {
      doc.addPage()
      y = 50
    }
    doc.setFontSize(12)
    doc.text('Portföy Endeksi (baz=100)', MARGIN_X, y)
    y += 10
    doc.addImage(images.indexChart, 'PNG', MARGIN_X, y, PAGE_WIDTH, imgHeight)
    y += imgHeight + 24
  }

  if (y > 700) {
    doc.addPage()
    y = 50
  }
  doc.setFontSize(12)
  doc.text('Varlık Ağırlıkları', MARGIN_X, y)
  y += 10
  autoTable(doc, {
    startY: y,
    head: [['Varlık', 'Ağırlık (%)']],
    body: analysis.weights.map((w) => [w.ticker, (w.weight * 100).toFixed(2)]),
    theme: 'striped',
    headStyles: { fillColor: PRIMARY_RGB },
    margin: { left: MARGIN_X, right: MARGIN_X },
  })
  y = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 24

  if (images.allocationChart) {
    const imgSize = 180
    if (y + imgSize > 780) {
      doc.addPage()
      y = 50
    }
    doc.setFontSize(12)
    doc.text('Varlık Dağılımı', MARGIN_X, y)
    y += 10
    doc.addImage(images.allocationChart, 'PNG', MARGIN_X, y, imgSize, imgSize)
    y += imgSize + 24
  }

  if (analysis.correlation.tickers.length >= 2) {
    if (y > 700) {
      doc.addPage()
      y = 50
    }
    doc.setFontSize(12)
    doc.text('Korelasyon Matrisi', MARGIN_X, y)
    y += 10
    autoTable(doc, {
      startY: y,
      head: [['', ...analysis.correlation.tickers]],
      body: analysis.correlation.matrix.map((row, i) => [
        analysis.correlation.tickers[i],
        ...row.map((v) => v.toFixed(2)),
      ]),
      theme: 'grid',
      headStyles: { fillColor: PRIMARY_RGB },
      margin: { left: MARGIN_X, right: MARGIN_X },
    })
  }

  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text('Bu rapor bilgilendirme amaçlıdır, yatırım tavsiyesi niteliği taşımaz.', MARGIN_X, 820)

  doc.save(`${analysis.name.replace(/\s+/g, '-')}-rapor.pdf`)
}
