import i18n from '../i18n'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const READ_TIMEOUT_MS = 15_000

/** Retry only reads: repeating a purchase, deletion or account change could
 * duplicate an action whose response was lost. Each read has a bounded wait. */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return fetch(url, init)

  for (let attempt = 0; ; attempt++) {
    let delay = 1000 * 2 ** attempt
    try {
      const response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(READ_TIMEOUT_MS) })
      if (!RETRYABLE_STATUS.has(response.status) || attempt === 2) return response
      const retryAfter = Number(response.headers?.get('Retry-After'))
      if (Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.min(retryAfter * 1000, 30_000)
      // Release a failed response before retrying; don't retain open body streams.
      await response.body?.cancel()
    } catch (error) {
      if (init?.signal?.aborted) throw error
      const transient = error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
      if (!transient) throw error
      if (attempt === 2) throw new Error(i18n.t('common:connectionError'))
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}
