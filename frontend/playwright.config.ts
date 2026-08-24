import { defineConfig, devices } from '@playwright/test'

// Runs against the already-running dev server (npm run dev, http://localhost:5173) and
// the FastAPI backend (http://localhost:8000) — this project has no CI pipeline yet, so
// these are meant to be run locally the same way the manual browser QA in this session
// was done, not (yet) wired into a headless CI job. `webServer` is deliberately omitted:
// auto-starting Vite here but not the Python backend would just produce confusing
// "backend unreachable" failures instead of a clear "start both servers first" message.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
