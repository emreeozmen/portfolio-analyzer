import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './apiFetch'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('read recovery', () => {
  it('recovers from a network failure and then a server failure', async () => {
    vi.useFakeTimers()
    const success = new Response('[]', { status: 200 })
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 })).mockResolvedValue(success)
    vi.stubGlobal('fetch', fetcher)
    const result = apiFetch('/markets/crypto')
    await vi.runAllTimersAsync()
    expect(await result).toBe(success)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('bounds repeated network failures and shows an understandable error', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    const assertion = expect(apiFetch('/assets')).rejects.toThrow(/Sunucuya|server/)
    await vi.runAllTimersAsync()
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it.each([400, 401, 403, 404])('does not retry permanent HTTP %s errors', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }))
    vi.stubGlobal('fetch', fetcher)
    expect((await apiFetch('/private')).status).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['POST', 'DELETE', 'PUT', 'PATCH'])('never repeats a %s action after a lost response', async (method) => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetcher)
    await expect(apiFetch('/action', { method })).rejects.toThrow('Failed to fetch')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('respects caller cancellation without retrying', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn().mockRejectedValue(controller.signal.reason)
    vi.stubGlobal('fetch', fetcher)
    await expect(apiFetch('/assets', { signal: controller.signal })).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
