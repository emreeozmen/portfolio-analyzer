import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRemoteData } from './useRemoteData'

describe('snapshot and live recovery', () => {
  it('retries a failed snapshot when the browser comes back online', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([42])
    const { result } = renderHook(() => useRemoteData<number[]>(loader, []))
    await waitFor(() => expect(result.current.error).toBe(true))
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(result.current.data).toEqual([42]))
    expect(result.current.error).toBe(false)
  })

  it('shows live data even if the initial REST request failed', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('REST down'))
    const { result, rerender } = renderHook(({ live }) => useRemoteData<number[]>(loader, [], live), {
      initialProps: { live: null as number[] | null },
    })
    await waitFor(() => expect(result.current.error).toBe(true))
    rerender({ live: [7] })
    expect(result.current.data).toEqual([7])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(false)
  })

  it('ignores an old response after a newer retry succeeds', async () => {
    let resolveOld!: (value: number[]) => void
    const loader = vi.fn().mockImplementationOnce(() => new Promise<number[]>((resolve) => { resolveOld = resolve }))
      .mockResolvedValue([2])
    const { result } = renderHook(() => useRemoteData<number[]>(loader, []))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.data).toEqual([2]))
    await act(async () => resolveOld([1]))
    expect(result.current.data).toEqual([2])
  })
})
