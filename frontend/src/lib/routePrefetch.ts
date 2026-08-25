// Shared dynamic-import functions for the lazy-loaded routes in App.tsx — hovering a
// nav link (see Layout.tsx) calls the same import() ahead of the actual click, so the
// chunk is already downloading/cached by the time the user navigates instead of only
// starting then. The module loader dedupes repeat import() calls to the same
// specifier, so warming it here never causes a double fetch — App.tsx's React.lazy()
// just resolves to the same already-in-flight (or already-settled) promise.
export const routeImporters: Record<string, () => Promise<unknown>> = {
  '/market': () => import('../pages/MarketDashboard'),
  '/assets': () => import('../pages/AssetScreener'),
  '/portfolio': () => import('../pages/PortfolioBuilder'),
  '/kripto': () => import('../pages/CryptoLeaderboard'),
  '/enflasyon': () => import('../pages/InflationMap'),
  '/hesap': () => import('../pages/AccountSettings'),
}

export function prefetchRoute(path: string): void {
  routeImporters[path]?.()
}
