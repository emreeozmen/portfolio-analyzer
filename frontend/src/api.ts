import { getToken } from './auth'
import i18n from './i18n'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export interface Holding {
  id: number
  ticker: string
  quantity: number
  purchase_price: number
  purchase_date: string
  portfolio_id: number | null
}

export type HoldingInput = Omit<Holding, 'id'>

export interface HoldingValuation extends Holding {
  currency: string
  sector: string | null
  current_price: number | null
  cost_basis: number
  market_value: number | null
  unrealized_pl: number | null
  unrealized_pl_percent: number | null
  market_value_try: number | null
  cost_basis_try: number | null
  dividend_income: number | null
  dividend_yield_ttm: number | null
  dividend_income_try: number | null
}

export interface ValuationSummary {
  total_cost_basis: number
  total_market_value: number
  total_unrealized_pl: number
  total_unrealized_pl_percent: number
  currency: string | null
  mixed_currency: boolean
  priced_count: number
  unpriced_count: number
  total_cost_basis_try: number
  total_market_value_try: number
  total_unrealized_pl_try: number
  total_unrealized_pl_percent_try: number
  fx_unavailable: boolean
  total_dividend_income: number
  total_dividend_income_try: number
}

export interface SectorWeight {
  label: string
  weight: number
}

export interface ValuationResponse {
  holdings: HoldingValuation[]
  summary: ValuationSummary
  sector_allocation: SectorWeight[]
}

export interface DividendPayment {
  ticker: string
  pay_date: string
  amount_per_share: number
  quantity: number
  amount: number
  currency: string
  amount_try: number | null
}

export interface ValueHistoryPoint {
  date: string
  market_value: number
  cost_basis: number
}

export interface ValueHistoryResponse {
  points: ValueHistoryPoint[]
  currency: string
  fx_unavailable: boolean
  excluded_tickers: string[]
}

export interface HoldingSaleInput {
  ticker: string
  quantity: number
  sale_price: number
  sale_date: string
  portfolio_id: number | null
}

export interface HoldingSale extends HoldingSaleInput {
  id: number
  cost_basis: number
  realized_pl: number
}

export interface RealizedPLSummary {
  total_realized_pl: number
  total_proceeds: number
  total_cost_basis: number
  sale_count: number
}

export type AlertCondition =
  | 'price_above'
  | 'price_below'
  | 'rsi_above'
  | 'rsi_below'
  | 'macd_bull_cross'
  | 'macd_bear_cross'
  | 'volume_spike'

export interface PriceAlert {
  id: number
  ticker: string
  condition: AlertCondition
  threshold: number
  is_active: boolean
  is_triggered: boolean
  is_read: boolean
  created_at: string
  triggered_at: string | null
}

export interface AssetSummary {
  id: number
  ticker: string
  name: string
  exchange?: string | null
  currency: string
  sector?: string | null
  is_default?: boolean
}

export interface AssetQuote {
  ticker: string
  name: string
  last_price: number
  change_percent: number
  currency: string
  sparkline: number[]
}

export interface SymbolSearchResult {
  yahoo_symbol: string
  ticker: string
  name: string
  exchange: string
  already_tracked: boolean
}

export interface AssetPricePoint {
  date: string
  open_price: number
  high_price: number
  low_price: number
  close_price: number
  volume: number
  daily_return: number | null
}

export interface AssetAnalysis {
  ticker: string
  name: string
  exchange?: string | null
  currency: string
  sector?: string | null
  is_default?: boolean
  prices: AssetPricePoint[]
  summary: {
    average_return: number
    volatility: number
    max_drawdown: number
    sharpe_ratio: number
  }
}

export interface Portfolio {
  id: number
  name: string
}

export interface PortfolioAssetInput {
  ticker: string
  weight: number
}

export interface PortfolioDetail extends Portfolio {
  assets: PortfolioAssetInput[]
  benchmark_symbol: string | null
  benchmark_label: string | null
  share_token: string | null
}

export interface PortfolioIndexPoint {
  date: string
  value: number
}

export interface CorrelationMatrix {
  tickers: string[]
  matrix: number[][]
}

export interface AllocationRow {
  label: string
  weight: number
}

export interface PortfolioAnalysis {
  portfolio_id: number
  name: string
  portfolio_index: PortfolioIndexPoint[]
  weights: { ticker: string; weight: number }[]
  correlation: CorrelationMatrix
  benchmark_label: string
  benchmark: PortfolioIndexPoint[]
  sector_allocation: AllocationRow[]
  currency_allocation: AllocationRow[]
  summary: {
    total_return: number
    average_return: number
    volatility: number
    max_drawdown: number
    sharpe_ratio: number
    sortino_ratio: number
    calmar_ratio: number
    skewness: number
    kurtosis: number
    historical_var_95: number
    historical_cvar_95: number
  }
}

export interface WorstDrawdownPeriod {
  peak_date: string
  trough_date: string
  recovery_date: string | null
  drawdown_percent: number
}

export interface MonteCarloResult {
  days: number[]
  lower_bound: number[]
  p50: number[]
  upper_bound: number[]
  value_at_risk_percent: number
  conditional_value_at_risk_percent: number
  probability_of_loss: number
  expected_value: number
  best_case: number
  worst_case: number
  confidence_level: number
  horizon_days: number
}

export interface GoalProjectionResult {
  horizon_months: number
  target_value: number
  median_months_to_goal: number | null
  optimistic_months_to_goal: number | null
  pessimistic_months_to_goal: number | null
  probability_within_horizon: number
  months: number[]
  median_path: number[]
  lower_path: number[]
  upper_path: number[]
}

export interface RollingBacktestPoint {
  start_date: string
  return_percent: number
}

export interface RollingBacktestResult {
  window_days: number
  sample_count: number
  mean_return_percent: number
  median_return_percent: number
  best_return_percent: number
  worst_return_percent: number
  positive_rate: number
  points: RollingBacktestPoint[]
  worst_drawdown_period: WorstDrawdownPeriod | null
}

interface TokenResponse {
  access_token: string
  token_type: string
}

export interface LoginResult {
  access_token: string | null
  token_type: string
  requires_2fa: boolean
  challenge_token: string | null
}

async function parseErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    const detail = body.detail
    if (typeof detail === 'string') return detail
    // FastAPI/Pydantic validation errors come back as a list of { msg, loc, type } objects;
    // custom field_validator messages are prefixed with "Value error, " by Pydantic — strip it.
    if (Array.isArray(detail) && detail.length > 0) {
      const messages = detail
        .map((d: { msg?: string }) => d.msg?.replace(/^Value error,\s*/, ''))
        .filter(Boolean)
      return messages.join(', ') || fallback
    }
    return fallback
  } catch {
    return fallback
  }
}

/** Sent on every request alongside auth so the backend can localize a handful of
 * fixed error messages (see backend/i18n.py) — `Accept-Language` can't be used here
 * since it's a forbidden header name browsers won't let `fetch()` set. */
function authHeaders(): HeadersInit {
  const token = getToken()
  const headers: HeadersInit = { 'X-Lang': i18n.language }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

// Dedupes concurrent identical GET requests and reuses a response for a few seconds —
// without this, rapidly navigating between pages (e.g. Ana Sayfa <-> Piyasa Görünümü)
// remounts the market/asset-screener components repeatedly, and each mount independently
// re-fetches the full asset list plus every displayed ticker's analysis. On a slow/cold
// backend those requests pile up faster than they drain, so the *current* mount's request
// can sit queued indefinitely — the page never gets its ticker list back and is left
// showing no cards, no spinner, no error. Sharing one in-flight promise per key (and
// reusing its result briefly after) keeps repeated rapid navigation from multiplying load.
const GET_CACHE_TTL_MS = 15_000
const responseCache = new Map<string, { data: unknown; expiresAt: number }>()
const inFlightRequests = new Map<string, Promise<unknown>>()

function cachedGet<T>(key: string, fetcher: () => Promise<T>, ttlMs = GET_CACHE_TTL_MS): Promise<T> {
  const hit = responseCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T)

  const pending = inFlightRequests.get(key)
  if (pending) return pending as Promise<T>

  const request = fetcher()
    .then((data) => {
      responseCache.set(key, { data, expiresAt: Date.now() + ttlMs })
      return data
    })
    .finally(() => inFlightRequests.delete(key))
  inFlightRequests.set(key, request)
  return request
}

function invalidateCache(prefix: string): void {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key)
  }
}

/** Test-only escape hatch — the cache above is module-level and otherwise outlives
 * individual test cases (and their mocked fetch responses) within the same file. */
export function __clearApiCacheForTests(): void {
  responseCache.clear()
  inFlightRequests.clear()
}

export async function register(email: string, password: string): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lang': i18n.language },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, 'Registration failed'))
  return res.json()
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, 'Login failed'))
  return res.json()
}

export async function verifyTwoFactor(challengeToken: string, code: string): Promise<TokenResponse> {
  const res = await fetch(`${API_BASE}/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_token: challengeToken, code }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, 'Verification failed'))
  return res.json()
}

export type DigestFrequency = 'off' | 'weekly' | 'monthly'

export interface CurrentUser {
  id: number
  email: string
  email_alerts_enabled: boolean
  totp_enabled: boolean
  base_currency: string
  digest_frequency: DigestFrequency
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load user: ${res.status}`))
  return res.json()
}

export async function updateNotificationPreferences(
  emailAlertsEnabled: boolean,
  digestFrequency: DigestFrequency,
): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me/notifications`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email_alerts_enabled: emailAlertsEnabled, digest_frequency: digestFrequency }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to update notification preferences: ${res.status}`))
  return res.json()
}

export async function updateCurrency(baseCurrency: string): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me/currency`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_currency: baseCurrency }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to update currency: ${res.status}`))
  return res.json()
}

export interface TwoFactorSetup {
  secret: string
  qr_code_data_uri: string
}

export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  const res = await fetch(`${API_BASE}/auth/2fa/setup`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to start 2FA setup: ${res.status}`))
  return res.json()
}

export async function enableTwoFactor(code: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/2fa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to enable 2FA: ${res.status}`))
}

export async function disableTwoFactor(password: string, code: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ password, code }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to disable 2FA: ${res.status}`))
}

export interface UserSession {
  id: number
  user_agent: string | null
  ip_address: string | null
  created_at: string
  last_seen_at: string
  is_current: boolean
}

export async function getSessions(): Promise<UserSession[]> {
  const res = await fetch(`${API_BASE}/auth/sessions`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load sessions: ${res.status}`))
  return res.json()
}

export async function revokeSession(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/sessions/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to revoke session: ${res.status}`))
}

export async function revokeAllOtherSessions(): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/sessions/revoke-all-others`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to revoke other sessions: ${res.status}`))
}

export interface AuditLogEntry {
  id: number
  action: string
  detail: string | null
  created_at: string
}

export async function getActivity(): Promise<AuditLogEntry[]> {
  const res = await fetch(`${API_BASE}/auth/activity`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load activity: ${res.status}`))
  return res.json()
}

export interface AdminUser {
  id: number
  email: string
  created_at: string
  last_seen_at: string | null
}

// 403s for every account except the one configured as ADMIN_EMAIL on the backend —
// see routers/auth.py's _require_admin.
export async function getAdminUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${API_BASE}/auth/admin/users`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load users: ${res.status}`))
  return res.json()
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/me/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to change password: ${res.status}`))
}

export async function changeEmail(newEmail: string, currentPassword: string): Promise<CurrentUser> {
  const res = await fetch(`${API_BASE}/auth/me/email`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ new_email: newEmail, current_password: currentPassword }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to change email: ${res.status}`))
  return res.json()
}

export async function getHoldingsValuation(portfolioId?: number): Promise<ValuationResponse> {
  const qs = portfolioId !== undefined ? `?portfolio_id=${portfolioId}` : ''
  const res = await fetch(`${API_BASE}/holdings/valuation${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load valuation: ${res.status}`))
  return res.json()
}

export async function getHoldingsValueHistory(portfolioId?: number): Promise<ValueHistoryResponse> {
  const qs = portfolioId !== undefined ? `?portfolio_id=${portfolioId}` : ''
  const res = await fetch(`${API_BASE}/holdings/value-history${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load value history: ${res.status}`))
  return res.json()
}

export async function getDividendHistory(portfolioId?: number): Promise<DividendPayment[]> {
  const qs = portfolioId !== undefined ? `?portfolio_id=${portfolioId}` : ''
  const res = await fetch(`${API_BASE}/holdings/dividends${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load dividend history: ${res.status}`))
  return res.json()
}

export async function createHolding(input: HoldingInput): Promise<Holding> {
  const res = await fetch(`${API_BASE}/holdings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to create holding: ${res.status}`))
  return res.json()
}

export async function updateHolding(id: number, input: HoldingInput): Promise<Holding> {
  const res = await fetch(`${API_BASE}/holdings/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to update holding: ${res.status}`))
  return res.json()
}

export async function sellHolding(input: HoldingSaleInput): Promise<HoldingSale> {
  const res = await fetch(`${API_BASE}/holdings/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to sell holding: ${res.status}`))
  return res.json()
}

export async function getHoldingSales(portfolioId?: number): Promise<HoldingSale[]> {
  const qs = portfolioId !== undefined ? `?portfolio_id=${portfolioId}` : ''
  const res = await fetch(`${API_BASE}/holdings/sales${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load sales: ${res.status}`))
  return res.json()
}

export async function getRealizedPLSummary(portfolioId?: number): Promise<RealizedPLSummary> {
  const qs = portfolioId !== undefined ? `?portfolio_id=${portfolioId}` : ''
  const res = await fetch(`${API_BASE}/holdings/sales/summary${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load realized P&L: ${res.status}`))
  return res.json()
}

export async function deleteSale(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/holdings/sales/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to delete sale: ${res.status}`))
}

export interface HoldingImportRowError {
  row: number
  message: string
}

export interface HoldingImportResult {
  imported: number
  errors: HoldingImportRowError[]
}

export async function importHoldingsCsv(csvText: string, portfolioId: number | null): Promise<HoldingImportResult> {
  const res = await fetch(`${API_BASE}/holdings/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ csv_text: csvText, portfolio_id: portfolioId }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to import holdings: ${res.status}`))
  return res.json()
}

export interface HoldingImportPreviewRow {
  ticker: string
  quantity: number
  purchase_price: number
  purchase_date: string
}

export interface HoldingImportPreviewResult {
  rows: HoldingImportPreviewRow[]
  errors: HoldingImportRowError[]
}

export async function previewHoldingsImportCsv(
  csvText: string,
  portfolioId: number | null,
): Promise<HoldingImportPreviewResult> {
  const res = await fetch(`${API_BASE}/holdings/import/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ csv_text: csvText, portfolio_id: portfolioId }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to preview holdings import: ${res.status}`))
  return res.json()
}

export async function getAlerts(): Promise<PriceAlert[]> {
  const res = await fetch(`${API_BASE}/alerts`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load alerts: ${res.status}`))
  return res.json()
}

export async function createAlert(ticker: string, condition: AlertCondition, threshold: number): Promise<PriceAlert> {
  const res = await fetch(`${API_BASE}/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ticker, condition, threshold }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to create alert: ${res.status}`))
  return res.json()
}

export async function deleteAlert(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/alerts/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to delete alert: ${res.status}`))
}

export async function markAlertRead(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/alerts/${id}/read`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to mark alert read: ${res.status}`))
}

export async function markAllAlertsRead(): Promise<void> {
  const res = await fetch(`${API_BASE}/alerts/read-all`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to mark alerts read: ${res.status}`))
}

export interface PushSubscriptionKeys {
  p256dh: string
  auth: string
}

export async function subscribePush(endpoint: string, keys: PushSubscriptionKeys): Promise<void> {
  const res = await fetch(`${API_BASE}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ endpoint, keys }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to subscribe to push: ${res.status}`))
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const res = await fetch(`${API_BASE}/push/subscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ endpoint }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to unsubscribe from push: ${res.status}`))
}

export async function deleteHolding(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/holdings/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to delete holding: ${res.status}`))
}

export async function getAssets(): Promise<AssetSummary[]> {
  return cachedGet(`assets:${getToken() ?? 'anon'}`, async () => {
    const res = await fetch(`${API_BASE}/assets`, { headers: authHeaders() })
    if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load assets: ${res.status}`))
    return res.json()
  })
}

export async function getAssetQuotes(): Promise<AssetQuote[]> {
  return cachedGet(`assetQuotes:${getToken() ?? 'anon'}`, async () => {
    const res = await fetch(`${API_BASE}/assets/quotes`, { headers: authHeaders() })
    if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load quotes: ${res.status}`))
    return res.json()
  })
}

export async function searchAssets(query: string): Promise<SymbolSearchResult[]> {
  const res = await fetch(`${API_BASE}/assets/search?q=${encodeURIComponent(query)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Search failed: ${res.status}`))
  return res.json()
}

export async function trackAsset(result: SymbolSearchResult): Promise<AssetSummary> {
  const res = await fetch(`${API_BASE}/assets/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      yahoo_symbol: result.yahoo_symbol,
      ticker: result.ticker,
      name: result.name,
      exchange: result.exchange,
    }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to track asset: ${res.status}`))
  invalidateCache('assets:')
  return res.json()
}

export async function untrackAsset(ticker: string): Promise<void> {
  const res = await fetch(`${API_BASE}/assets/${ticker}/track`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to untrack asset: ${res.status}`))
  invalidateCache('assets:')
}

export async function rewatchAsset(ticker: string): Promise<AssetSummary> {
  const res = await fetch(`${API_BASE}/assets/${ticker}/watchlist`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to re-add asset: ${res.status}`))
  invalidateCache('assets:')
  return res.json()
}

export async function getAssetAnalysis(ticker: string): Promise<AssetAnalysis> {
  return cachedGet(`assetAnalysis:${ticker}`, async () => {
    // Bounded so a single slow/cold-starting backend response can't hang this request
    // forever — plain fetch() has no default timeout, and pages that request many
    // tickers at once (Piyasa Görünümü, Varlık Analizi) wait on the slowest one via
    // Promise.allSettled, so one stalled request would otherwise stall the whole
    // page's loading state indefinitely instead of surfacing an error to retry from.
    const res = await fetch(`${API_BASE}/assets/${ticker}/analysis`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load analysis: ${res.status}`))
    return res.json()
  })
}

export interface AssetFundamentals {
  trailing_pe: number | null
  forward_pe: number | null
  price_to_book: number | null
  price_to_sales: number | null
  profit_margin: number | null
  return_on_equity: number | null
  debt_to_equity: number | null
  dividend_yield: number | null
  beta: number | null
  target_low_price: number | null
  target_mean_price: number | null
  target_high_price: number | null
  recommendation_key: string | null
  recommendation_mean: number | null
  number_of_analyst_opinions: number | null
}

export interface RecommendationTrendPoint {
  period: string
  strong_buy: number
  buy: number
  hold: number
  sell: number
  strong_sell: number
}

export interface EarningsCalendar {
  earnings_date: string | null
  earnings_low: number | null
  earnings_high: number | null
  earnings_average: number | null
  revenue_low: number | null
  revenue_high: number | null
  revenue_average: number | null
}

export interface InstitutionalHolder {
  holder: string | null
  shares: number | null
  date_reported: string | null
  percent_out: number | null
  value: number | null
}

export interface InstitutionalHolders {
  insider_percent: number | null
  institutions_percent: number | null
  top_holders: InstitutionalHolder[]
}

export interface AssetFundamentalsResponse {
  ticker: string
  valuation: AssetFundamentals | null
  analyst_recommendations: RecommendationTrendPoint[]
  earnings_calendar: EarningsCalendar | null
  holders: InstitutionalHolders | null
}

export async function getAssetFundamentals(ticker: string): Promise<AssetFundamentalsResponse> {
  const res = await fetch(`${API_BASE}/assets/${ticker}/fundamentals`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load fundamentals: ${res.status}`))
  return res.json()
}

export async function getPortfolios(): Promise<Portfolio[]> {
  const res = await fetch(`${API_BASE}/portfolios`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load portfolios: ${res.status}`))
  return res.json()
}

export async function createPortfolio(
  name: string,
  assets: PortfolioAssetInput[],
  benchmarkSymbol?: string | null,
  benchmarkLabel?: string | null,
): Promise<Portfolio> {
  const res = await fetch(`${API_BASE}/portfolios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      name,
      assets,
      benchmark_symbol: benchmarkSymbol ?? null,
      benchmark_label: benchmarkLabel ?? null,
    }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to create portfolio: ${res.status}`))
  return res.json()
}

export async function getPortfolioAnalysis(id: number): Promise<PortfolioAnalysis> {
  const res = await fetch(`${API_BASE}/portfolios/${id}/analysis`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load portfolio analysis: ${res.status}`))
  return res.json()
}

export interface RiskReturnPoint {
  return: number
  volatility: number
}

export interface PortfolioOptimization {
  objective: 'max_sharpe' | 'min_variance' | 'risk_parity'
  current_weights: { ticker: string; weight: number }[]
  suggested_weights: { ticker: string; weight: number }[]
  current_summary: PortfolioAnalysis['summary']
  suggested_summary: PortfolioAnalysis['summary']
  frontier: RiskReturnPoint[]
  current_point: RiskReturnPoint
  suggested_point: RiskReturnPoint
}

export async function getPortfolioOptimization(
  id: number,
  objective: 'max_sharpe' | 'min_variance' | 'risk_parity',
): Promise<PortfolioOptimization> {
  const res = await fetch(`${API_BASE}/portfolios/${id}/optimize?objective=${objective}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load optimization: ${res.status}`))
  return res.json()
}

export async function getPortfolioMonteCarlo(
  id: number,
  params: { horizonDays: number; confidence: number; simulations?: number },
): Promise<MonteCarloResult> {
  const query = new URLSearchParams({
    horizon_days: String(params.horizonDays),
    confidence: String(params.confidence),
    simulations: String(params.simulations ?? 2000),
  })
  const res = await fetch(`${API_BASE}/portfolios/${id}/montecarlo?${query}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to run Monte Carlo simulation: ${res.status}`))
  return res.json()
}

export async function getPortfolioGoalProjection(
  id: number,
  params: { initial: number; monthly: number; target: number; horizonMonths: number },
): Promise<GoalProjectionResult> {
  const query = new URLSearchParams({
    initial: String(params.initial),
    monthly: String(params.monthly),
    target: String(params.target),
    horizon_months: String(params.horizonMonths),
  })
  const res = await fetch(`${API_BASE}/portfolios/${id}/goal?${query}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to run goal projection: ${res.status}`))
  return res.json()
}

export async function getPortfolioBacktest(id: number, windowDays: number): Promise<RollingBacktestResult> {
  const res = await fetch(`${API_BASE}/portfolios/${id}/backtest?window_days=${windowDays}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to run backtest: ${res.status}`))
  return res.json()
}

export async function getPortfolioDetail(id: number): Promise<PortfolioDetail> {
  const res = await fetch(`${API_BASE}/portfolios/${id}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load portfolio: ${res.status}`))
  return res.json()
}

export async function updatePortfolio(
  id: number,
  name: string,
  assets: PortfolioAssetInput[],
  benchmarkSymbol?: string | null,
  benchmarkLabel?: string | null,
): Promise<Portfolio> {
  const res = await fetch(`${API_BASE}/portfolios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      name,
      assets,
      benchmark_symbol: benchmarkSymbol ?? null,
      benchmark_label: benchmarkLabel ?? null,
    }),
  })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to update portfolio: ${res.status}`))
  return res.json()
}

export async function deletePortfolio(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/portfolios/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to delete portfolio: ${res.status}`))
}

export async function createShareLink(id: number): Promise<string> {
  const res = await fetch(`${API_BASE}/portfolios/${id}/share`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to create share link: ${res.status}`))
  const data = await res.json()
  return data.share_token as string
}

export async function deleteShareLink(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/portfolios/${id}/share`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to revoke share link: ${res.status}`))
}

export async function getPublicPortfolioAnalysis(token: string): Promise<PortfolioAnalysis> {
  const res = await fetch(`${API_BASE}/public/portfolios/${token}/analysis`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load shared portfolio: ${res.status}`))
  return res.json()
}

export interface RealizedPLTotals {
  total_realized_pl: number
  total_proceeds: number
  total_cost_basis: number
  sale_count: number
}

export interface TickerRealizedPL extends RealizedPLTotals {
  ticker: string
}

export interface YearlyRealizedPL extends RealizedPLTotals {
  year: number
  tickers: TickerRealizedPL[]
}

export async function getTaxReport(portfolioId?: number, year?: number): Promise<YearlyRealizedPL[]> {
  const params = new URLSearchParams()
  if (portfolioId !== undefined) params.set('portfolio_id', String(portfolioId))
  if (year !== undefined) params.set('year', String(year))
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_BASE}/holdings/sales/tax-report${qs}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load tax report: ${res.status}`))
  return res.json()
}

export interface FxQuote {
  pair: string
  label: string
  rate: number
  change_percent: number
}

export interface CryptoQuote {
  symbol: string
  name: string
  last_price: number
  change_percent: number
  market_cap: number | null
  currency: string
}

export interface CountryInflation {
  country_code: string
  country_name: string
  value: number
  year: number
}

export async function getFxQuotes(): Promise<FxQuote[]> {
  const res = await fetch(`${API_BASE}/markets/fx`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load FX quotes: ${res.status}`))
  return res.json()
}

export async function getCryptoQuotes(): Promise<CryptoQuote[]> {
  const res = await fetch(`${API_BASE}/markets/crypto`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load crypto quotes: ${res.status}`))
  return res.json()
}

export async function getInflationByCountry(): Promise<CountryInflation[]> {
  const res = await fetch(`${API_BASE}/markets/inflation`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load inflation data: ${res.status}`))
  return res.json()
}

export async function getGdpGrowthByCountry(): Promise<CountryInflation[]> {
  const res = await fetch(`${API_BASE}/markets/gdp-growth`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load GDP growth data: ${res.status}`))
  return res.json()
}

export async function getUnemploymentByCountry(): Promise<CountryInflation[]> {
  const res = await fetch(`${API_BASE}/markets/unemployment`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load unemployment data: ${res.status}`))
  return res.json()
}

export interface TickerStripQuote {
  symbol: string
  label: string
  value: number
  change_percent: number
}

export async function getTickerStrip(): Promise<TickerStripQuote[]> {
  const res = await fetch(`${API_BASE}/markets/ticker-strip`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load ticker strip: ${res.status}`))
  return res.json()
}

export async function getMajorIndices(): Promise<TickerStripQuote[]> {
  const res = await fetch(`${API_BASE}/markets/indices`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load indices: ${res.status}`))
  return res.json()
}

export async function getCommodities(): Promise<TickerStripQuote[]> {
  const res = await fetch(`${API_BASE}/markets/commodities`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load commodities: ${res.status}`))
  return res.json()
}

export interface CryptoGlobalStats {
  total_market_cap_usd: number
  market_cap_change_percentage_24h: number
  btc_dominance: number
  eth_dominance: number
  others_dominance: number
}

export async function getCryptoGlobalStats(): Promise<CryptoGlobalStats> {
  const res = await fetch(`${API_BASE}/markets/crypto/global`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load crypto global stats: ${res.status}`))
  return res.json()
}

export interface IndexHistoryPoint {
  date: string
  close: number
}

export async function getBist100History(): Promise<IndexHistoryPoint[]> {
  const res = await fetch(`${API_BASE}/markets/bist100-history`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load BIST 100 history: ${res.status}`))
  return res.json()
}

export interface NewsItem {
  id: string
  title: string
  summary: string
  publisher: string
  url: string
  published_at: string | null
  thumbnail_url: string | null
  related_symbol: string
}

export async function getMarketNews(): Promise<NewsItem[]> {
  const res = await fetch(`${API_BASE}/markets/news`)
  if (!res.ok) throw new Error(await parseErrorDetail(res, `Failed to load market news: ${res.status}`))
  return res.json()
}

