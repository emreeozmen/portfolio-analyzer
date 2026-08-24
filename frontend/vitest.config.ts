import path from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ holds Playwright specs (run via `npm run test:e2e`, a real browser against
    // the live dev server) — excluded here even though vitest's default include glob
    // (*.test.ts) wouldn't match their *.spec.ts naming anyway, so this stays explicit
    // rather than relying on that not colliding later.
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
