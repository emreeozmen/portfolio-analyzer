import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest.config.ts doesn't set `test.globals: true`, so @testing-library/react's own
// auto-cleanup (which relies on detecting a global `afterEach`) never registers —
// without this, multiple `render()` calls across `it` blocks in the same test file
// silently accumulate DOM from prior tests instead of starting fresh each time.
afterEach(() => {
  cleanup()
})
