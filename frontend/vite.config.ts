import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // This is a live-data (WebSocket) finance app — "fully functional offline"
      // isn't a meaningful goal here. The point is installability + a fast repeat
      // app-shell load, not offline price data, so precaching is deliberately
      // limited to the built app shell (JS/CSS/HTML) rather than API responses.
      manifest: {
        name: 'Finansal Risk & Portföy Analiz Platformu',
        short_name: 'Portföy Analizi',
        description: 'BIST ve küresel piyasalar için risk, getiri ve portföy analitiği.',
        lang: 'tr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0e14',
        theme_color: '#0a0e14',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Precache only the built app shell (JS/CSS/HTML/SVG). The backend API lives
        // on a separate origin (VITE_API_BASE_URL) entirely outside this service
        // worker's scope, so there's no risk of it ever caching a live price/quote/
        // portfolio response — no denylist needed for that. Client-side routes like
        // /assets/:ticker stay same-origin and keep using the normal SPA fallback.
        globPatterns: ['**/*.{js,css,html,svg}'],
        // Concatenates this plain-JS file into the generated service worker so it can
        // handle 'push'/'notificationclick' events — lighter-weight than switching
        // the whole plugin to the injectManifest strategy just for this. See
        // public/push-sw.js and src/lib/push.ts.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // These are the heaviest third-party dependencies (see CLAUDE.md's design-system
        // section) and each is shared by 2+ lazy routes (Chart.js: Home + PortfolioBuilder
        // + AssetDetail; the globe stack: only InflationMap, but it's the single biggest
        // chunk in the app) — splitting them into their own vendor chunks lets the browser
        // cache them independently of the route code that changes far more often.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'vendor-charts'
          if (
            id.includes('d3-geo') ||
            id.includes('topojson-client') ||
            id.includes('i18n-iso-countries') ||
            id.includes('world-atlas')
          )
            return 'vendor-globe'
          if (id.includes('framer-motion')) return 'vendor-motion'
          return undefined
        },
      },
    },
  },
})
